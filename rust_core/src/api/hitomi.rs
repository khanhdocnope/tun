use async_trait::async_trait;
use byteorder::{BigEndian, ByteOrder};
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::api::MangaSource;
use crate::error::{MoeJectError, Result};
use crate::models::{Chapter, MangaInfo, MangaSearchResult, SourceMetadata};

struct GgConfig {
    b: String,
    cases: HashSet<i32>,
    default_o: i32,
    case_o: i32,
    last_updated: Instant,
}

pub struct HitomiSource {
    client: reqwest::Client,
    ltn_domain: &'static str,
    gg_config: Arc<RwLock<Option<GgConfig>>>,
}

impl HitomiSource {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .default_headers({
                let mut h = reqwest::header::HeaderMap::new();
                h.insert(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
                        .parse()
                        .unwrap(),
                );
                h.insert("Referer", "https://hitomi.la/".parse().unwrap());
                h
            })
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            ltn_domain: "ltn.gold-usergeneratedcontent.net",
            gg_config: Arc::new(RwLock::new(None)),
        }
    }

    async fn ensure_gg(&self) -> Result<()> {
        let needs_fetch = {
            let guard = self.gg_config.read().await;
            match &*guard {
                Some(cfg) => cfg.last_updated.elapsed() > Duration::from_secs(1800),
                None => true,
            }
        };

        if !needs_fetch {
            return Ok(());
        }

        let url = format!("https://{}/gg.js", self.ltn_domain);
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(MoeJectError::Parse(format!(
                "Failed to fetch Hitomi gg.js (status {})",
                resp.status()
            )));
        }

        let text = resp.text().await?;

        // 1. Extract b: '...'
        let b_re = Regex::new(r"b:\s*'([^']+)'").unwrap();
        let b = b_re
            .captures(&text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // 2. Extract default_o and case_o
        let init_re = Regex::new(r"var o = (\d+);").unwrap();
        let default_o = init_re
            .captures(&text)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(0);

        let case_re = Regex::new(r"o = (\d+);\s*break;").unwrap();
        let case_o = case_re
            .captures(&text)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(1);

        // 3. Extract switch cases
        let mut cases = HashSet::new();
        let num_re = Regex::new(r"case\s+(\d+):").unwrap();
        for cap in num_re.captures_iter(&text) {
            if let Some(m) = cap.get(1) {
                if let Ok(val) = m.as_str().parse::<i32>() {
                    cases.insert(val);
                }
            }
        }

        let mut guard = self.gg_config.write().await;
        *guard = Some(GgConfig {
            b,
            cases,
            default_o,
            case_o,
            last_updated: Instant::now(),
        });

        Ok(())
    }

    async fn gg_m(&self, g: i32) -> i32 {
        let guard = self.gg_config.read().await;
        if let Some(cfg) = &*guard {
            if cfg.cases.contains(&g) {
                cfg.case_o
            } else {
                cfg.default_o
            }
        } else {
            0
        }
    }

    async fn gg_b(&self) -> String {
        let guard = self.gg_config.read().await;
        guard.as_ref().map(|c| c.b.clone()).unwrap_or_default()
    }

    async fn url_from_url_from_hash(&self, gallery_id: &str, file: &Value) -> String {
        let hash = file["hash"].as_str().unwrap_or("");
        if hash.is_empty() {
            return String::new();
        }

        let hash_len = hash.len();
        if hash_len < 3 {
            return format!("https://a.gold-usergeneratedcontent.net/{}/{}.webp", gallery_id, hash);
        }

        let m1 = &hash[hash_len - 1..];
        let m2 = &hash[hash_len - 3..hash_len - 1];

        let hex_val = format!("{}{}", m1, m2);
        let g = i32::from_str_radix(&hex_val, 16).unwrap_or(0);

        let m_val = self.gg_m(g).await;
        let b = self.gg_b().await;

        let subdomain = format!("w{}", 1 + m_val);
        format!(
            "https://{}.gold-usergeneratedcontent.net/{}{}/{}.webp",
            subdomain, b, g, hash
        )
    }

    async fn thumbnail_url(&self, hash: &str) -> String {
        let hash_len = hash.len();
        if hash_len < 3 {
            return String::new();
        }

        let m1 = &hash[hash_len - 1..];
        let m2 = &hash[hash_len - 3..hash_len - 1];

        let hex_val = format!("{}{}", m1, m2);
        let g = i32::from_str_radix(&hex_val, 16).unwrap_or(0);

        let m_val = self.gg_m(g).await;
        let sub_char = (b'a' + m_val as u8) as char;

        format!(
            "https://{}tn.gold-usergeneratedcontent.net/webpbigtn/{}/{}/{}.webp",
            sub_char, m1, m2, hash
        )
    }

    async fn fetch_gallery_info(&self, gallery_id: &str) -> Result<Value> {
        let url = format!(
            "https://{}/galleries/{}.js",
            self.ltn_domain, gallery_id
        );

        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            return Err(MoeJectError::NotFound(format!(
                "Hitomi gallery {} not found (status {})",
                gallery_id,
                resp.status()
            )));
        }

        let text = resp.text().await?;
        let prefix = "var galleryinfo = ";
        let json_str = if text.starts_with(prefix) {
            text.trim_start_matches(prefix).trim().trim_end_matches(';')
        } else {
            &text
        };

        let val: Value = serde_json::from_str(json_str)?;
        Ok(val)
    }
}

