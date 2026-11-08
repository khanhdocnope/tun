use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tracing::{error, warn};
use uuid::Uuid;

use crate::core::formats::package_pages;
use crate::error::{MoeJectError, Result};
use crate::models::{
    DownloadTaskRequest, DownloadTaskStatus, LibraryFileItem, MangaInfo, MangaSearchResult,
    SourceMetadata,
};
use crate::server::state::AppState;

pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "healthy",
        "engine": "rust",
        "version": "1.0.0",
        "runtime": "Tokio + Axum (Native Machine Code)"
    }))
}

pub async fn get_sources(State(state): State<AppState>) -> Json<Vec<SourceMetadata>> {
    Json(state.registry.list_metadata())
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub source: Option<String>,
    pub q: Option<String>,
    pub page: Option<u32>,
}

pub async fn search_manga(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<MangaSearchResult>>> {
    let source_id = query.source.unwrap_or_else(|| "mangadex".to_string());
    let source = state.registry.get(&source_id)?;
    let q = query.q.unwrap_or_default();
    let page = query.page.unwrap_or(1);

    let results = source.search(&q, page).await?;
    Ok(Json(results))
}

pub async fn get_manga_details(
    State(state): State<AppState>,
    Path((source_id, manga_id)): Path<(String, String)>,
) -> Result<Json<MangaInfo>> {
    let source = state.registry.get(&source_id)?;
    let info = source.get_manga_details(&manga_id).await?;
    Ok(Json(info))
}

pub async fn get_chapter_pages(
    State(state): State<AppState>,
    Path((source_id, chapter_id)): Path<(String, String)>,
) -> Result<Json<Vec<String>>> {
    let source = state.registry.get(&source_id)?;
    let pages = source.get_chapter_pages(&chapter_id).await?;
    Ok(Json(pages))
}

fn parse_chapter_ranges(input: &str) -> Vec<(f64, f64)> {
    let mut ranges = Vec::new();
    for part in input.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start_str, end_str)) = part.split_once('-') {
            if let (Ok(s), Ok(e)) = (start_str.trim().parse::<f64>(), end_str.trim().parse::<f64>()) {
                ranges.push((s.min(e), s.max(e)));
            }
        } else if let Ok(val) = part.parse::<f64>() {
            ranges.push((val, val));
        }
    }
    ranges
}

