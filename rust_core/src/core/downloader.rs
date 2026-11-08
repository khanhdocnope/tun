use futures::future::join_all;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Semaphore};
use tracing::{debug, error, warn};

use crate::core::cuutruyen_drm::descramble_cuutruyen;
use crate::error::{MoeJectError, Result};

pub fn validate_image_bytes(bytes: &[u8]) -> bool {
    if bytes.len() < 16 {
        return false;
    }
    // Check PNG, JPEG, WEBP, GIF
    (bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n")
        || (bytes.len() >= 3 && &bytes[0..3] == b"\xff\xd8\xff")
        || (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
        || (bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a"))
}

#[derive(Clone)]
pub struct HostConnectionGate {
    limit_per_host: usize,
    gates: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
}

impl HostConnectionGate {
    pub fn new(limit_per_host: usize) -> Self {
        Self {
            limit_per_host,
            gates: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn get_semaphore(&self, host: &str) -> Arc<Semaphore> {
        let mut map = self.gates.lock().await;
        map.entry(host.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(self.limit_per_host)))
            .clone()
    }
}

#[derive(Clone)]
pub struct Downloader {
    client: reqwest::Client,
    gate: HostConnectionGate,
}

impl Downloader {
    pub fn new(per_host_limit: usize) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(10)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 MoeJect-Core/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            gate: HostConnectionGate::new(per_host_limit),
        }
    }

    pub async fn download_single_page(
        &self,
        index: usize,
        url: &str,
        referer: Option<&str>,
        drm_data: Option<&str>,
        max_retries: u32,
    ) -> Result<Vec<u8>> {
        let parsed_url = reqwest::Url::parse(url)
            .map_err(|e| MoeJectError::InvalidRequest(format!("Invalid URL: {e}")))?;
        let host = parsed_url.host_str().unwrap_or("unknown_host");

        let semaphore = self.gate.get_semaphore(host).await;

        let mut attempt = 0;
        let mut delay = 1000;

        loop {
            attempt += 1;
            // Acquire gated permit
            let _permit = semaphore.acquire().await.map_err(|_| {
                MoeJectError::Internal("Connection gate semaphore closed".to_string())
            })?;

            let mut req = self.client.get(url);
            if let Some(ref_val) = referer {
                req = req.header("Referer", ref_val);
            } else if host.contains("hitomi.la") || host.contains("gold-usergeneratedcontent.net") {
                req = req.header("Referer", "https://hitomi.la/");
            }

            match req.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.bytes().await {
                            Ok(bytes_data) => {
                                let mut raw_bytes = bytes_data.to_vec();

                                // Descamble CuuTruyen DRM if applicable
                                if let Some(drm) = drm_data {
                                    raw_bytes = descramble_cuutruyen(&raw_bytes, drm);
                                }

                                if validate_image_bytes(&raw_bytes) {
                                    debug!("Downloaded page {index} successfully from {url}");
                                    return Ok(raw_bytes);
                                } else {
                                    warn!(
                                        "Page {index} downloaded but failed magic bytes validation (length: {}). Retrying...",
                                        raw_bytes.len()
                                    );
                                }
                            }
                            Err(e) => {
                                warn!("Failed to read response body for page {index}: {e}");
                            }
                        }
                    } else {
                        warn!("HTTP status {} for page {index} on {url}", resp.status());
                    }
                }
                Err(e) => {
                    warn!("Network request failed for page {index}: {e}");
                }
            }

            drop(_permit);

            if attempt >= max_retries {
                error!("Exceeded max retries ({max_retries}) for page {index} on {url}");
                return Err(MoeJectError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!("Failed to download page {index} after {max_retries} attempts"),
                )));
            }

            tokio::time::sleep(Duration::from_millis(delay)).await;
            delay = (delay * 2).min(10000);
        }
    }

    pub async fn download_pages<F>(
        &self,
        urls: &[String],
        referer: Option<&str>,
        drm_data: Option<&str>,
        progress_cb: F,
    ) -> Result<Vec<(usize, Vec<u8>)>>
    where
        F: Fn(usize, usize) + Send + Sync + 'static,
    {
        let total = urls.len();
        let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let progress_cb = Arc::new(progress_cb);

        let mut tasks = Vec::with_capacity(total);

        for (idx, url) in urls.iter().enumerate() {
            let this = self.clone();
            let url = url.clone();
            let referer = referer.map(|s| s.to_string());
            let drm = drm_data.map(|s| s.to_string());
            let counter = counter.clone();
            let cb = progress_cb.clone();

            tasks.push(tokio::spawn(async move {
                let res = this
                    .download_single_page(idx, &url, referer.as_deref(), drm.as_deref(), 3)
                    .await;

                if res.is_ok() {
                    let completed = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    cb(completed, total);
                }

                (idx, res)
            }));
        }

        let results = join_all(tasks).await;
        let mut downloaded_pages = Vec::with_capacity(total);

        for join_res in results {
            let (idx, page_res) = join_res.map_err(|e| {
                MoeJectError::Internal(format!("Tokio download task panicked: {e}"))
            })?;
            match page_res {
                Ok(data) => downloaded_pages.push((idx, data)),
                Err(e) => return Err(e),
            }
        }

        downloaded_pages.sort_by_key(|&(idx, _)| idx);
        Ok(downloaded_pages)
    }
}
