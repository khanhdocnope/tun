pub mod comick;
pub mod cuutruyen;
pub mod hitomi;
pub mod mangadex;

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;

use crate::error::{MoeJectError, Result};
use crate::models::{MangaInfo, MangaSearchResult, SourceMetadata};

#[async_trait]
pub trait MangaSource: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn metadata(&self) -> SourceMetadata;

    async fn search(&self, query: &str, page: u32) -> Result<Vec<MangaSearchResult>>;
    async fn get_latest_updates(&self, page: u32) -> Result<Vec<MangaSearchResult>> {
        self.search("", page).await
    }
    async fn get_manga_details(&self, id_or_url: &str) -> Result<MangaInfo>;
    async fn get_chapter_pages(&self, chapter_id_or_url: &str) -> Result<Vec<String>>;
}

pub struct SourceRegistry {
    sources: HashMap<String, Arc<dyn MangaSource>>,
}

impl SourceRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            sources: HashMap::new(),
        };

        registry.register(Arc::new(mangadex::MangaDexSource::new()));
        registry.register(Arc::new(comick::ComickSource::new()));
        registry.register(Arc::new(hitomi::HitomiSource::new()));
        registry.register(Arc::new(cuutruyen::CuuTruyenSource::new()));

        registry
    }

    pub fn register(&mut self, source: Arc<dyn MangaSource>) {
        self.sources.insert(source.id().to_lowercase(), source);
    }

    pub fn get(&self, id: &str) -> Result<Arc<dyn MangaSource>> {
        self.sources
            .get(&id.to_lowercase())
            .cloned()
            .ok_or_else(|| MoeJectError::SourceNotFound(id.to_string()))
    }

    pub fn list_metadata(&self) -> Vec<SourceMetadata> {
        let mut list: Vec<SourceMetadata> = self.sources.values().map(|s| s.metadata()).collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }
}
