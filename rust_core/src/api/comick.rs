use async_trait::async_trait;
use serde_json::Value;
use std::time::Duration;

use crate::api::MangaSource;
use crate::error::{MoeJectError, Result};
use crate::models::{Chapter, MangaInfo, MangaSearchResult, SourceMetadata};

pub struct ComickSource {
    client: reqwest::Client,
    api_url: &'static str,
    img_cdn: &'static str,
}

impl ComickSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 MoeJect-Rust/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            api_url: "https://api.comick.fun",
            img_cdn: "https://meo.comick.pictures",
        }
    }
}

#[async_trait]
impl MangaSource for ComickSource {
    fn id(&self) -> &'static str {
        "comick"
    }

    fn name(&self) -> &'static str {
        "Comick"
    }

    fn metadata(&self) -> SourceMetadata {
        SourceMetadata {
            id: "comick".to_string(),
            name: "Comick".to_string(),
            base_url: "https://comick.io".to_string(),
            icon: "auto_stories_rounded".to_string(),
            description: "Kho truyện tranh đa ngôn ngữ phong phú với API tốc độ cao".to_string(),
            language: "Multi".to_string(),
            supports_search: true,
            supports_latest: true,
        }
    }

    async fn search(&self, query: &str, page: u32) -> Result<Vec<MangaSearchResult>> {
        let trimmed = query.trim();
        let url = if trimmed.is_empty() {
            format!(
                "{}/top?type=trending&comic_types=manga&accept_mature_content=true",
                self.api_url
            )
        } else {
            format!(
                "{}/v1.0/search?q={}&page={}&limit=20",
                self.api_url,
                urlencoding::encode(trimmed),
                page.max(1)
            )
        };

        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "Comick search failed with status {}",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let items = if body.is_array() {
            body.as_array().cloned().unwrap_or_default()
        } else if let Some(arr) = body["data"].as_array() {
            arr.clone()
        } else {
            Vec::new()
        };

        let mut results = Vec::new();

        for item in items {
            let hid = item["hid"].as_str().unwrap_or("").to_string();
            let slug = item["slug"].as_str().unwrap_or(&hid).to_string();
            let title = item["title"].as_str().unwrap_or("Untitled").to_string();

            let cover_url = if let Some(bmid) = item["bmid"].as_str() {
                Some(format!("{}/{}", self.img_cdn, bmid))
            } else if let Some(md_covers) = item["md_covers"].as_array().and_then(|a| a.first()) {
                md_covers["bmid"]
                    .as_str()
                    .map(|bmid| format!("{}/{}", self.img_cdn, bmid))
            } else {
                None
            };

            let latest_chapter = item["last_chapter"].as_str().map(|s| s.to_string());
            let desc = item["desc"].as_str().map(|s| s.to_string());

            results.push(MangaSearchResult {
                id: slug.clone(),
                title,
                url: format!("https://comick.io/comic/{}", slug),
                cover_url,
                latest_chapter,
                description: desc,
                authors: Vec::new(),
                genres: Vec::new(),
            });
        }

        Ok(results)
    }

    async fn get_manga_details(&self, id_or_url: &str) -> Result<MangaInfo> {
        let slug = id_or_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .unwrap_or(id_or_url);

        let url = format!("{}/comic/{}", self.api_url, slug);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(MoeJectError::NotFound(format!(
                "Comick comic not found: {} (status {})",
                slug,
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let comic = &body["comic"];
        let hid = comic["hid"].as_str().unwrap_or(slug);
        let title = comic["title"].as_str().unwrap_or("Untitled").to_string();
        let desc = comic["desc"].as_str().map(|s| s.to_string());

        let cover_url = comic["bmid"]
            .as_str()
            .map(|bmid| format!("{}/{}", self.img_cdn, bmid));

        // Fetch chapters
        let ch_url = format!("{}/comic/{}/chapters?limit=100", self.api_url, hid);
        let ch_resp = self.client.get(&ch_url).send().await?;

        let mut chapters = Vec::new();
        if ch_resp.status().is_success() {
            let ch_body: Value = ch_resp.json().await?;
            if let Some(ch_list) = ch_body["chapters"].as_array() {
                for c in ch_list {
                    let ch_hid = c["hid"].as_str().unwrap_or("").to_string();
                    let ch_num = c["chap"].as_str().unwrap_or("0").to_string();
                    let raw_title = c["title"].as_str().unwrap_or("");
                    let display_title = if raw_title.is_empty() {
                        format!("Chapter {}", ch_num)
                    } else {
                        format!("Ch. {} - {}", ch_num, raw_title)
                    };

                    chapters.push(Chapter {
                        id: ch_hid.clone(),
                        title: display_title,
                        chapter_number: ch_num,
                        url: format!("https://comick.io/comic/{}/{}", slug, ch_hid),
                        scanlator: None,
                        pages: Vec::new(),
                        drm_data: None,
                    });
                }
            }
        }

        Ok(MangaInfo {
            id: slug.to_string(),
            title,
            url: format!("https://comick.io/comic/{}", slug),
            cover_url,
            description: desc,
            authors: Vec::new(),
            genres: Vec::new(),
            chapters,
        })
    }

    async fn get_chapter_pages(&self, chapter_id_or_url: &str) -> Result<Vec<String>> {
        let ch_hid = chapter_id_or_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .unwrap_or(chapter_id_or_url);

        let url = format!("{}/chapter/{}", self.api_url, ch_hid);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "Failed to fetch Comick chapter pages (status {})",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let mut pages = Vec::new();

        if let Some(images) = body["chapter"]["images"].as_array() {
            for img in images {
                if let Some(bmid) = img["bmid"].as_str() {
                    pages.push(format!("{}/{}", self.img_cdn, bmid));
                } else if let Some(url_str) = img["url"].as_str() {
                    pages.push(url_str.to_string());
                }
            }
        }

        Ok(pages)
    }
}
