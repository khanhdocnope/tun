use crate::models::{ChapterItem, MangaItem, PageItem};
use crate::sources::MangaSource;
use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct GgParams {
    pub gg_b: String,
    pub default_o: i32,
    pub case_o: i32,
    pub cases: HashSet<i64>,
    pub fetched_at: Instant,
}

impl Default for GgParams {
    fn default() -> Self {
        Self {
            gg_b: "1794056401/".to_string(),
            default_o: 0,
            case_o: 1,
            cases: HashSet::new(),
            fetched_at: Instant::now() - Duration::from_secs(7200),
        }
    }
}

pub struct HitomiSource {
    client: reqwest::Client,
    gg_cache: Arc<RwLock<GgParams>>,
}

impl HitomiSource {
    pub fn new() -> Self {
        Self {
            client: crate::sources::new_manga_client(),
            gg_cache: Arc::new(RwLock::new(GgParams::default())),
        }
    }

    pub async fn ensure_gg(&self) -> GgParams {
        {
            let r = self.gg_cache.read().await;
            if r.fetched_at.elapsed() < Duration::from_secs(1800) && !r.cases.is_empty() {
                return r.clone();
            }
        }

        let mut params = GgParams::default();
        let url = "https://ltn.gold-usergeneratedcontent.net/gg.js";
        if let Ok(resp) = self.client.get(url).header("Referer", "https://hitomi.la/").send().await {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    if let Ok(re_b) = Regex::new(r"b:\s*'([^']+)'") {
                        if let Some(caps) = re_b.captures(&text) {
                            if let Some(m) = caps.get(1) {
                                params.gg_b = m.as_str().to_string();
                            }
                        }
                    }

                    if let Ok(re_o) = Regex::new(r"var o = (\d+);") {
                        if let Some(caps) = re_o.captures(&text) {
                            if let Some(m) = caps.get(1) {
                                params.default_o = m.as_str().parse().unwrap_or(0);
                            }
                        }
                    }

                    if let Ok(re_case_o) = Regex::new(r"o = (\d+);\s*break;") {
                        if let Some(caps) = re_case_o.captures(&text) {
                            if let Some(m) = caps.get(1) {
                                params.case_o = m.as_str().parse().unwrap_or(1);
                            }
                        }
                    }

                    if let Ok(re_case) = Regex::new(r"case\s+(\d+):") {
                        for caps in re_case.captures_iter(&text) {
                            if let Some(m) = caps.get(1) {
                                if let Ok(val) = m.as_str().parse::<i64>() {
                                    params.cases.insert(val);
                                }
                            }
                        }
                    }
                    params.fetched_at = Instant::now();
                }
            }
        }

        let mut w = self.gg_cache.write().await;
        *w = params.clone();
        params
    }

    pub fn resolve_image_candidates_with_params(hash: &str, gg: &GgParams) -> Vec<String> {
        if hash.len() < 3 {
            return Vec::new();
        }
        let last1 = &hash[hash.len() - 1..];
        let last2 = &hash[hash.len() - 3..hash.len() - 1];

        let g = i64::from_str_radix(&format!("{}{}", last1, last2), 16).unwrap_or(0);
        let s_val = g.to_string();

        let m_val = if gg.cases.contains(&g) { gg.case_o } else { gg.default_o };
        let primary_sub = format!("w{}", 1 + m_val);
        let alt_gold_sub = format!("w{}", 1 + (1 - m_val));

        let primary_url = format!(
            "https://{}.gold-usergeneratedcontent.net/{}{}/{}.webp",
            primary_sub, gg.gg_b, s_val, hash
        );
        let alt_gold_url = format!(
            "https://{}.gold-usergeneratedcontent.net/{}{}/{}.webp",
            alt_gold_sub, gg.gg_b, s_val, hash
        );
        let w3_url = format!(
            "https://w3.gold-usergeneratedcontent.net/{}{}/{}.webp",
            gg.gg_b, s_val, hash
        );

        vec![primary_url, alt_gold_url, w3_url]
    }

    pub fn resolve_image_url(hash: &str) -> String {
        if hash.len() < 3 {
            return String::new();
        }
        let last1 = &hash[hash.len() - 1..];
        let last2 = &hash[hash.len() - 3..hash.len() - 1];
        format!(
            "https://atn.gold-usergeneratedcontent.net/webpbigtn/{}/{}/{}.webp",
            last1, last2, hash
        )
    }
}

