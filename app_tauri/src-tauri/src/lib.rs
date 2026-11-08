pub mod models;
pub mod sources;
pub mod downloader;
pub mod packager;
pub mod cleaner;
pub mod library;
pub mod commands;
#[cfg(test)]
mod tests;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            search_manga,
            get_manga_chapters,
            get_chapter_pages,
            start_download,
            get_download_queue,
            get_library_books,
            get_page_image_base64,
            clean_image,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
