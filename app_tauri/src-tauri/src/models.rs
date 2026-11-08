use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaItem {
    pub id: String,
    pub title: String,
    pub cover_url: String,
    pub source: String,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub status: Option<String>,
    pub genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterItem {
    pub id: String,
    pub manga_id: String,
    pub chapter_number: f64,
    pub title: String,
    pub source: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageItem {
    pub page_number: usize,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Packaging,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub manga_id: String,
    pub manga_title: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub status: DownloadStatus,
    pub total_pages: usize,
    pub downloaded_pages: usize,
    pub file_format: String, // "cbz" or "zip"
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub download_dir: String,
    pub max_concurrent_chapters: usize,
    pub max_connections_per_host: usize,
    pub preferred_format: String, // "cbz" or "zip"
    pub hf_space_url: String,
    pub hf_token: Option<String>,
    pub reader_mode: String, // "webtoon" or "manga"
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: "downloads".to_string(),
            max_concurrent_chapters: 2,
            max_connections_per_host: 5,
            preferred_format: "cbz".to_string(),
            hf_space_url: "https://dobietdc-manga-text-cleaner.hf.space".to_string(),
            hf_token: None,
            reader_mode: "webtoon".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanRequest {
    pub image_base64: String,
    pub detector: String, // "default" or "ctd"
    pub inpainter: String, // "lama_large"
    pub dilation_offset: i32,
    pub clean_mode: String, // "all" or "bubble_only"
    pub max_dim: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanResponse {
    pub cleaned_image_base64: String,
    pub time_taken: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryBook {
    pub file_name: String,
    pub file_path: String,
    pub manga_title: String,
    pub chapter_title: String,
    pub total_pages: usize,
    pub cover_base64: Option<String>,
    pub file_format: String, // "cbz" or "zip"
}
