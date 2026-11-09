use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

/// Connection gating: limits maximum concurrent active requests per host/CDN domain.
#[derive(Clone)]
pub struct HostGate {
    max_per_host: usize,
    semaphores: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
}

impl HostGate {
    pub fn new(max_per_host: usize) -> Self {
        Self {
            max_per_host: max_per_host.max(1),
            semaphores: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Extract domain host string from a URL.
    pub fn extract_host(url: &str) -> String {
        reqwest::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
            .unwrap_or_else(|| "default".to_string())
    }

    /// Acquire an owned permit for the given host.
    /// The permit is held until the response bytes are completely received or error occurs.
    pub async fn acquire(&self, host: &str) -> Option<OwnedSemaphorePermit> {
        let sem = {
            let mut map = self.semaphores.lock().await;
            map.entry(host.to_lowercase())
                .or_insert_with(|| Arc::new(Semaphore::new(self.max_per_host)))
                .clone()
        };
        sem.acquire_owned().await.ok()
    }

    /// Number of available permits for a host.
    pub async fn available_permits(&self, host: &str) -> usize {
        let map = self.semaphores.lock().await;
        if let Some(sem) = map.get(&host.to_lowercase()) {
            sem.available_permits()
        } else {
            self.max_per_host
        }
    }
}
