use crate::cleaner::cloud::CloudCleaner;
use crate::cleaner::local::LocalCleaner;
use crate::cleaner::{clean_with_mode, CleanParams, Cleaner};
use crate::settings as settings_store;
use base64::Engine;
use crate::downloader::{execute_download, HostGate, TaskManager};
use crate::library::scanner::{get_archive_page_base64, scan_library_dir};
use crate::models::{AppSettings, ChapterItem, CleanRequest, CleanResponse, CleanerStatus, DownloadStatus, DownloadTask, LibraryBook, MangaItem, PageItem};
use crate::sources::comick::ComickSource;
use crate::sources::cuutruyen::CuutruyenSource;
use crate::sources::hitomi::HitomiSource;
use crate::sources::mangadex::MangaDexSource;
use crate::sources::templates::madara::MadaraTemplate;
use crate::sources::templates::mangastream::MangaStreamTemplate;
use crate::sources::MangaSource;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

pub struct AppState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub queue: Arc<Mutex<Vec<DownloadTask>>>,
    pub host_gate: Arc<HostGate>,
    pub task_manager: Arc<TaskManager>,
    pub mangadex: MangaDexSource,
    pub comick: ComickSource,
    pub hitomi: HitomiSource,
    pub cuutruyen: CuutruyenSource,
    pub asurascans: MangaStreamTemplate,
    pub manganato: MadaraTemplate,
}

impl AppState {
    pub fn new() -> Self {
        let default_settings = AppSettings::default();
        let max_host = default_settings.max_connections_per_host;
        Self {
            settings: Arc::new(Mutex::new(default_settings)),
            queue: Arc::new(Mutex::new(Vec::new())),
            host_gate: Arc::new(HostGate::new(max_host)),
            task_manager: Arc::new(TaskManager::new()),
            mangadex: MangaDexSource::new(),
            comick: ComickSource::new(),
            hitomi: HitomiSource::new(),
            cuutruyen: CuutruyenSource::new(),
            asurascans: MangaStreamTemplate::new("asurascans", "Asura Scans", "https://asuracomic.net"),
            manganato: MadaraTemplate::new("manganato", "MangaNato", "https://manganato.com"),
        }
    }
}

