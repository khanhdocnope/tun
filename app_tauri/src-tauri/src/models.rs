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
    #[serde(default)]
    pub drm_data: Option<String>,
    #[serde(default)]
    pub fallback_urls: Vec<String>,
}

impl PageItem {
    pub fn new(page_number: usize, url: String) -> Self {
        Self {
            page_number,
            url,
            drm_data: None,
            fallback_urls: Vec::new(),
        }
    }
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum CleanerMode {
    #[default]
    Auto,
    Cloud,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)] // file settings.json cũ thiếu field mới vẫn nạp được
pub struct AppSettings {
    pub download_dir: String,
    pub max_concurrent_chapters: usize,
    pub max_connections_per_host: usize,
    pub preferred_format: String, // "cbz" or "zip"
    pub hf_space_url: String,
    pub hf_token: Option<String>,
    pub reader_mode: String, // "webtoon" or "manga"
    pub cleaner_mode: CleanerMode,
    /// Chỉ dùng ở chế độ Auto: true = thử local trước, false = thử cloud trước.
    pub auto_prefer_local: bool,
    pub local_model_dir: Option<String>,
    pub cloud_timeout_secs: u64,
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
            cleaner_mode: CleanerMode::Auto,
            auto_prefer_local: true,
            local_model_dir: None,
            cloud_timeout_secs: 120,
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
    /// "cloud" | "local" - backend thực sự đã xử lý ảnh.
    #[serde(default)]
    pub backend: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerStatus {
    pub mode: CleanerMode,
    pub cloud_available: bool,
    pub local_available: bool,
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
