use crate::models::{MangaItem, ChapterItem, PageItem};
use crate::sources::MangaSource;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

pub struct ComickSource {
    client: reqwest::Client,
}

impl ComickSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();
        Self { client }
    }
}

impl MangaSource for ComickSource {
    fn source_id(&self) -> &'static str {
        "comick"
    }

    fn source_name(&self) -> &'static str {
        "Comick"
    }

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!(
                "https://api.comick.dev/v1.0/search?q={}&limit=24",
                urlencoding::encode(query)
            );

            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("Comick search failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut results = Vec::new();

            if let Some(arr) = json.as_array() {
                for item in arr {
                    let hid = item["hid"].as_str().unwrap_or("").to_string();
                    let title = item["title"].as_str().unwrap_or("Untitled").to_string();
                    let desc = item["desc"].as_str().map(|s| s.to_string());
                    
                    let cover_url = if let Some(bkey) = item["md_covers"].as_array().and_then(|a| a.first()).and_then(|c| c["b2key"].as_str().or_else(|| c["bkey"].as_str())) {
                        format!("https://meo.comick.pictures/{}", bkey)
                    } else if let Some(bkey) = item["b2key"].as_str().or_else(|| item["bkey"].as_str()) {
                        format!("https://meo.comick.pictures/{}", bkey)
                    } else {
                        "".to_string()
                    };

                    let status = item["status"].as_i64().map(|s| if s == 1 { "Ongoing" } else { "Completed" }.to_string());
                    let mut genres = Vec::new();
                    if let Some(genre_arr) = item["genres"].as_array() {
                        for g in genre_arr {
                            if let Some(name) = g["name"].as_str() {
                                genres.push(name.to_string());
                            }
                        }
                    }

                    results.push(MangaItem {
                        id: hid,
                        title,
                        cover_url,
                        source: "comick".to_string(),
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
                "https://api.comick.dev/comic/{}/chapters?limit=300",
                manga_id
            );

            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("Comick chapters failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut chapters = Vec::new();

            if let Some(arr) = json["chapters"].as_array() {
                for item in arr {
                    let hid = item["hid"].as_str().unwrap_or("").to_string();
                    let ch_str = item["chap"].as_str().unwrap_or("0");
                    let chapter_number = ch_str.parse::<f64>().unwrap_or(0.0);
                    let title = item["title"].as_str().unwrap_or("").to_string();
                    let lang = item["lang"].as_str().unwrap_or("en").to_string();

                    let display_title = if title.is_empty() {
                        format!("Chapter {}", ch_str)
                    } else {
                        format!("Ch. {} - {}", ch_str, title)
                    };

                    chapters.push(ChapterItem {
                        id: hid,
                        manga_id: manga_id.to_string(),
                        chapter_number,
                        title: display_title,
                        source: "comick".to_string(),
                        language: lang,
                    });
                }
            }

            Ok(chapters)
        })
    }

    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("https://api.comick.dev/chapter/{}", chapter_id);
            let resp = self.client.get(&url)
                .send()
                .await
                .map_err(|e| format!("Comick pages failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut pages = Vec::new();

            if let Some(arr) = json["chapter"]["images"].as_array() {
                for (idx, img) in arr.iter().enumerate() {
                    if let Some(bkey) = img["bkey"].as_str() {
                        pages.push(PageItem {
                            page_number: idx + 1,
                            url: format!("https://meo.comick.pictures/{}", bkey),
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
