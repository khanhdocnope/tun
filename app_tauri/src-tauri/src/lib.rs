pub mod models;
pub mod sources;
pub mod downloader;
pub mod packager;
pub mod cleaner;
pub mod library;
pub mod local;
pub mod settings;
pub mod vision;
pub mod commands;
#[cfg(test)]
mod tests;

use commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .setup(|app| {
            let loaded = settings::load(app.handle());
            let state = app.state::<AppState>();
            tauri::async_runtime::block_on(async {
                *state.settings.lock().await = loaded;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_available_sources,
            list_catalog_sources,
            search_manga,
            get_manga_chapters,
            get_chapter_pages,
            start_download,
            cancel_download,
            get_download_queue,
            get_library_books,
            get_page_image_base64,
            clean_image,
            get_cleaner_status,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
