use crate::models::{ChapterItem, MangaItem, PageItem};
use crate::sources::MangaSource;
use regex::Regex;
use scraper::{Html, Selector};
use std::future::Future;
use std::pin::Pin;

pub struct MojoPortalTemplate {
    pub id: String,
    pub name: String,
    pub base_url: String,
    client: reqwest::Client,
}

impl MojoPortalTemplate {
    pub fn new(id: impl Into<String>, name: impl Into<String>, base_url: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();
        Self {
            id: id.into(),
            name: name.into(),
            base_url: base_url.into(),
            client,
        }
    }
}

impl MangaSource for MojoPortalTemplate {
    fn source_id(&self) -> &str {
        &self.id
    }

    fn source_name(&self) -> &str {
        &self.name
    }

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        let base_url = self.base_url.clone();
        let id_str = self.id.clone();
        Box::pin(async move {
            let url = if query.trim().is_empty() {
                format!("{}/?page=1", base_url)
            } else {
                format!("{}/tim-truyen?keyword={}", base_url, urlencoding_simple(query.trim()))
            };

            let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let item_sel = Selector::parse("div.ModuleContent div.items div.item, div.items div.item").unwrap();
            let title_sel = Selector::parse("figcaption h3 a, figcaption a.jtip").unwrap();
            let img_sel = Selector::parse("div.image a img, div.image img").unwrap();

            let mut results = Vec::new();
            for item in document.select(&item_sel) {
                if let Some(title_elem) = item.select(&title_sel).next() {
                    let title = title_elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                    let link = title_elem.value().attr("href").unwrap_or("").to_string();
                    let cover = item.select(&img_sel).next()
                        .and_then(|img| {
                            img.value().attr("data-original")
                                .or_else(|| img.value().attr("data-src"))
                                .or_else(|| img.value().attr("src"))
                        })
                        .unwrap_or("")
                        .to_string();

                    let full_cover = if cover.starts_with("//") {
                        format!("https:{}", cover)
                    } else if !cover.starts_with("http") && !cover.is_empty() {
                        format!("{}{}", base_url, cover)
                    } else {
                        cover
                    };

                    results.push(MangaItem {
                        id: link,
                        title,
                        cover_url: full_cover,
                        source: id_str.to_string(),
                        description: None,
                        authors: vec![],
                        status: Some("Ongoing".to_string()),
                        genres: vec![],
                    });
                }
            }

            Ok(results)
        })
    }

    fn get_chapters<'a>(&'a self, manga_url: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>> {
        let id_str = self.id.clone();
        let base_url = self.base_url.clone();
        Box::pin(async move {
            let full_url = if manga_url.starts_with("http") {
                manga_url.to_string()
            } else {
                format!("{}/truyen-tranh/{}", base_url, manga_url)
            };

            let resp = self.client.get(&full_url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let ch_sel = Selector::parse("div.list-chapter ul li.row div.chapter a").unwrap();
            let re_num = Regex::new(r"(?i)Chapter\s+([\d.]+)").unwrap();
            let mut chapters = Vec::new();

            for elem in document.select(&ch_sel) {
                let link = elem.value().attr("href").unwrap_or("").to_string();
                let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                let ch_num = re_num.captures(&title)
                    .and_then(|c| c.get(1))
                    .and_then(|m| m.as_str().parse::<f64>().ok())
                    .unwrap_or(0.0);

                if !link.is_empty() {
                    chapters.push(ChapterItem {
                        id: link,
                        manga_id: manga_url.to_string(),
                        chapter_number: ch_num,
                        title,
                        source: id_str.to_string(),
                        language: "vi".to_string(),
                    });
                }
            }

            chapters.reverse();
            Ok(chapters)
        })
    }

    fn get_pages<'a>(&'a self, chapter_url: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        let base_url = self.base_url.clone();
        Box::pin(async move {
            let full_url = if chapter_url.starts_with("http") {
                chapter_url.to_string()
            } else {
                format!("{}/truyen-tranh/{}", base_url, chapter_url)
            };

            let resp = self.client.get(&full_url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let page_sel = Selector::parse("div.reading div.page-chapter img, div.reading-detail div.page-chapter img").unwrap();
            let mut pages = Vec::new();

            for (idx, elem) in document.select(&page_sel).enumerate() {
                let src_opt = elem.value().attr("data-original")
                    .or_else(|| elem.value().attr("data-src"))
                    .or_else(|| elem.value().attr("data-cdn"))
                    .or_else(|| elem.value().attr("src"));

                if let Some(src) = src_opt {
                    let mut clean_src = src.trim().to_string();
                    if clean_src.starts_with("//") {
                        clean_src = format!("https:{}", clean_src);
                    } else if !clean_src.starts_with("http") && !clean_src.is_empty() {
                        clean_src = format!("{}{}", base_url, clean_src);
                    }

                    if !clean_src.is_empty() {
                        pages.push(PageItem::new(idx + 1, clean_src));
                    }
                }
            }

            Ok(pages)
        })
    }
}

fn urlencoding_simple(s: &str) -> String {
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
