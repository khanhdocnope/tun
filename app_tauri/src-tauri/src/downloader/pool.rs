use crate::downloader::host_gate::HostGate;
use crate::downloader::validator::{detect_image_format, validate_saved_image};
pub use crate::downloader::validator::is_valid_image;
use crate::models::{DownloadStatus, DownloadTask, PageItem};
use crate::packager::cbz::create_cbz_from_files;
use crate::packager::zip::create_zip_from_files;
use crate::sources::cuutruyen::CuutruyenSource;
use futures::stream::{self, StreamExt};
use reqwest::header::RETRY_AFTER;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// Re-export is_valid_image for backwards-compatibility with tests
pub use crate::downloader::validator::is_valid_image as validator_is_valid_image;

/// Parse Retry-After header from response, defaulting to fallback duration.
fn parse_retry_after(resp: &reqwest::Response, default_secs: u64) -> Duration {
    if let Some(val) = resp.headers().get(RETRY_AFTER) {
        if let Ok(s) = val.to_str() {
            if let Ok(secs) = s.trim().parse::<u64>() {
                return Duration::from_secs(secs.min(60));
            }
        }
    }
    Duration::from_secs(default_secs)
}

/// Calculate random-like jitter in milliseconds between 100ms and 1000ms.
fn calculate_jitter_ms(seed: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let state = (now ^ seed).wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    100 + (state % 900)
}

/// Sanitize file/folder name.
pub fn sanitize_filename(name: &str) -> String {
    let invalid = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    let clean: String = name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect();
    clean.trim().to_string()
}

