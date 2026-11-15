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
use crate::sources::templates::mojoportal::MojoPortalTemplate;
use crate::sources::catalog::{find_source_by_id, is_template_supported, search_catalog_sources, SourceCatalogEntry};
use crate::sources::MangaSource;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub language: String,
    pub is_custom: bool,
}

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
    pub nettruyen: MojoPortalTemplate,
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
            nettruyen: MojoPortalTemplate::new("nettruyen", "NetTruyen", "https://nettruyenx.com"),
        }
    }
}

async fn dispatch_search(source: &str, query: &str, state: &AppState) -> Result<Vec<MangaItem>, String> {
    match source {
        "mangadex" => state.mangadex.search(query).await,
        "comick" => state.comick.search(query).await,
        "hitomi" => state.hitomi.search(query).await,
        "cuutruyen" => state.cuutruyen.search(query).await,
        "asura" | "asurascans" => state.asurascans.search(query).await,
        "manganato" => state.manganato.search(query).await,
        "nettruyen" => state.nettruyen.search(query).await,
        other => {
            if let Some(entry) = find_source_by_id(other) {
                match entry.template.as_str() {
                    "WordPressMadara" => {
                        let inst = MadaraTemplate::new(entry.id, entry.name, entry.url);
                        inst.search(query).await
                    }
                    "WordPressMangastream" => {
                        let inst = MangaStreamTemplate::new(entry.id, entry.name, entry.url);
                        inst.search(query).await
                    }
                    "MojoPortalComic" => {
                        let inst = MojoPortalTemplate::new(entry.id, entry.name, entry.url);
                        inst.search(query).await
                    }
                    tmpl => Err(format!(
                        "Nguồn '{}' sử dụng template '{}' chưa được hỗ trợ scraper tự động.",
                        entry.name, tmpl
                    )),
                }
            } else {
                Err(format!("Không tìm thấy nguồn: {}", other))
            }
        }
    }
}

async fn dispatch_chapters(source: &str, manga_id: &str, state: &AppState) -> Result<Vec<ChapterItem>, String> {
    match source {
        "mangadex" => state.mangadex.get_chapters(manga_id).await,
        "comick" => state.comick.get_chapters(manga_id).await,
        "hitomi" => state.hitomi.get_chapters(manga_id).await,
        "cuutruyen" => state.cuutruyen.get_chapters(manga_id).await,
        "asura" | "asurascans" => state.asurascans.get_chapters(manga_id).await,
        "manganato" => state.manganato.get_chapters(manga_id).await,
        "nettruyen" => state.nettruyen.get_chapters(manga_id).await,
        other => {
            if let Some(entry) = find_source_by_id(other) {
                match entry.template.as_str() {
                    "WordPressMadara" => {
                        let inst = MadaraTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_chapters(manga_id).await
                    }
                    "WordPressMangastream" => {
                        let inst = MangaStreamTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_chapters(manga_id).await
                    }
                    "MojoPortalComic" => {
                        let inst = MojoPortalTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_chapters(manga_id).await
                    }
                    tmpl => Err(format!(
                        "Nguồn '{}' sử dụng template '{}' chưa được hỗ trợ scraper tự động.",
                        entry.name, tmpl
                    )),
                }
            } else {
                Err(format!("Không tìm thấy nguồn: {}", other))
            }
        }
    }
}

async fn dispatch_pages(source: &str, chapter_id: &str, state: &AppState) -> Result<Vec<PageItem>, String> {
    match source {
        "mangadex" => state.mangadex.get_pages(chapter_id).await,
        "comick" => state.comick.get_pages(chapter_id).await,
        "hitomi" => state.hitomi.get_pages(chapter_id).await,
        "cuutruyen" => state.cuutruyen.get_pages(chapter_id).await,
        "asura" | "asurascans" => state.asurascans.get_pages(chapter_id).await,
        "manganato" => state.manganato.get_pages(chapter_id).await,
        "nettruyen" => state.nettruyen.get_pages(chapter_id).await,
        other => {
            if let Some(entry) = find_source_by_id(other) {
                match entry.template.as_str() {
                    "WordPressMadara" => {
                        let inst = MadaraTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_pages(chapter_id).await
                    }
                    "WordPressMangastream" => {
                        let inst = MangaStreamTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_pages(chapter_id).await
                    }
                    "MojoPortalComic" => {
                        let inst = MojoPortalTemplate::new(entry.id, entry.name, entry.url);
                        inst.get_pages(chapter_id).await
                    }
                    tmpl => Err(format!(
                        "Nguồn '{}' sử dụng template '{}' chưa được hỗ trợ scraper tự động.",
                        entry.name, tmpl
                    )),
                }
            } else {
                Err(format!("Không tìm thấy nguồn: {}", other))
            }
        }
    }
}

