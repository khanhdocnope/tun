use crate::cleaner::client::HfSpaceCleanerClient;
use crate::downloader::pool::execute_download;
use crate::library::scanner::{get_archive_page_base64, scan_library_dir};
use crate::models::{AppSettings, ChapterItem, CleanRequest, CleanResponse, DownloadTask, LibraryBook, MangaItem, PageItem};
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
    pub mangadex: MangaDexSource,
    pub comick: ComickSource,
    pub hitomi: HitomiSource,
    pub cuutruyen: CuutruyenSource,
    pub asurascans: MangaStreamTemplate,
    pub manganato: MadaraTemplate,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            settings: Arc::new(Mutex::new(AppSettings::default())),
            queue: Arc::new(Mutex::new(Vec::new())),
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

    // 3. Spawn background download
    tokio::spawn(async move {
        let _ = execute_download(app, task, pages, download_dir).await;
    });

    Ok(())
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

#[tauri::command]
pub async fn clean_image(
    req: CleanRequest,
    state: State<'_, AppState>,
) -> Result<CleanResponse, String> {
    let (url, token) = {
        let s = state.settings.lock().await;
        (s.hf_space_url.clone(), s.hf_token.clone())
    };
    let client = HfSpaceCleanerClient::new(Some(url), token);
    client.clean_image(&req).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let s = state.settings.lock().await;
    Ok(s.clone())
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut s = state.settings.lock().await;
    *s = settings;
    Ok(())
}
