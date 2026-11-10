pub mod mangadex;
pub mod comick;
pub mod hitomi;
pub mod cuutruyen;
pub mod catalog;
pub mod templates;

use crate::models::{MangaItem, ChapterItem, PageItem};
use std::future::Future;
use std::pin::Pin;

pub trait MangaSource: Send + Sync {
    fn source_id(&self) -> &str;
    fn source_name(&self) -> &str;

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>>;
    fn get_chapters<'a>(&'a self, manga_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>>;
    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>>;
}

pub fn new_manga_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .resolve("cuutruyen.net", "104.21.40.80:443".parse().unwrap())
        .resolve("cuutruyen.net", "172.67.182.143:443".parse().unwrap())
        .resolve("hitomi.la", "185.165.169.231:443".parse().unwrap())
        .build()
        .unwrap_or_default()
}