impl MangaSource for HitomiSource {
    fn source_id(&self) -> &'static str {
        "hitomi"
    }

    fn source_name(&self) -> &'static str {
        "Hitomi.la"
    }

    fn search<'a>(&'a self, _query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            // Read first 24 gallery IDs from Nozomi index (each id is 4 bytes big endian)
            let bytes_to_read = 24 * 4;
            let range_header = format!("bytes=0-{}", bytes_to_read - 1);

            let resp = self.client.get("https://ltn.gold-usergeneratedcontent.net/index-all.nozomi")
                .header(reqwest::header::RANGE, range_header)
                .header(reqwest::header::REFERER, "https://hitomi.la/")
                .send()
                .await
                .map_err(|e| format!("Hitomi nozomi fetch failed: {}", e))?;

            let bytes = resp.bytes().await.map_err(|e| format!("Read nozomi bytes failed: {}", e))?;
            let mut gallery_ids = Vec::new();

            for chunk in bytes.chunks_exact(4) {
                let id = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                gallery_ids.push(id);
            }

            let mut results = Vec::new();
            for id in gallery_ids.iter().take(12) {
                let gal_url = format!("https://ltn.gold-usergeneratedcontent.net/galleries/{}.js", id);
                if let Ok(gal_resp) = self.client.get(&gal_url).header(reqwest::header::REFERER, "https://hitomi.la/").send().await {
                    if let Ok(text) = gal_resp.text().await {
                        if let Some(json_str) = text.strip_prefix("var galleryinfo = ") {
                            if let Ok(info) = serde_json::from_str::<Value>(json_str) {
                                let title = info["title"].as_str().unwrap_or("Untitled").to_string();
                                let first_file_hash = info["files"].as_array()
                                    .and_then(|arr| arr.first())
                                    .and_then(|f| f["hash"].as_str())
                                    .unwrap_or("");
                                
                                let cover_url = if !first_file_hash.is_empty() {
                                    Self::resolve_image_url(first_file_hash)
                                } else {
                                    "".to_string()
                                };

                                let mut tags = Vec::new();
                                if let Some(tag_arr) = info["tags"].as_array() {
                                    for t in tag_arr {
                                        if let Some(tag_name) = t["tag"].as_str() {
                                            tags.push(tag_name.to_string());
                                        }
                                    }
                                }

                                results.push(MangaItem {
                                    id: id.to_string(),
                                    title,
                                    cover_url,
                                    source: "hitomi".to_string(),
                                    description: None,
                                    authors: vec![],
                                    status: Some("Completed".to_string()),
                                    genres: tags,
                                });
                            }
                        }
                    }
                }
            }

            Ok(results)
        })
    }

    fn get_chapters<'a>(&'a self, manga_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            Ok(vec![ChapterItem {
                id: manga_id.to_string(),
                manga_id: manga_id.to_string(),
                chapter_number: 1.0,
                title: format!("Complete Gallery #{}", manga_id),
                source: "hitomi".to_string(),
                language: "all".to_string(),
            }])
        })
    }

    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let gg = self.ensure_gg().await;
            let gal_url = format!("https://ltn.gold-usergeneratedcontent.net/galleries/{}.js", chapter_id);
            let resp = self.client.get(&gal_url)
                .header(reqwest::header::REFERER, "https://hitomi.la/")
                .send()
                .await
                .map_err(|e| format!("Hitomi gallery fetch failed: {}", e))?;

            let text = resp.text().await.map_err(|e| format!("Read text failed: {}", e))?;
            let json_str = text.strip_prefix("var galleryinfo = ").unwrap_or(&text);
            let info: Value = serde_json::from_str(json_str).map_err(|e| format!("Parse galleryinfo failed: {}", e))?;

            let mut pages = Vec::new();
            if let Some(files) = info["files"].as_array() {
                for (idx, file) in files.iter().enumerate() {
                    if let Some(hash) = file["hash"].as_str() {
                        let candidates = Self::resolve_image_candidates_with_params(hash, &gg);
                        let primary = candidates.first().cloned().unwrap_or_default();
                        let fallbacks = if candidates.len() > 1 { candidates[1..].to_vec() } else { vec![] };
                        pages.push(PageItem {
                            page_number: idx + 1,
                            url: primary,
                            drm_data: None,
                            fallback_urls: fallbacks,
                        });
                    }
                }
            }

            Ok(pages)
        })
    }
}
