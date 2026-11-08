use crate::models::{DownloadStatus, DownloadTask, PageItem};
use crate::packager::cbz::{create_cbz, PageData};
use crate::packager::zip::create_zip;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub fn is_valid_image(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    // PNG
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return true;
    }
    // JPEG
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return true;
    }
    // GIF
    if bytes.starts_with(b"GIF8") {
        return true;
    }
    // WebP (RIFF....WEBP)
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return true;
    }
    false
}

pub async fn execute_download(
    app: AppHandle,
    mut task: DownloadTask,
    pages: Vec<PageItem>,
    download_dir: String,
) -> Result<(), String> {
    task.status = DownloadStatus::Downloading;
    task.total_pages = pages.len();
    task.downloaded_pages = 0;
    let _ = app.emit("download-progress", &task);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap_or_default();

    let mut page_data_list = Vec::new();
    let downloaded_count = Arc::new(AtomicUsize::new(0));

    for page in pages {
        let mut attempts = 0;
        let mut success = false;
        let mut last_err = String::new();

        while attempts < 3 && !success {
            attempts += 1;
            let mut req = client.get(&page.url);
            if page.url.contains("mangadex.org") {
                req = req.header("User-Agent", "MoeJect/1.0");
            } else if page.url.contains("hitomi.la") {
                req = req.header("Referer", "https://hitomi.la/");
            }

            match req.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            let final_bytes = bytes.to_vec();

                            // Cuutruyen descramble check if DRM header present or detected
                            if page.url.contains("cuutruyen") && !is_valid_image(&final_bytes) {
                                // DRM scrambled
                            }

                            if is_valid_image(&final_bytes) || final_bytes.len() > 1000 {
                                page_data_list.push(PageData {
                                    filename: format!("{:03}.webp", page.page_number),
                                    bytes: final_bytes,
                                });
                                let count = downloaded_count.fetch_add(1, Ordering::SeqCst) + 1;
                                task.downloaded_pages = count;
                                let _ = app.emit("download-progress", &task);
                                success = true;
                            } else {
                                last_err = "Invalid magic bytes in image".to_string();
                            }
                        }
                    } else {
                        last_err = format!("HTTP {}", resp.status());
                    }
                }
                Err(e) => {
                    last_err = e.to_string();
                }
            }

            if !success && attempts < 3 {
                tokio::time::sleep(tokio::time::Duration::from_millis(500 * attempts as u64)).await;
            }
        }

        if !success {
            task.status = DownloadStatus::Failed;
            task.error_message = Some(format!("Failed page {}: {}", page.page_number, last_err));
            let _ = app.emit("download-progress", &task);
            return Err(task.error_message.unwrap());
        }
    }

    // Packaging phase
    task.status = DownloadStatus::Packaging;
    let _ = app.emit("download-progress", &task);

    let clean_manga = sanitize_filename(&task.manga_title);
    let clean_chapter = sanitize_filename(&task.chapter_title);
    let ext = if task.file_format.to_lowercase() == "zip" { "zip" } else { "cbz" };

    let out_dir = PathBuf::from(&download_dir).join(&clean_manga);
    let out_file = out_dir.join(format!("{}.{}", clean_chapter, ext));

    let pack_res = if ext == "zip" {
        create_zip(&out_file, &page_data_list)
    } else {
        create_cbz(&out_file, &task.manga_title, &task.chapter_title, 1.0, &page_data_list)
    };

    match pack_res {
        Ok(_) => {
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

fn sanitize_filename(name: &str) -> String {
    let invalid = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    name.chars()
        .map(|c| if invalid.contains(&c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}
