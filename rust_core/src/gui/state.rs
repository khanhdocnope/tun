use base64::Engine;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use crate::api::SourceRegistry;
use crate::models::{
    DownloadTaskRequest, DownloadTaskStatus, LibraryFileItem, MangaInfo, MangaSearchResult,
    SourceMetadata,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveTab {
    Browse,
    Detail,
    Downloads,
    Library,
    Cleaner,
    Settings,
}

pub enum GuiCommand {
    LoadSources,
    Search {
        source: String,
        query: String,
    },
    GetDetails {
        source: String,
        manga_id: String,
    },
    StartDownload {
        request: DownloadTaskRequest,
    },
    ScanLibrary,
    CleanImage {
        image_bytes: Vec<u8>,
        hf_url: String,
    },
}

pub enum GuiEvent {
    SourcesLoaded(Vec<SourceMetadata>),
    SearchResults {
        query: String,
        results: std::result::Result<Vec<MangaSearchResult>, String>,
    },
    MangaDetails(std::result::Result<MangaInfo, String>),
    DownloadStatus(DownloadTaskStatus),
    LibraryScanned(Vec<LibraryFileItem>),
    CleanCompleted(std::result::Result<Vec<u8>, String>),
}

pub struct GuiBridge {
    pub cmd_tx: UnboundedSender<GuiCommand>,
    pub evt_rx: UnboundedReceiver<GuiEvent>,
}

pub fn spawn_async_bridge(
    registry: Arc<SourceRegistry>,
    downloads_dir: PathBuf,
) -> (UnboundedSender<GuiCommand>, UnboundedReceiver<GuiEvent>) {
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<GuiCommand>();
    let (evt_tx, evt_rx) = tokio::sync::mpsc::unbounded_channel::<GuiEvent>();

    let downloader = Arc::new(crate::core::downloader::Downloader::new(6));

    tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            let reg = registry.clone();
            let dl = downloader.clone();
            let d_dir = downloads_dir.clone();
            let evt = evt_tx.clone();

            match cmd {
                GuiCommand::LoadSources => {
                    let sources = reg.list_metadata();
                    let _ = evt.send(GuiEvent::SourcesLoaded(sources));
                }
                GuiCommand::Search { source, query } => {
                    tokio::spawn(async move {
                        let res = match reg.get(&source) {
                            Ok(s) => s.search(&query, 1).await.map_err(|e| e.to_string()),
                            Err(e) => Err(e.to_string()),
                        };
                        let _ = evt.send(GuiEvent::SearchResults {
                            query,
                            results: res,
                        });
                    });
                }
                GuiCommand::GetDetails { source, manga_id } => {
                    tokio::spawn(async move {
                        let res = match reg.get(&source) {
                            Ok(s) => s.get_manga_details(&manga_id).await.map_err(|e| e.to_string()),
                            Err(e) => Err(e.to_string()),
                        };
                        let _ = evt.send(GuiEvent::MangaDetails(res));
                    });
                }
                GuiCommand::StartDownload { request } => {
                    let reg_c = reg.clone();
                    let dl_c = dl.clone();
                    let d_dir_c = d_dir.clone();
                    let evt_c = evt.clone();

                    tokio::spawn(async move {
                        let task_id = uuid::Uuid::new_v4().to_string();
                        let src_id = request.source.clone();
                        let m_id = request.manga_id.clone();
                        let fmt_str = request.format.as_str().to_string();

                        let mut status = DownloadTaskStatus {
                            task_id: task_id.clone(),
                            status: "running".to_string(),
                            source_id: src_id.clone(),
                            manga_id: m_id.clone(),
                            format: fmt_str.clone(),
                            total_chapters: 0,
                            completed_chapters: 0,
                            total_pages: 0,
                            completed_pages: 0,
                            percent: 0.0,
                            progress: 0.0,
                            downloaded_pages: 0,
                            message: "Khởi tạo tác vụ tải...".to_string(),
                            results: Vec::new(),
                            file_path: None,
                            file_name: None,
                            file_size_mb: None,
                            error: None,
                        };
                        let _ = evt_c.send(GuiEvent::DownloadStatus(status.clone()));

                        let run = async {
                            let source = reg_c.get(&request.source)?;
                            let manga = source.get_manga_details(&request.manga_id).await?;

                            let target_chapters = if let Some(ref ids) = request.chapter_ids {
                                manga.chapters.iter().filter(|c| ids.contains(&c.id)).cloned().collect::<Vec<_>>()
                            } else if let Some(ref sid) = request.chapter_id {
                                manga.chapters.iter().filter(|c| c.id == *sid).cloned().collect::<Vec<_>>()
                            } else {
                                manga.chapters.clone()
                            };

                            let total_chs = target_chapters.len();
                            status.total_chapters = total_chs;

                            for (i, ch) in target_chapters.into_iter().enumerate() {
                                let mut pages = ch.pages.clone();
                                if pages.is_empty() {
                                    pages = source.get_chapter_pages(&ch.id).await?;
                                }

                                status.message = format!("Đang tải Ch. {} ({}/{})...", ch.chapter_number, i + 1, total_chs);
                                status.total_pages += pages.len();
                                let _ = evt_c.send(GuiEvent::DownloadStatus(status.clone()));

                                let downloaded = dl_c.download_pages(&pages, None, ch.drm_data.as_deref(), |_, _| {}).await?;
                                status.completed_pages += downloaded.len();
                                status.downloaded_pages = status.completed_pages;

                                let packed = crate::core::formats::package_pages(&d_dir_c, &manga, &ch, &downloaded, request.format)?;
                                status.completed_chapters = i + 1;
                                status.file_path = Some(packed.to_string_lossy().to_string());
                                status.file_name = packed.file_name().and_then(|n| n.to_str()).map(|s| s.to_string());
                                status.file_size_mb = std::fs::metadata(&packed).map(|m| m.len() as f64 / (1024.0 * 1024.0)).ok();

                                let ratio = (status.completed_chapters as f64 / total_chs as f64).min(1.0);
                                status.percent = ratio * 100.0;
                                status.progress = ratio as f32;
                                let _ = evt_c.send(GuiEvent::DownloadStatus(status.clone()));
                            }

                            status.status = "completed".to_string();
                            status.percent = 100.0;
                            status.progress = 1.0;
                            status.message = format!("Hoàn tất tải về {} chương!", total_chs);
                            let _ = evt_c.send(GuiEvent::DownloadStatus(status.clone()));

                            Ok::<(), crate::error::MoeJectError>(())
                        };

                        if let Err(e) = run.await {
                            status.status = "failed".to_string();
                            status.error = Some(e.to_string());
                            status.message = format!("Lỗi tải về: {}", e);
                            let _ = evt_c.send(GuiEvent::DownloadStatus(status));
                        }
                    });
                }
                GuiCommand::ScanLibrary => {
                    tokio::spawn(async move {
                        let mut items = Vec::new();
                        if d_dir.exists() {
                            if let Ok(entries) = std::fs::read_dir(&d_dir) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    if path.is_file() {
                                        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                                        if ext == "cbz" || ext == "zip" {
                                            let meta = entry.metadata().ok();
                                            let size_mb = meta.as_ref().map(|m| m.len() as f64 / (1024.0 * 1024.0)).unwrap_or(0.0);
                                            let modified = meta.and_then(|m| m.modified().ok())
                                                .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M").to_string())
                                                .unwrap_or_else(|| "Unknown".to_string());

                                            items.push(LibraryFileItem {
                                                name: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                                                path: path.to_string_lossy().to_string(),
                                                size_mb,
                                                format: ext.to_uppercase(),
                                                modified_at: modified,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        items.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
                        let _ = evt.send(GuiEvent::LibraryScanned(items));
                    });
                }
                GuiCommand::CleanImage { image_bytes, hf_url } => {
                    tokio::spawn(async move {
                        let client = reqwest::Client::builder()
                            .timeout(std::time::Duration::from_secs(60))
                            .build()
                            .unwrap_or_default();

                        let b64 = base64::engine::general_purpose::STANDARD.encode(&image_bytes);
                        let clean_url = format!("{}/api/clean", hf_url.trim_end_matches('/'));

                        let payload = serde_json::json!({
                            "imageBase64": b64,
                            "detector": "default",
                            "inpainter": "lama_large"
                        });

                        let res = match client.post(&clean_url).json(&payload).send().await {
                            Ok(resp) => {
                                if resp.status().is_success() {
                                    match resp.json::<serde_json::Value>().await {
                                        Ok(val) => {
                                            if let Some(out_b64) = val.get("cleanedImageBase64").and_then(|v| v.as_str()) {
                                                base64::engine::general_purpose::STANDARD.decode(out_b64)
                                                    .map_err(|e| format!("Lỗi giải mã ảnh kết quả: {}", e))
                                            } else {
                                                Err("Phản hồi không chứa cleanedImageBase64".to_string())
                                            }
                                        }
                                        Err(e) => Err(format!("Lỗi parse JSON kết quả: {}", e)),
                                    }
                                } else {
                                    Err(format!("Hugging Face trả về mã lỗi: {}", resp.status()))
                                }
                            }
                            Err(e) => Err(format!("Không thể kết nối đến HF Spaces: {}", e)),
                        };

                        let _ = evt.send(GuiEvent::CleanCompleted(res));
                    });
                }
            }
        }
    });

    (cmd_tx, evt_rx)
}
