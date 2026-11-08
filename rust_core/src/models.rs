use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Images,
    Zip,
    Cbz,
    Pdf,
}

impl Default for OutputFormat {
    fn default() -> Self {
        OutputFormat::Cbz
    }
}

impl OutputFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            OutputFormat::Images => "images",
            OutputFormat::Zip => "zip",
            OutputFormat::Cbz => "cbz",
            OutputFormat::Pdf => "pdf",
        }
    }
}

impl std::fmt::Display for OutputFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for OutputFormat {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "images" | "raw" => Ok(OutputFormat::Images),
            "zip" => Ok(OutputFormat::Zip),
            "cbz" => Ok(OutputFormat::Cbz),
            "pdf" => Ok(OutputFormat::Pdf),
            other => Err(format!("Unknown output format: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub chapter_number: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanlator: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drm_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaSearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_chapter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub genres: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaInfo {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMetadata {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub icon: String,
    pub description: String,
    pub language: String,
    pub supports_search: bool,
    pub supports_latest: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadTaskRequest {
    #[serde(alias = "source_id")]
    pub source: String,
    pub manga_id: String,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub chapter_ids: Option<Vec<String>>,
    #[serde(default)]
    pub chapters: Option<String>,
    #[serde(default)]
    pub format: OutputFormat,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterDownloadResult {
    pub chapter_id: String,
    pub chapter_number: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    pub page_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTaskStatus {
    pub task_id: String,
    pub status: String,
    pub source_id: String,
    pub manga_id: String,
    pub format: String,
    pub total_chapters: usize,
    pub completed_chapters: usize,
    pub total_pages: usize,
    pub completed_pages: usize,
    pub percent: f64,
    pub progress: f32,
    pub downloaded_pages: usize,
    pub message: String,
    #[serde(default)]
    pub results: Vec<ChapterDownloadResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_mb: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFileItem {
    pub name: String,
    pub path: String,
    pub size_mb: f64,
    pub format: String,
    pub modified_at: String,
}
