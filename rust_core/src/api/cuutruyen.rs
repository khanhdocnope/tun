use async_trait::async_trait;
use serde_json::Value;
use std::time::Duration;

use crate::api::MangaSource;
use crate::error::{MoeJectError, Result};
use crate::models::{Chapter, MangaInfo, MangaSearchResult, SourceMetadata};

pub struct CuuTruyenSource {
    client: reqwest::Client,
    api_url: &'static str,
}

impl CuuTruyenSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoeJect-Rust/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            api_url: "https://cuutruyen.net/api/v2",
        }
    }
}

#[async_trait]
impl MangaSource for CuuTruyenSource {
    fn id(&self) -> &'static str {
        "cuutruyen"
    }

    fn name(&self) -> &'static str {
        "Cứu Truyện"
    }

    fn metadata(&self) -> SourceMetadata {
        SourceMetadata {
            id: "cuutruyen".to_string(),
            name: "Cứu Truyện".to_string(),
            base_url: "https://cuutruyen.net".to_string(),
            icon: "menu_book_rounded".to_string(),
            description: "Kho truyện tranh dịch tiếng Việt chất lượng cao và có bản quyền".to_string(),
            language: "Tiếng Việt".to_string(),
            supports_search: true,
            supports_latest: true,
        }
    }

    async fn search(&self, query: &str, page: u32) -> Result<Vec<MangaSearchResult>> {
        let trimmed = query.trim();
        let url = if trimmed.is_empty() {
            format!("{}/mangas/recently_updated?page={}", self.api_url, page.max(1))
        } else {
            format!(
                "{}/mangas/search?q={}&page={}",
                self.api_url,
                urlencoding::encode(trimmed),
                page.max(1)
            )
        };

        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "CuuTruyen search failed with status {}",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let items = body["data"].as_array().cloned().unwrap_or_default();
        let mut results = Vec::new();

        for item in items {
            let id = item["id"].as_i64().map(|v| v.to_string()).unwrap_or_default();
            if id.is_empty() {
                continue;
            }

            let title = item["name"].as_str().unwrap_or("Untitled").to_string();
            let cover_url = item["cover_url"].as_str().map(|s| s.to_string());
            let desc = item["description"].as_str().map(|s| s.to_string());

            results.push(MangaSearchResult {
                id: id.clone(),
                title,
                url: format!("https://cuutruyen.net/mangas/{}", id),
                cover_url,
                latest_chapter: None,
                description: desc,
                authors: Vec::new(),
                genres: Vec::new(),
            });
        }

        Ok(results)
    }

    async fn get_manga_details(&self, id_or_url: &str) -> Result<MangaInfo> {
        let id = id_or_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .unwrap_or(id_or_url);

        let url = format!("{}/mangas/{}", self.api_url, id);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(MoeJectError::NotFound(format!(
                "CuuTruyen manga not found: {} (status {})",
                id,
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let data = &body["data"];
        let title = data["name"].as_str().unwrap_or("Untitled").to_string();
        let desc = data["description"].as_str().map(|s| s.to_string());
        let cover_url = data["cover_url"].as_str().map(|s| s.to_string());

        let mut chapters = Vec::new();
        if let Some(ch_list) = data["chapters"].as_array() {
            for c in ch_list {
                let ch_id = c["id"].as_i64().map(|v| v.to_string()).unwrap_or_default();
                let ch_num = c["number"].as_str().unwrap_or("0").to_string();
                let raw_title = c["name"].as_str().unwrap_or("");
                let display_title = if raw_title.is_empty() {
                    format!("Chapter {}", ch_num)
                } else {
                    format!("Ch. {} - {}", ch_num, raw_title)
                };

                chapters.push(Chapter {
                    id: ch_id.clone(),
                    title: display_title,
                    chapter_number: ch_num,
                    url: format!("https://cuutruyen.net/mangas/{}/chapters/{}", id, ch_id),
                    scanlator: None,
                    pages: Vec::new(),
                    drm_data: None,
                });
            }
        }

        Ok(MangaInfo {
            id: id.to_string(),
            title,
            url: format!("https://cuutruyen.net/mangas/{}", id),
            cover_url,
            description: desc,
            authors: Vec::new(),
            genres: Vec::new(),
            chapters,
        })
    }

    async fn get_chapter_pages(&self, chapter_id_or_url: &str) -> Result<Vec<String>> {
        let ch_id = chapter_id_or_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .unwrap_or(chapter_id_or_url);

        let url = format!("{}/chapters/{}/pages", self.api_url, ch_id);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "Failed to fetch CuuTruyen chapter pages (status {})",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let mut pages = Vec::new();

        if let Some(data) = body["data"].as_array() {
            for p in data {
                if let Some(src) = p["src"].as_str() {
                    pages.push(src.to_string());
                }
            }
        }

        Ok(pages)
    }
}