#[tauri::command]
pub async fn get_available_sources() -> Result<Vec<SourceInfo>, String> {
    Ok(vec![
        SourceInfo {
            id: "mangadex".into(),
            name: "MangaDex".into(),
            url: "https://mangadex.org".into(),
            language: "Multi".into(),
            is_custom: true,
        },
        SourceInfo {
            id: "comick".into(),
            name: "ComicK".into(),
            url: "https://comick.io".into(),
            language: "Multi".into(),
            is_custom: true,
        },
        SourceInfo {
            id: "cuutruyen".into(),
            name: "Cứu Truyện".into(),
            url: "https://cuutruyen.net".into(),
            language: "vi".into(),
            is_custom: true,
        },
        SourceInfo {
            id: "nettruyen".into(),
            name: "NetTruyen".into(),
            url: "https://nettruyenx.com".into(),
            language: "vi".into(),
            is_custom: false,
        },
        SourceInfo {
            id: "asurascans".into(),
            name: "Asura Scans".into(),
            url: "https://asuracomic.net".into(),
            language: "en".into(),
            is_custom: false,
        },
        SourceInfo {
            id: "manganato".into(),
            name: "MangaNato".into(),
            url: "https://manganato.com".into(),
            language: "en".into(),
            is_custom: false,
        },
        SourceInfo {
            id: "hitomi".into(),
            name: "Hitomi.la".into(),
            url: "https://hitomi.la".into(),
            language: "Multi".into(),
            is_custom: true,
        },
    ])
}

#[tauri::command]
pub async fn list_catalog_sources(
    query: Option<String>,
    lang: Option<String>,
    only_supported: Option<bool>,
) -> Result<Vec<SourceCatalogEntry>, String> {
    let q = query.unwrap_or_default();
    let l = lang.as_deref();
    let mut results = search_catalog_sources(&q, l);
    if only_supported.unwrap_or(false) {
        results.retain(|s| is_template_supported(&s.template));
    }
    Ok(results)
}

