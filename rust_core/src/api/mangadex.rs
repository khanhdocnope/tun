use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;
use std::time::Duration;

use crate::api::MangaSource;
use crate::error::{MoeJectError, Result};
use crate::models::{Chapter, MangaInfo, MangaSearchResult, SourceMetadata};

pub struct MangaDexSource {
    client: reqwest::Client,
    api_url: &'static str,
    uploads_url: &'static str,
}

impl MangaDexSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent("MoeJect-Rust/1.0.0 (High-Performance Manga Engine)")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            api_url: "https://api.mangadex.org",
            uploads_url: "https://uploads.mangadex.org",
        }
    }

    fn extract_uuid(&self, input: &str) -> Option<String> {
        let re = Regex::new(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        )
        .ok()?;
        re.find(input).map(|m| m.as_str().to_string())
    }
}

#[async_trait]
impl MangaSource for MangaDexSource {
    fn id(&self) -> &'static str {
        "mangadex"
    }

    fn name(&self) -> &'static str {
        "MangaDex"
    }

    fn metadata(&self) -> SourceMetadata {
        SourceMetadata {
            id: "mangadex".to_string(),
            name: "MangaDex".to_string(),
            base_url: "https://mangadex.org".to_string(),
            icon: "menu_book_rounded".to_string(),
            description: "Nguồn truyện tranh toàn cầu lớn nhất với API v5 chính thức".to_string(),
            language: "Multi".to_string(),
            supports_search: true,
            supports_latest: true,
        }
    }

    async fn search(&self, query: &str, page: u32) -> Result<Vec<MangaSearchResult>> {
        let limit = 20;
        let offset = (page.max(1) - 1) * limit;

        let trimmed = query.trim();
        let url = if trimmed.is_empty() {
            format!(
                "{}/manga?limit={}&offset={}&includes[]=cover_art&order[latestUploadedChapter]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica",
                self.api_url, limit, offset
            )
        } else {
            format!(
                "{}/manga?title={}&limit={}&offset={}&includes[]=cover_art&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica",
                self.api_url,
                urlencoding::encode(trimmed),
                limit,
                offset
            )
        };

        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "MangaDex search failed with HTTP status {}",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let data = body["data"].as_array().ok_or_else(|| {
            MoeJectError::Parse("Missing 'data' array in MangaDex response".to_string())
        })?;

        let mut results = Vec::new();

        for item in data {
            let id = item["id"].as_str().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }

            let attributes = &item["attributes"];
            let title = attributes["title"]["en"]
                .as_str()
                .or_else(|| attributes["title"]["ja-ro"].as_str())
                .or_else(|| attributes["title"]["vi"].as_str())
                .or_else(|| {
                    attributes["altTitles"]
                        .as_array()
                        .and_then(|arr| arr.first())
                        .and_then(|obj| obj.as_object())
                        .and_then(|m| m.values().next())
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("Unknown Title")
                .to_string();

            let description = attributes["description"]["en"]
                .as_str()
                .or_else(|| attributes["description"]["vi"].as_str())
                .map(|s| s.to_string());

            let mut cover_url = None;
            if let Some(relationships) = item["relationships"].as_array() {
                for rel in relationships {
                    if rel["type"].as_str() == Some("cover_art") {
                        if let Some(file_name) = rel["attributes"]["fileName"].as_str() {
                            cover_url = Some(format!(
                                "{}/covers/{}/{}.256.jpg",
                                self.uploads_url, id, file_name
                            ));
                            break;
                        }
                    }
                }
            }

            let latest_chapter = attributes["latestUploadedChapter"]
                .as_str()
                .map(|s| s.to_string());

            results.push(MangaSearchResult {
                id: id.clone(),
                title,
                url: format!("https://mangadex.org/title/{}", id),
                cover_url,
                latest_chapter,
                description,
                authors: Vec::new(),
                genres: Vec::new(),
            });
        }

        Ok(results)
    }

    async fn get_manga_details(&self, id_or_url: &str) -> Result<MangaInfo> {
        let manga_id = self.extract_uuid(id_or_url).unwrap_or_else(|| id_or_url.to_string());

        let url = format!(
            "{}/manga/{}?includes[]=cover_art&includes[]=author&includes[]=artist",
            self.api_url, manga_id
        );

        let resp = self.client.get(&url).send().await?;
        if resp.status().as_u16() == 404 {
            return Err(MoeJectError::NotFound(format!("Manga not found: {}", manga_id)));
        }

        let body: Value = resp.json().await?;
        let data = &body["data"];
        let attributes = &data["attributes"];

        let title = attributes["title"]["en"]
            .as_str()
            .or_else(|| attributes["title"]["ja-ro"].as_str())
            .or_else(|| attributes["title"]["vi"].as_str())
            .unwrap_or("Unknown Title")
            .to_string();

        let description = attributes["description"]["en"]
            .as_str()
            .or_else(|| attributes["description"]["vi"].as_str())
            .map(|s| s.to_string());

        let mut cover_url = None;
        let mut authors = Vec::new();

        if let Some(relationships) = data["relationships"].as_array() {
            for rel in relationships {
                let rel_type = rel["type"].as_str().unwrap_or("");
                if rel_type == "cover_art" {
                    if let Some(file_name) = rel["attributes"]["fileName"].as_str() {
                        cover_url = Some(format!(
                            "{}/covers/{}/{}.512.jpg",
                            self.uploads_url, manga_id, file_name
                        ));
                    }
                } else if rel_type == "author" || rel_type == "artist" {
                    if let Some(name) = rel["attributes"]["name"].as_str() {
                        authors.push(name.to_string());
                    }
                }
            }
        }

        // Fetch chapters feed
        let feed_url = format!(
            "{}/manga/{}/feed?limit=100&translatedLanguage[]=vi&translatedLanguage[]=en&order[chapter]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica",
            self.api_url, manga_id
        );

        let feed_resp = self.client.get(&feed_url).send().await?;
        let mut chapters = Vec::new();

        if feed_resp.status().is_success() {
            let feed_body: Value = feed_resp.json().await?;
            if let Some(feed_data) = feed_body["data"].as_array() {
                for ch in feed_data {
                    let ch_id = ch["id"].as_str().unwrap_or("").to_string();
                    let ch_attr = &ch["attributes"];
                    let ch_num = ch_attr["chapter"].as_str().unwrap_or("0").to_string();
                    let raw_title = ch_attr["title"].as_str().unwrap_or("");
                    let display_title = if raw_title.is_empty() {
                        format!("Chapter {}", ch_num)
                    } else {
                        format!("Ch. {} - {}", ch_num, raw_title)
                    };

                    let scanlator = ch["relationships"]
                        .as_array()
                        .and_then(|arr| {
                            arr.iter()
                                .find(|r| r["type"].as_str() == Some("scanlation_group"))
                        })
                        .and_then(|r| r["attributes"]["name"].as_str())
                        .map(|s| s.to_string());

                    chapters.push(Chapter {
                        id: ch_id.clone(),
                        title: display_title,
                        chapter_number: ch_num,
                        url: format!("https://mangadex.org/chapter/{}", ch_id),
                        scanlator,
                        pages: Vec::new(),
                        drm_data: None,
                    });
                }
            }
        }

        Ok(MangaInfo {
            id: manga_id.clone(),
            title,
            url: format!("https://mangadex.org/title/{}", manga_id),
            cover_url,
            description,
            authors,
            genres: Vec::new(),
            chapters,
        })
    }

    async fn get_chapter_pages(&self, chapter_id_or_url: &str) -> Result<Vec<String>> {
        let ch_id = self
            .extract_uuid(chapter_id_or_url)
            .unwrap_or_else(|| chapter_id_or_url.to_string());

        let url = format!("{}/at-home/server/{}", self.api_url, ch_id);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "Failed to fetch MangaDex at-home server info (status {})",
                resp.status()
            )));
        }

        let body: Value = resp.json().await?;
        let base_url = body["baseUrl"].as_str().unwrap_or(self.uploads_url);
        let chapter = &body["chapter"];
        let hash = chapter["hash"]
            .as_str()
            .ok_or_else(|| MoeJectError::Parse("Missing chapter hash in at-home response".to_string()))?;

        let data = chapter["data"]
            .as_array()
            .ok_or_else(|| MoeJectError::Parse("Missing page data array in at-home response".to_string()))?;

        let pages: Vec<String> = data
            .iter()
            .filter_map(|v| v.as_str())
            .map(|filename| format!("{}/data/{}/{}", base_url, hash, filename))
            .collect();

        Ok(pages)
    }
}
