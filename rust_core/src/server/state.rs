use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api::SourceRegistry;
use crate::core::downloader::Downloader;
use crate::models::DownloadTaskStatus;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<SourceRegistry>,
    pub downloader: Arc<Downloader>,
    pub tasks: Arc<RwLock<HashMap<String, DownloadTaskStatus>>>,
    pub downloads_dir: PathBuf,
}

impl AppState {
    pub fn new(downloads_dir: PathBuf) -> Self {
        Self {
            registry: Arc::new(SourceRegistry::new()),
            downloader: Arc::new(Downloader::new(6)),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            downloads_dir,
        }
    }
}
