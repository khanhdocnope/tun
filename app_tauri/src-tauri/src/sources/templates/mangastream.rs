use crate::models::{MangaItem, ChapterItem, PageItem};
use crate::sources::MangaSource;
use scraper::{Html, Selector};
use std::future::Future;
use std::pin::Pin;

pub struct MangaStreamTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub base_url: &'static str,
    client: reqwest::Client,
}

impl MangaStreamTemplate {
    pub fn new(id: &'static str, name: &'static str, base_url: &'static str) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default();
        Self { id, name, base_url, client }
    }
}

impl MangaSource for MangaStreamTemplate {
    fn source_id(&self) -> &'static str {
        self.id
    }

    fn source_name(&self) -> &'static str {
        self.name
    }

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        let base_url = self.base_url;
        let id_str = self.id;
        Box::pin(async move {
            let url = format!("{}/?s={}", base_url, query);
            let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let item_sel = Selector::parse(".bsx, .animposx").unwrap();
            let link_sel = Selector::parse("a").unwrap();
            let title_sel = Selector::parse(".tt, .title").unwrap();
            let img_sel = Selector::parse("img").unwrap();

            let mut results = Vec::new();
            for item in document.select(&item_sel) {
                if let Some(link_elem) = item.select(&link_sel).next() {
                    let link = link_elem.value().attr("href").unwrap_or("").to_string();
                    let title = item.select(&title_sel).next()
                        .map(|t| t.text().collect::<Vec<_>>().join(" ").trim().to_string())
                        .unwrap_or_else(|| link_elem.value().attr("title").unwrap_or("Untitled").to_string());
                    
                    let cover = item.select(&img_sel).next()
                        .and_then(|img| img.value().attr("src").or_else(|| img.value().attr("data-src")))
                        .unwrap_or("")
                        .to_string();

                    results.push(MangaItem {
                        id: link,
                        title,
                        cover_url: cover,
                        source: id_str.to_string(),
                        description: None,
                        authors: vec![],
                        status: None,
                        genres: vec![],
                    });
                }
            }

            Ok(results)
        })
    }

    fn get_chapters<'a>(&'a self, manga_url: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>> {
        let id_str = self.id;
        Box::pin(async move {
            let resp = self.client.get(manga_url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let ch_sel = Selector::parse(".eph-num a, .clxs a, #chapterlist a").unwrap();
            let mut chapters = Vec::new();

            for (idx, elem) in document.select(&ch_sel).enumerate() {
                let title = elem.text().collect::<Vec<_>>().join(" ").trim().to_string();
                let link = elem.value().attr("href").unwrap_or("").to_string();

                chapters.push(ChapterItem {
                    id: link,
                    manga_id: manga_url.to_string(),
                    chapter_number: idx as f64 + 1.0,
                    title,
                    source: id_str.to_string(),
                    language: "en".to_string(),
                });
            }

            Ok(chapters)
        })
    }

    fn get_pages<'a>(&'a self, chapter_url: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let resp = self.client.get(chapter_url).send().await.map_err(|e| e.to_string())?;
            let html_text = resp.text().await.map_err(|e| e.to_string())?;
            let document = Html::parse_document(&html_text);

            let page_sel = Selector::parse("#readerarea img").unwrap();
            let mut pages = Vec::new();

            for (idx, elem) in document.select(&page_sel).enumerate() {
                if let Some(src) = elem.value().attr("src").or_else(|| elem.value().attr("data-src")) {
                    pages.push(PageItem::new(
                        idx + 1,
                        src.trim().to_string(),
                    ));
                }
            }

            Ok(pages)
        })
    }
}
