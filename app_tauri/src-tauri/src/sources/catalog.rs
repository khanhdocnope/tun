use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceCatalogEntry {
    pub id: String,
    pub name: String,
    pub url: String,
    pub template: String,
    pub languages: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceCatalog {
    pub total: usize,
    pub templates_supported: Vec<String>,
    pub sources: Vec<SourceCatalogEntry>,
}

pub fn get_catalog() -> &'static SourceCatalog {
    static CATALOG: OnceLock<SourceCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let json_str = include_str!("data/sources_catalog.json");
        let clean_str = json_str.trim_start_matches('\u{feff}');
        match serde_json::from_str(clean_str) {
            Ok(cat) => cat,
            Err(e) => {
                panic!("Failed to parse sources_catalog.json: {}", e);
            }
        }
    })
}

/// Search catalog sources by name or language.
pub fn search_catalog_sources(query: &str, lang: Option<&str>) -> Vec<SourceCatalogEntry> {
    let cat = get_catalog();
    let q = query.trim().to_lowercase();
    cat.sources
        .iter()
        .filter(|s| {
            if let Some(target_lang) = lang {
                if target_lang != "all" && !s.languages.iter().any(|l| l == target_lang) {
                    return false;
                }
            }
            if q.is_empty() {
                true
            } else {
                s.name.to_lowercase().contains(&q) || s.id.to_lowercase().contains(&q)
            }
        })
        .cloned()
        .collect()
}

pub fn find_source_by_id(id: &str) -> Option<SourceCatalogEntry> {
    let cat = get_catalog();
    cat.sources.iter().find(|s| s.id.eq_ignore_ascii_case(id)).cloned()
}

pub fn is_template_supported(template: &str) -> bool {
    matches!(
        template,
        "WordPressMadara" | "WordPressMangastream" | "MojoPortalComic"
    )
}