/// Execute a complete chapter download with per-host semaphore, resume support,
/// 429 jitter backoff, true magic bytes detection, and cancellation.
pub async fn execute_download(
    app: AppHandle,
    mut task: DownloadTask,
    pages: Vec<PageItem>,
    download_dir: String,
    host_gate: Arc<HostGate>,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    task.status = DownloadStatus::Downloading;
    task.total_pages = pages.len();
    task.downloaded_pages = 0;
    task.error_message = None;
    let _ = app.emit("download-progress", &task);

    let clean_manga = sanitize_filename(&task.manga_title);
    let clean_chapter = sanitize_filename(&task.chapter_title);
    let temp_dir = PathBuf::from(&download_dir)
        .join(".tmp")
        .join(&clean_manga)
        .join(&clean_chapter);

    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create temp dir failed: {}", e))?;

    // --- 1. RESUME CHECK ---
    // Check which pages already exist and are valid on disk.
    let mut completed_pages: std::collections::HashMap<usize, PathBuf> = std::collections::HashMap::new();
    let mut pages_to_download: Vec<PageItem> = Vec::new();

    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
                if file_name.ends_with(".part") {
                    // Stale partial file from previous interrupted run; clean up
                    let _ = fs::remove_file(&path);
                    continue;
                }
                if file_name.starts_with("page_") {
                    // Format: page_0001.webp or page_0001.jpg
                    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    if let Some(num_str) = stem.strip_prefix("page_") {
                        if let Ok(p_num) = num_str.parse::<usize>() {
                            if validate_saved_image(&path).is_ok() {
                                completed_pages.insert(p_num, path);
                            }
                        }
                    }
                }
            }
        }
    }

    for p in pages {
        if !completed_pages.contains_key(&p.page_number) {
            pages_to_download.push(p);
        }
    }

    let initial_completed = completed_pages.len();
    let downloaded_count = Arc::new(AtomicUsize::new(initial_completed));
    task.downloaded_pages = initial_completed;
    let _ = app.emit("download-progress", &task);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    // --- 2. PARALLEL DOWNLOAD WITH HOST SEMAPHORE & RETRIES ---
    let max_parallel_workers = 6;
    let client_ref = &client;
    let host_gate_ref = &host_gate;
    let cancel_flag_ref = &cancel_flag;
    let temp_dir_ref = &temp_dir;
    let app_ref = &app;
    let downloaded_count_ref = &downloaded_count;
    let task_id = task.id.clone();

    let download_stream = stream::iter(pages_to_download).map(|page| {
        let app = app_ref.clone();
        let client = client_ref.clone();
        let host_gate = host_gate_ref.clone();
        let cancel_flag = cancel_flag_ref.clone();
        let temp_dir = temp_dir_ref.clone();
        let downloaded_count = downloaded_count_ref.clone();
        let task_id = task_id.clone();
        let total_pages = task.total_pages;

        async move {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err("ERR_CANCELLED: Download cancelled by user".to_string());
            }

            let mut candidate_urls = vec![page.url.clone()];
            candidate_urls.extend(page.fallback_urls.clone());

            let mut attempts = 0;
            let mut success = false;
            let mut last_err = String::new();

            while attempts < 3 && !success {
                attempts += 1;

                if cancel_flag.load(Ordering::SeqCst) {
                    return Err("ERR_CANCELLED: Download cancelled by user".to_string());
                }

                // Rotate candidate URL if previous candidate failed
                let candidate_idx = (attempts - 1) % candidate_urls.len();
                let current_url = &candidate_urls[candidate_idx];
                let host = HostGate::extract_host(current_url);

                // Acquire per-host semaphore permit
                let permit = host_gate.acquire(&host).await;
                if permit.is_none() {
                    last_err = format!("ERR_SEMAPHORE_CLOSED: Host gate closed for {}", host);
                    continue;
                }

                let mut req = client.get(current_url);
                if host.contains("mangadex.org") {
                    req = req.header("User-Agent", "MoeJect/1.0");
                } else if host.contains("hitomi.la") || host.contains("gold-usergeneratedcontent.net") {
                    req = req.header("Referer", "https://hitomi.la/")
                             .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36");
                } else if host.contains("cuutruyen.net") {
                    req = req.header("Referer", "https://cuutruyen.net/")
                             .header("Accept", "image/avif,image/webp,image/png,image/*;q=0.8");
                }

                match req.send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                            // HTTP 429: handle Retry-After header with jitter
                            let retry_after = parse_retry_after(&resp, 3);
                            let jitter_ms = calculate_jitter_ms(page.page_number as u64 + attempts as u64);
                            let sleep_duration = retry_after + Duration::from_millis(jitter_ms);
                            last_err = format!(
                                "ERR_HTTP_429: Rate limited by {}. Waiting {:?} (jitter {}ms)",
                                host, sleep_duration, jitter_ms
                            );
                            drop(permit); // Release permit while sleeping
                            tokio::time::sleep(sleep_duration).await;
                            continue;
                        } else if status.is_success() {
                            match resp.bytes().await {
                                Ok(bytes) => {
                                    drop(permit); // Released as soon as bytes are in memory
                                    let mut final_bytes = bytes.to_vec();

                                    // DRM descrambler (Cuutruyen)
                                    if let Some(ref drm_b64) = page.drm_data {
                                        match CuutruyenSource::descramble_image(&final_bytes, drm_b64) {
                                            Ok(descrambled) => {
                                                final_bytes = descrambled;
                                            }
                                            Err(e) => {
                                                last_err = format!("ERR_DESCRAMBLE_FAILED: {}", e);
                                                continue;
                                            }
                                        }
                                    }

                                    // Magic bytes validation
                                    if let Some(ext) = detect_image_format(&final_bytes) {
                                        let part_path = temp_dir.join(format!("page_{:04}.part", page.page_number));
                                        let final_path = temp_dir.join(format!("page_{:04}.{}", page.page_number, ext));

                                        if let Err(e) = fs::write(&part_path, &final_bytes) {
                                            last_err = format!("ERR_IO_WRITE: Failed to write temp file: {}", e);
                                            continue;
                                        }

                                        if let Err(e) = fs::rename(&part_path, &final_path) {
                                            last_err = format!("ERR_IO_RENAME: Failed to rename file: {}", e);
                                            continue;
                                        }

                                        let count = downloaded_count.fetch_add(1, Ordering::SeqCst) + 1;
                                        let progress_task = DownloadTask {
                                            id: task_id.clone(),
                                            manga_id: String::new(),
                                            manga_title: String::new(),
                                            chapter_id: String::new(),
                                            chapter_title: String::new(),
                                            status: DownloadStatus::Downloading,
                                            total_pages,
                                            downloaded_pages: count,
                                            file_format: String::new(),
                                            error_message: None,
                                        };
                                        let _ = app.emit("download-progress", &progress_task);
                                        success = true;
                                        break;
                                    } else {
                                        last_err = format!(
                                            "ERR_INVALID_MAGIC_BYTES: Response from {} is not a valid image format",
                                            current_url
                                        );
                                    }
                                }
                                Err(e) => {
                                    drop(permit);
                                    last_err = format!("ERR_READ_BYTES: {}", e);
                                }
                            }
                        } else {
                            drop(permit);
                            let code = if status.as_u16() == 403 {
                                "ERR_HTTP_403_FORBIDDEN"
                            } else if status.is_server_error() {
                                "ERR_HTTP_5XX_SERVER"
                            } else {
                                "ERR_HTTP_STATUS"
                            };
                            last_err = format!("{}: {} for URL {}", code, status, current_url);
                        }
                    }
                    Err(e) => {
                        drop(permit);
                        let err_type = if e.is_timeout() {
                            "ERR_TIMEOUT"
                        } else if e.is_connect() {
                            "ERR_CONNECTION"
                        } else {
                            "ERR_NETWORK"
                        };
                        last_err = format!("{}: {}", err_type, e);
                    }
                }

                if !success && attempts < 3 {
                    let backoff_ms = (500 * attempts as u64) + calculate_jitter_ms(page.page_number as u64);
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                }
            }

            if success {
                Ok(page.page_number)
            } else {
                Err(format!(
                    "Page {} failed after 3 attempts: {}",
                    page.page_number, last_err
                ))
            }
        }
    });

    let mut buffered = download_stream.buffer_unordered(max_parallel_workers);
    while let Some(res) = buffered.next().await {
        if cancel_flag.load(Ordering::SeqCst) {
            task.status = DownloadStatus::Cancelled;
            task.error_message = Some("Download cancelled by user".to_string());
            let _ = app.emit("download-progress", &task);
            clean_temp_dir_parts(&temp_dir);
            return Err("Download cancelled by user".to_string());
        }

        if let Err(err_msg) = res {
            task.status = DownloadStatus::Failed;
            task.error_message = Some(err_msg.clone());
            let _ = app.emit("download-progress", &task);
            clean_temp_dir_parts(&temp_dir);
            return Err(err_msg);
        }
    }

    if cancel_flag.load(Ordering::SeqCst) {
        task.status = DownloadStatus::Cancelled;
        task.error_message = Some("Download cancelled by user".to_string());
        let _ = app.emit("download-progress", &task);
        clean_temp_dir_parts(&temp_dir);
        return Err("Download cancelled by user".to_string());
    }

    // --- 3. PACKAGING PHASE (STREAM FROM DISK) ---
    task.status = DownloadStatus::Packaging;
    let _ = app.emit("download-progress", &task);

    // Collect all completed page files sorted by page number
    let mut page_files: Vec<(usize, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if let Some(num_str) = stem.strip_prefix("page_") {
                    if let Ok(p_num) = num_str.parse::<usize>() {
                        page_files.push((p_num, path));
                    }
                }
            }
        }
    }
    page_files.sort_by_key(|(num, _)| *num);

    if page_files.len() < task.total_pages {
        let err = format!(
            "Packaging error: Expected {} pages, but found {}",
            task.total_pages,
            page_files.len()
        );
        task.status = DownloadStatus::Failed;
        task.error_message = Some(err.clone());
        let _ = app.emit("download-progress", &task);
        return Err(err);
    }

    let file_paths: Vec<PathBuf> = page_files.into_iter().map(|(_, p)| p).collect();
    let ext = if task.file_format.to_lowercase() == "zip" { "zip" } else { "cbz" };
    let out_dir = PathBuf::from(&download_dir).join(&clean_manga);
    let out_file = out_dir.join(format!("{}.{}", clean_chapter, ext));

    let pack_res = if ext == "zip" {
        create_zip_from_files(&out_file, &file_paths)
    } else {
        create_cbz_from_files(&out_file, &task.manga_title, &task.chapter_title, 1.0, &file_paths)
    };

    match pack_res {
        Ok(_) => {
            // Delete temp folder on successful packaging
            let _ = fs::remove_dir_all(&temp_dir);
            task.status = DownloadStatus::Completed;
            let _ = app.emit("download-progress", &task);
            Ok(())
        }
        Err(e) => {
            task.status = DownloadStatus::Failed;
            task.error_message = Some(format!("Packaging failed: {}", e));
            let _ = app.emit("download-progress", &task);
            Err(e)
        }
    }
}

/// Remove any lingering .part files in temp directory
fn clean_temp_dir_parts(temp_dir: &Path) {
    if let Ok(entries) = fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("part") {
                let _ = fs::remove_file(path);
            }
        }
    }
}