#[tauri::command]
pub async fn search_manga(
    source: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<MangaItem>, String> {
    dispatch_search(&source, &query, &state).await
}

#[tauri::command]
pub async fn get_manga_chapters(
    source: String,
    manga_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChapterItem>, String> {
    dispatch_chapters(&source, &manga_id, &state).await
}

#[tauri::command]
pub async fn get_chapter_pages(
    source: String,
    chapter_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PageItem>, String> {
    dispatch_pages(&source, &chapter_id, &state).await
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    task: DownloadTask,
    source: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 1. Get pages via dynamic dispatcher
    let pages = dispatch_pages(&source, &task.chapter_id, &state).await?;

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
pub async fn start_browser_download(
    app: AppHandle,
    urls: Vec<String>,
    manga_title: String,
    chapter_title: String,
    format: Option<String>,
    _referer: Option<String>,
    _cookies: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if urls.is_empty() {
        return Err("Danh sách URL ảnh từ trình duyệt trống".to_string());
    }

    let download_dir = {
        let s = state.settings.lock().await;
        s.download_dir.clone()
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let task_id = format!("browser-{}", timestamp);

    let pages: Vec<PageItem> = urls
        .into_iter()
        .enumerate()
        .map(|(i, url)| PageItem {
            page_number: i + 1,
            url,
            drm_data: None,
            fallback_urls: vec![],
        })
        .collect();

    let task = DownloadTask {
        id: task_id.clone(),
        manga_id: "browser".to_string(),
        manga_title,
        chapter_title,
        chapter_id: "browser".to_string(),
        total_pages: pages.len(),
        downloaded_pages: 0,
        status: DownloadStatus::Downloading,
        file_format: format.unwrap_or_else(|| "cbz".to_string()),
        error_message: None,
    };

    {
        let mut q = state.queue.lock().await;
        q.push(task.clone());
    }

    let cancel_flag = state.task_manager.register(&task.id).await;
    let host_gate = state.host_gate.clone();
    let task_manager = state.task_manager.clone();
    let task_id_clone = task.id.clone();

    tokio::spawn(async move {
        let _ = execute_download(app, task, pages, download_dir, host_gate, cancel_flag).await;
        task_manager.unregister(&task_id_clone).await;
    });

    Ok(task_id)
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

#[tauri::command]
pub async fn get_image_base64(url: String, source: Option<String>) -> Result<String, String> {
    if url.is_empty() {
        return Err("Empty image URL".to_string());
    }
    let client = crate::sources::new_manga_client();
    let mut req = client.get(&url);
    let src_ref = source.as_deref().unwrap_or("");
    if src_ref == "hitomi" || url.contains("gold-usergeneratedcontent.net") || url.contains("hitomi.la") {
        req = req.header("Referer", "https://hitomi.la/");
    } else if src_ref == "cuutruyen" || url.contains("cuutruyen") {
        req = req.header("Referer", "https://cuutruyen.net/");
    } else if src_ref == "mangadex" || url.contains("mangadex.org") {
        req = req.header("User-Agent", "MoeJect/1.0");
    }

    let resp = req.send().await.map_err(|e| format!("Fetch image failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url));
    }
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| format!("Read image bytes failed: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub async fn open_browser_pane(
    app: AppHandle,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let window = app.get_window("main").ok_or("Không tìm thấy cửa sổ chính")?;
        let pos = LogicalPosition::new(bounds.x, bounds.y);
        let size = LogicalSize::new(bounds.width.max(100.0), bounds.height.max(100.0));

        if let Some(webview) = app.get_webview("manga-browser-pane") {
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
            if let Ok(parsed) = url.parse::<Url>() {
                let _ = webview.navigate(parsed);
            }
            let _ = webview.show();
            return Ok(());
        }

        let parsed = url.parse::<Url>().map_err(|e| format!("URL không hợp lệ: {}", e))?;
        let webview_builder = tauri::webview::WebviewBuilder::new(
            "manga-browser-pane",
            WebviewUrl::External(parsed),
        );

        window.add_child(webview_builder, pos, size)
            .map_err(|e| format!("Lỗi tạo native browser pane: {}", e))?;
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        Err("Child webview không hỗ trợ trên nền tảng này".to_string())
    }
}

#[tauri::command]
pub async fn hide_browser_pane(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(webview) = app.get_webview("manga-browser-pane") {
            let _ = webview.hide();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn update_browser_bounds(app: AppHandle, bounds: BrowserBounds) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(webview) = app.get_webview("manga-browser-pane") {
            let pos = LogicalPosition::new(bounds.x, bounds.y);
            let size = LogicalSize::new(bounds.width.max(100.0), bounds.height.max(100.0));
            let _ = webview.set_position(pos);
            let _ = webview.set_size(size);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(webview) = app.get_webview("manga-browser-pane") {
            if let Ok(parsed) = url.parse::<Url>() {
                let _ = webview.navigate(parsed);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_action(app: AppHandle, action: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(webview) = app.get_webview("manga-browser-pane") {
            match action.as_str() {
                "back" => { let _ = webview.eval("window.history.back()"); }
                "forward" => { let _ = webview.eval("window.history.forward()"); }
                "reload" => { let _ = webview.reload(); }
                _ => {}
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_eval(app: AppHandle, script: String) -> Result<String, String> {
    #[cfg(desktop)]
    {
        let webview = app.get_webview("manga-browser-pane").ok_or("Trình duyệt chưa sẵn sàng")?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let tx_cell = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
        webview.eval_with_callback(script, move |res| {
            if let Ok(mut lock) = tx_cell.lock() {
                if let Some(sender) = lock.take() {
                    let _ = sender.send(res);
                }
            }
        }).map_err(|e| format!("Lỗi eval: {}", e))?;

        rx.await.map_err(|e| format!("Lỗi nhận kết quả eval: {}", e))
    }
    #[cfg(not(desktop))]
    {
        Err("Không hỗ trợ eval trên nền tảng này".to_string())
    }
}