#[async_trait]
impl MangaSource for HitomiSource {
    fn id(&self) -> &'static str {
        "hitomi"
    }

    fn name(&self) -> &'static str {
        "Hitomi.la"
    }

    fn metadata(&self) -> SourceMetadata {
        SourceMetadata {
            id: "hitomi".to_string(),
            name: "Hitomi.la".to_string(),
            base_url: "https://hitomi.la".to_string(),
            icon: "collections_bookmark_rounded".to_string(),
            description: "Thư viện Doujinshi & Manga trực tuyến đồ sộ với CDN phân tán".to_string(),
            language: "Multi / Raw".to_string(),
            supports_search: true,
            supports_latest: true,
        }
    }

    async fn search(&self, query: &str, page: u32) -> Result<Vec<MangaSearchResult>> {
        self.ensure_gg().await?;

        let trimmed = query.trim();

        // 1. Direct ID search
        if let Ok(_) = trimmed.parse::<u64>() {
            if let Ok(info) = self.fetch_gallery_info(trimmed).await {
                let title = info["title"].as_str().unwrap_or("Untitled").to_string();
                let files = info["files"].as_array();
                let cover_url = if let Some(first_file) = files.and_then(|f| f.first()) {
                    let hash = first_file["hash"].as_str().unwrap_or("");
                    Some(self.thumbnail_url(hash).await)
                } else {
                    None
                };

                return Ok(vec![MangaSearchResult {
                    id: trimmed.to_string(),
                    title,
                    url: format!("https://hitomi.la/galleries/{}.html", trimmed),
                    cover_url,
                    latest_chapter: Some("1".to_string()),
                    description: None,
                    authors: Vec::new(),
                    genres: Vec::new(),
                }]);
            }
        }

        // 2. Nozomi Binary Index Search (Defaulting to index-all.nozomi)
        let limit = 24;
        let page_idx = (page.max(1) - 1) as usize;
        let start_byte = page_idx * limit * 4;
        let end_byte = start_byte + (limit * 4) - 1;

        let index_url = format!("https://{}/index-all.nozomi", self.ltn_domain);
        let resp = self
            .client
            .get(&index_url)
            .header("Range", format!("bytes={}-{}", start_byte, end_byte))
            .send()
            .await?;

        if !resp.status().is_success() && resp.status().as_u16() != 206 {
            return Err(MoeJectError::Parse(format!(
                "Failed to read Hitomi Nozomi index range {}-{} (status {})",
                start_byte,
                end_byte,
                resp.status()
            )));
        }

        let bytes_data = resp.bytes().await?;
        let count = bytes_data.len() / 4;
        let mut ids = Vec::new();

        for i in 0..count {
            let id = BigEndian::read_u32(&bytes_data[i * 4..(i + 1) * 4]);
            ids.push(id.to_string());
        }

        // Concurrently fetch metadata for the top galleries
        let mut results = Vec::new();
        for id in ids {
            if let Ok(val) = self.fetch_gallery_info(&id).await {
                let title = val["title"].as_str().unwrap_or("Untitled").to_string();
                let files = val["files"].as_array();
                let cover_url = if let Some(first_file) = files.and_then(|f| f.first()) {
                    let hash = first_file["hash"].as_str().unwrap_or("");
                    Some(self.thumbnail_url(hash).await)
                } else {
                    None
                };

                let mut authors = Vec::new();
                if let Some(artists) = val["artists"].as_array() {
                    for a in artists {
                        if let Some(artist_name) = a["artist"].as_str() {
                            authors.push(artist_name.to_string());
                        }
                    }
                }

                results.push(MangaSearchResult {
                    id: id.clone(),
                    title,
                    url: format!("https://hitomi.la/galleries/{}.html", id),
                    cover_url,
                    latest_chapter: Some("Complete".to_string()),
                    description: None,
                    authors,
                    genres: Vec::new(),
                });
            }
        }

        Ok(results)
    }

    async fn get_manga_details(&self, id_or_url: &str) -> Result<MangaInfo> {
        self.ensure_gg().await?;

        let id = id_or_url
            .trim_end_matches(".html")
            .split('/')
            .last()
            .unwrap_or(id_or_url);

        let val = self.fetch_gallery_info(id).await?;
        let title = val["title"].as_str().unwrap_or("Untitled").to_string();

        let files = val["files"].as_array();
        let cover_url = if let Some(first_file) = files.and_then(|f| f.first()) {
            let hash = first_file["hash"].as_str().unwrap_or("");
            Some(self.thumbnail_url(hash).await)
        } else {
            None
        };

        let mut authors = Vec::new();
        if let Some(artists) = val["artists"].as_array() {
            for a in artists {
                if let Some(artist_name) = a["artist"].as_str() {
                    authors.push(artist_name.to_string());
                }
            }
        }

        let mut genres = Vec::new();
        if let Some(tags) = val["tags"].as_array() {
            for t in tags {
                if let Some(tag_name) = t["tag"].as_str() {
                    genres.push(tag_name.to_string());
                }
            }
        }

        // Build single chapter containing all pages
        let mut pages = Vec::new();
        if let Some(file_list) = files {
            for f in file_list {
                let page_url = self.url_from_url_from_hash(id, f).await;
                if !page_url.is_empty() {
                    pages.push(page_url);
                }
            }
        }

        let single_chapter = Chapter {
            id: id.to_string(),
            title: format!("{} (Full Gallery)", title),
            chapter_number: "1".to_string(),
            url: format!("https://hitomi.la/reader/{}.html#1", id),
            scanlator: None,
            pages,
            drm_data: None,
        };

        Ok(MangaInfo {
            id: id.to_string(),
            title,
            url: format!("https://hitomi.la/galleries/{}.html", id),
            cover_url,
            description: None,
            authors,
            genres,
            chapters: vec![single_chapter],
        })
    }

    async fn get_chapter_pages(&self, chapter_id_or_url: &str) -> Result<Vec<String>> {
        self.ensure_gg().await?;

        let id = chapter_id_or_url
            .trim_end_matches(".html")
            .split('/')
            .last()
            .unwrap_or(chapter_id_or_url);

        let val = self.fetch_gallery_info(id).await?;
        let mut pages = Vec::new();

        if let Some(files) = val["files"].as_array() {
            for f in files {
                let page_url = self.url_from_url_from_hash(id, f).await;
                if !page_url.is_empty() {
                    pages.push(page_url);
                }
            }
        }

        Ok(pages)
    }
}