pub async fn start_download(
    State(state): State<AppState>,
    Json(req): Json<DownloadTaskRequest>,
) -> Result<Json<Value>> {
    let task_id = Uuid::new_v4().to_string();

    let initial_status = DownloadTaskStatus {
        task_id: task_id.clone(),
        status: "pending".to_string(),
        source_id: req.source.clone(),
        manga_id: req.manga_id.clone(),
        format: req.format.as_str().to_string(),
        total_chapters: 0,
        completed_chapters: 0,
        total_pages: 0,
        completed_pages: 0,
        percent: 0.0,
        progress: 0.0,
        downloaded_pages: 0,
        message: "Khởi tạo tác vụ tải truyện...".to_string(),
        results: Vec::new(),
        file_path: None,
        file_name: None,
        file_size_mb: None,
        error: None,
    };

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(task_id.clone(), initial_status);
    }

    // Spawn async background download worker
    let bg_state = state.clone();
    let bg_task_id = task_id.clone();

    tokio::spawn(async move {
        let run_task = async {
            let source = bg_state.registry.get(&req.source)?;

            // 1. Fetch Manga Info & Chapters
            {
                let mut tasks = bg_state.tasks.write().await;
                if let Some(t) = tasks.get_mut(&bg_task_id) {
                    t.status = "running".to_string();
                    t.message = "Đang lấy thông tin truyện và danh sách chương...".to_string();
                }
            }

            let manga = source.get_manga_details(&req.manga_id).await?;

            // Filter target chapters
            let chapters_to_download: Vec<crate::models::Chapter> = {
                if let Some(ref ids) = req.chapter_ids {
                    if !ids.is_empty() {
                        manga
                            .chapters
                            .iter()
                            .filter(|c| ids.contains(&c.id))
                            .cloned()
                            .collect()
                    } else {
                        manga.chapters.clone()
                    }
                } else if let Some(ref single_id) = req.chapter_id {
                    manga
                        .chapters
                        .iter()
                        .filter(|c| c.id == *single_id)
                        .cloned()
                        .collect()
                } else if let Some(ref range_str) = req.chapters {
                    let trimmed = range_str.trim();
                    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("all") {
                        manga.chapters.clone()
                    } else {
                        let ranges = parse_chapter_ranges(trimmed);
                        manga
                            .chapters
                            .iter()
                            .filter(|c| {
                                if let Ok(num) = c.chapter_number.parse::<f64>() {
                                    ranges.iter().any(|(s, e)| num >= *s && num <= *e)
                                } else {
                                    false
                                }
                            })
                            .cloned()
                            .collect()
                    }
                } else {
                    manga.chapters.clone()
                }
            };

            if chapters_to_download.is_empty() {
                return Err(MoeJectError::NotFound(
                    "Không tìm thấy chương nào phù hợp để tải về".to_string(),
                ));
            }

            let total_chapters = chapters_to_download.len();
            {
                let mut tasks = bg_state.tasks.write().await;
                if let Some(t) = tasks.get_mut(&bg_task_id) {
                    t.total_chapters = total_chapters;
                    t.message = format!("Chuẩn bị tải {} chương...", total_chapters);
                }
            }

            let mut results = Vec::new();
            let mut total_pages_all = 0;
            let mut completed_pages_all = 0;
            let mut last_file_path = None;
            let mut last_file_name = None;
            let mut last_file_size = None;

            for (idx, chapter) in chapters_to_download.into_iter().enumerate() {
                // Fetch chapter pages if not yet populated
                let mut pages = chapter.pages.clone();
                if pages.is_empty() {
                    pages = match source.get_chapter_pages(&chapter.id).await {
                        Ok(p) => p,
                        Err(e) => {
                            warn!("Không lấy được trang của chapter {}: {}", chapter.id, e);
                            results.push(crate::models::ChapterDownloadResult {
                                chapter_id: chapter.id.clone(),
                                chapter_number: chapter.chapter_number.clone(),
                                success: false,
                                output_path: None,
                                page_count: 0,
                                error: Some(e.to_string()),
                            });
                            continue;
                        }
                    };
                }

                let ch_pages_len = pages.len();
                total_pages_all += ch_pages_len;

                {
                    let mut tasks = bg_state.tasks.write().await;
                    if let Some(t) = tasks.get_mut(&bg_task_id) {
                        t.total_pages = total_pages_all;
                        t.message = format!(
                            "Đang tải chương {}/{} (Ch. {} - {} trang)...",
                            idx + 1,
                            total_chapters,
                            chapter.chapter_number,
                            ch_pages_len
                        );
                    }
                }

                let task_id_cb = bg_task_id.clone();
                let state_cb = bg_state.clone();
                let base_done = completed_pages_all;

                let downloaded = bg_state
                    .downloader
                    .download_pages(&pages, None, chapter.drm_data.as_deref(), move |done, _tot| {
                        let tid = task_id_cb.clone();
                        let st = state_cb.clone();
                        tokio::spawn(async move {
                            let mut tasks = st.tasks.write().await;
                            if let Some(t) = tasks.get_mut(&tid) {
                                let cur_done = base_done + done;
                                t.completed_pages = cur_done;
                                t.downloaded_pages = cur_done;
                                if t.total_pages > 0 {
                                    let ratio = (cur_done as f64 / t.total_pages as f64).min(1.0);
                                    t.percent = ratio * 100.0;
                                    t.progress = ratio as f32;
                                }
                            }
                        });
                    })
                    .await?;

                completed_pages_all += downloaded.len();

                // Package chapter
                let output_folder = req
                    .output_dir
                    .as_ref()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| bg_state.downloads_dir.clone());

                let packed_path = package_pages(
                    &output_folder,
                    &manga,
                    &chapter,
                    &downloaded,
                    req.format,
                )?;

                let file_size_mb = std::fs::metadata(&packed_path)
                    .map(|m| m.len() as f64 / (1024.0 * 1024.0))
                    .unwrap_or(0.0);

                let file_name = packed_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("downloaded_manga")
                    .to_string();

                last_file_path = Some(packed_path.to_string_lossy().to_string());
                last_file_name = Some(file_name);
                last_file_size = Some(file_size_mb);

                results.push(crate::models::ChapterDownloadResult {
                    chapter_id: chapter.id.clone(),
                    chapter_number: chapter.chapter_number.clone(),
                    success: true,
                    output_path: Some(packed_path.to_string_lossy().to_string()),
                    page_count: downloaded.len(),
                    error: None,
                });

                {
                    let mut tasks = bg_state.tasks.write().await;
                    if let Some(t) = tasks.get_mut(&bg_task_id) {
                        t.completed_chapters = idx + 1;
                        t.results = results.clone();
                    }
                }
            }

            // Mark completed
            {
                let mut tasks = bg_state.tasks.write().await;
                if let Some(t) = tasks.get_mut(&bg_task_id) {
                    t.status = "completed".to_string();
                    t.progress = 1.0;
                    t.percent = 100.0;
                    t.completed_pages = completed_pages_all;
                    t.downloaded_pages = completed_pages_all;
                    t.file_path = last_file_path;
                    t.file_name = last_file_name;
                    t.file_size_mb = last_file_size;
                    t.message = format!(
                        "Hoàn tất tải về {}/{} chương thành công!",
                        results.iter().filter(|r| r.success).count(),
                        total_chapters
                    );
                }
            }

            Ok::<(), MoeJectError>(())
        };

        if let Err(e) = run_task.await {
            error!("Background download task {} failed: {}", bg_task_id, e);
            let mut tasks = bg_state.tasks.write().await;
            if let Some(t) = tasks.get_mut(&bg_task_id) {
                t.status = "failed".to_string();
                t.error = Some(e.to_string());
                t.message = format!("Thất bại: {}", e);
            }
        }
    });

    Ok(Json(json!({
        "success": true,
        "task_id": task_id,
        "message": "Đã bắt đầu tiến trình tải ngầm"
    })))
}

