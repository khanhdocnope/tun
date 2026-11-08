pub mod mangadex;
pub mod comick;
pub mod hitomi;
pub mod cuutruyen;
pub mod templates;

use crate::models::{MangaItem, ChapterItem, PageItem};
use std::future::Future;
use std::pin::Pin;

pub trait MangaSource: Send + Sync {
    fn source_id(&self) -> &'static str;
    fn source_name(&self) -> &'static str;

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>>;
    fn get_chapters<'a>(&'a self, manga_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>>;
    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>>;
}
