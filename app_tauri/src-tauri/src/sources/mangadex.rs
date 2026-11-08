use crate::models::{MangaItem, ChapterItem, PageItem};
use crate::sources::MangaSource;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

pub struct MangaDexSource {
    client: reqwest::Client,
}

impl MangaDexSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("MoeJect/1.0")
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

impl MangaSource for MangaDexSource {
    fn source_id(&self) -> &'static str {
        "mangadex"
    }

    fn source_name(&self) -> &'static str {
        "MangaDex"
    }

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!(
                "https://api.mangadex.org/manga?title={}&limit=24&includes%5B%5D=cover_art&order%5Brelevance%5D=desc",
                urlencoding::encode(query)
            );

            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("MangaDex search failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut results = Vec::new();

            if let Some(data) = json["data"].as_array() {
                for item in data {
                    let id = item["id"].as_str().unwrap_or("").to_string();
                    let title = item["attributes"]["title"]["en"]
                        .as_str()
                        .or_else(|| item["attributes"]["title"]["ja-ro"].as_str())
                        .or_else(|| item["attributes"]["altTitles"].as_array().and_then(|arr| arr.first().and_then(|t| t.as_object()?.values().next()?.as_str())))
                        .unwrap_or("Untitled")
                        .to_string();

                    let desc = item["attributes"]["description"]["en"]
                        .as_str()
                        .or_else(|| item["attributes"]["description"]["vi"].as_str())
                        .map(|s| s.to_string());

                    let mut cover_file = String::new();
                    if let Some(relationships) = item["relationships"].as_array() {
                        for rel in relationships {
                            if rel["type"] == "cover_art" {
                                if let Some(file) = rel["attributes"]["fileName"].as_str() {
                                    cover_file = file.to_string();
                                    break;
                                }
                            }
                        }
                    }

                    let cover_url = if !cover_file.is_empty() {
                        format!("https://uploads.mangadex.org/covers/{}/{}.256.jpg", id, cover_file)
                    } else {
                        "".to_string()
                    };

                    let status = item["attributes"]["status"].as_str().map(|s| s.to_string());
                    let mut genres = Vec::new();
                    if let Some(tags) = item["attributes"]["tags"].as_array() {
                        for tag in tags {
                            if let Some(name) = tag["attributes"]["name"]["en"].as_str() {
                                genres.push(name.to_string());
                            }
                        }
                    }

                    results.push(MangaItem {
                        id,
                        title,
                        cover_url,
                        source: "mangadex".to_string(),
                        description: desc,
                        authors: vec![],
                        status,
                        genres,
                    });
                }
            }

            Ok(results)
        })
    }

    fn get_chapters<'a>(&'a self, manga_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!(
                "https://api.mangadex.org/manga/{}/feed?limit=500&order[chapter]=desc&includes[]=scanlation_group",
                manga_id
            );

            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("MangaDex feed failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut chapters = Vec::new();

            if let Some(data) = json["data"].as_array() {
                for item in data {
                    let id = item["id"].as_str().unwrap_or("").to_string();
                    let ch_num_str = item["attributes"]["chapter"].as_str().unwrap_or("0");
                    let chapter_number = ch_num_str.parse::<f64>().unwrap_or(0.0);
                    let title = item["attributes"]["title"].as_str().unwrap_or("").to_string();
                    let lang = item["attributes"]["translatedLanguage"].as_str().unwrap_or("en").to_string();

                    let display_title = if title.is_empty() {
                        format!("Chapter {}", ch_num_str)
                    } else {
                        format!("Ch. {} - {}", ch_num_str, title)
                    };

                    chapters.push(ChapterItem {
                        id,
                        manga_id: manga_id.to_string(),
                        chapter_number,
                        title: display_title,
                        source: "mangadex".to_string(),
                        language: lang,
                    });
                }
            }

            Ok(chapters)
        })
    }

    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("https://api.mangadex.org/at-home/server/{}", chapter_id);
            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("MangaDex at-home failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let base_url = json["baseUrl"].as_str().unwrap_or("https://uploads.mangadex.org");
            let hash = json["chapter"]["hash"].as_str().unwrap_or("");
            let mut pages = Vec::new();

            if let Some(data) = json["chapter"]["data"].as_array() {
                for (idx, file) in data.iter().enumerate() {
                    if let Some(file_name) = file.as_str() {
                        pages.push(PageItem {
                            page_number: idx + 1,
                            url: format!("{}/data/{}/{}", base_url, hash, file_name),
                        });
                    }
                }
            }

            Ok(pages)
        })
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut encoded = String::new();
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(b as char);
                }
                b' ' => encoded.push('+'),
                _ => encoded.push_str(&format!("%{:02X}", b)),
            }
        }
        encoded
    }
}