pub async fn get_download_progress(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<DownloadTaskStatus>> {
    let tasks = state.tasks.read().await;
    let status = tasks
        .get(&task_id)
        .cloned()
        .ok_or_else(|| MoeJectError::NotFound(format!("Task {} not found", task_id)))?;

    Ok(Json(status))
}

pub async fn get_download_file(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Response> {
    let tasks = state.tasks.read().await;
    let status = tasks
        .get(&task_id)
        .ok_or_else(|| MoeJectError::NotFound(format!("Task {} not found", task_id)))?;

    let file_path_str = status.file_path.as_ref().ok_or_else(|| {
        MoeJectError::InvalidRequest("File has not finished downloading yet".to_string())
    })?;

    let file_path = PathBuf::from(file_path_str);
    if !file_path.exists() {
        return Err(MoeJectError::NotFound(
            "Output file does not exist on disk".to_string(),
        ));
    }

    let file_name = status
        .file_name
        .clone()
        .unwrap_or_else(|| "download.cbz".to_string());

    let bytes = tokio::fs::read(&file_path).await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/octet-stream".parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name)
            .parse()
            .unwrap(),
    );

    Ok((headers, bytes).into_response())
}

#[derive(Deserialize)]
pub struct DirectFileQuery {
    pub path: String,
}

pub async fn download_file_direct(
    State(state): State<AppState>,
    Query(query): Query<DirectFileQuery>,
) -> Result<Response> {
    let requested_path = PathBuf::from(&query.path);

    // Path traversal check
    let canonical = requested_path.canonicalize()?;
    let downloads_canon = state.downloads_dir.canonicalize()?;

    if !canonical.starts_with(&downloads_canon) {
        return Err(MoeJectError::InvalidRequest(
            "Access denied: Path outside downloads directory".to_string(),
        ));
    }

    let file_name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let bytes = tokio::fs::read(&canonical).await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/octet-stream".parse().unwrap());
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", file_name)
            .parse()
            .unwrap(),
    );

    Ok((headers, bytes).into_response())
}

pub async fn get_library(State(state): State<AppState>) -> Result<Json<Vec<LibraryFileItem>>> {
    let mut items = Vec::new();

    if state.downloads_dir.exists() {
        let mut entries = tokio::fs::read_dir(&state.downloads_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if ext == "zip" || ext == "cbz" || ext == "pdf" {
                    let meta = entry.metadata().await?;
                    let size_mb = (meta.len() as f64) / (1024.0 * 1024.0);
                    let name = entry.file_name().to_string_lossy().to_string();

                    items.push(LibraryFileItem {
                        name,
                        path: path.to_string_lossy().to_string(),
                        size_mb,
                        format: ext.to_uppercase(),
                        modified_at: "Vừa tải xong".to_string(),
                    });
                }
            }
        }
    }

    items.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(Json(items))
}