#[tauri::command]
pub async fn search_manga(
    source: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<MangaItem>, String> {
    match source.as_str() {
        "mangadex" => state.mangadex.search(&query).await,
        "comick" => state.comick.search(&query).await,
        "hitomi" => state.hitomi.search(&query).await,
        "cuutruyen" => state.cuutruyen.search(&query).await,
        "asurascans" => state.asurascans.search(&query).await,
        "manganato" => state.manganato.search(&query).await,
        _ => Err(format!("Unsupported source: {}", source)),
    }
}

#[tauri::command]
pub async fn get_manga_chapters(
    source: String,
    manga_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChapterItem>, String> {
    match source.as_str() {
        "mangadex" => state.mangadex.get_chapters(&manga_id).await,
        "comick" => state.comick.get_chapters(&manga_id).await,
        "hitomi" => state.hitomi.get_chapters(&manga_id).await,
        "cuutruyen" => state.cuutruyen.get_chapters(&manga_id).await,
        "asurascans" => state.asurascans.get_chapters(&manga_id).await,
        "manganato" => state.manganato.get_chapters(&manga_id).await,
        _ => Err(format!("Unsupported source: {}", source)),
    }
}

#[tauri::command]
pub async fn get_chapter_pages(
    source: String,
    chapter_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PageItem>, String> {
    match source.as_str() {
        "mangadex" => state.mangadex.get_pages(&chapter_id).await,
        "comick" => state.comick.get_pages(&chapter_id).await,
        "hitomi" => state.hitomi.get_pages(&chapter_id).await,
        "cuutruyen" => state.cuutruyen.get_pages(&chapter_id).await,
        "asurascans" => state.asurascans.get_pages(&chapter_id).await,
        "manganato" => state.manganato.get_pages(&chapter_id).await,
        _ => Err(format!("Unsupported source: {}", source)),
    }
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    task: DownloadTask,
    source: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Get pages
    let pages = match source.as_str() {
        "mangadex" => state.mangadex.get_pages(&task.chapter_id).await?,
        "comick" => state.comick.get_pages(&task.chapter_id).await?,
        "hitomi" => state.hitomi.get_pages(&task.chapter_id).await?,
        "cuutruyen" => state.cuutruyen.get_pages(&task.chapter_id).await?,
        "asurascans" => state.asurascans.get_pages(&task.chapter_id).await?,
        "manganato" => state.manganato.get_pages(&task.chapter_id).await?,
        _ => return Err(format!("Unknown source: {}", source)),
    };

    let download_dir = {
        let s = state.settings.lock().await;
        s.download_dir.clone()
    };

    // 2. Add to queue
    {
        let mut q = state.queue.lock().await;
        q.push(task.clone());
    }

    let cancel_flag = state.task_manager.register(&task.id).await;
    let host_gate = state.host_gate.clone();
    let task_manager = state.task_manager.clone();
    let task_id_clone = task.id.clone();

    // 3. Spawn background download
    tokio::spawn(async move {
        let _ = execute_download(app, task, pages, download_dir, host_gate, cancel_flag).await;
        task_manager.unregister(&task_id_clone).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_download(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let cancelled = state.task_manager.cancel(&task_id).await;
    let mut q = state.queue.lock().await;
    if let Some(t) = q.iter_mut().find(|t| t.id == task_id) {
        t.status = DownloadStatus::Cancelled;
    }
    Ok(cancelled)
}

#[tauri::command]
pub async fn get_download_queue(state: State<'_, AppState>) -> Result<Vec<DownloadTask>, String> {
    let q = state.queue.lock().await;
    Ok(q.clone())
}

#[tauri::command]
pub async fn get_library_books(
    download_dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<LibraryBook>, String> {
    let dir_str = match download_dir {
        Some(d) => d,
        None => {
            let s = state.settings.lock().await;
            s.download_dir.clone()
        }
    };
    let path = PathBuf::from(dir_str);
    Ok(scan_library_dir(&path))
}

#[tauri::command]
pub async fn get_page_image_base64(archive_path: String, page_index: usize) -> Result<String, String> {
    get_archive_page_base64(&archive_path, page_index)
}

fn build_cleaners(s: &AppSettings) -> (CloudCleaner, LocalCleaner) {
    (
        CloudCleaner::new(&s.hf_space_url, s.hf_token.clone(), s.cloud_timeout_secs),
        LocalCleaner::new(s.local_model_dir.as_ref().map(PathBuf::from)),
    )
}

#[tauri::command]
pub async fn clean_image(
    req: CleanRequest,
    state: State<'_, AppState>,
) -> Result<CleanResponse, String> {
    let started = std::time::Instant::now();
    let settings = state.settings.lock().await.clone();

    // Chấp nhận cả data URL lẫn base64 thuần.
    let raw_b64 = req.image_base64.split_once(',').map(|(_, b)| b).unwrap_or(&req.image_base64);
    let image = base64::engine::general_purpose::STANDARD
        .decode(raw_b64.trim())
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let params = CleanParams {
        detector: req.detector,
        inpainter: req.inpainter,
        dilation_offset: req.dilation_offset,
        clean_mode: req.clean_mode,
    };

    let (cloud, local) = build_cleaners(&settings);
    let out = clean_with_mode(
        settings.cleaner_mode,
        settings.auto_prefer_local,
        &cloud,
        &local,
        &image,
        &params,
    )
    .await?;

    Ok(CleanResponse {
        cleaned_image_base64: base64::engine::general_purpose::STANDARD.encode(&out.image),
        time_taken: Some(format!("{:.2}s", started.elapsed().as_secs_f32())),
        backend: Some(out.backend.to_string()),
        mime: Some(out.mime.to_string()),
    })
}

#[tauri::command]
pub async fn get_cleaner_status(state: State<'_, AppState>) -> Result<CleanerStatus, String> {
    let settings = state.settings.lock().await.clone();
    let (cloud, local) = build_cleaners(&settings);
    let (cloud_available, local_available) = tokio::join!(cloud.is_available(), local.is_available());
    Ok(CleanerStatus {
        mode: settings.cleaner_mode,
        cloud_available,
        local_available,
    })
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().await;
    Ok(s.clone())
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    settings_store::save(&app, &settings)?;
    let mut s = state.settings.lock().await;
    *s = settings;
    Ok(())
}
