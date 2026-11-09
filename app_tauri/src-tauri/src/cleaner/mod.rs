//! Cleaner hybrid: cùng một trait, nhiều backend (Cloud = HF Space, Local = ONNX).
//!
//! `AppSettings.cleaner_mode` quyết định cách chọn backend:
//! - `Cloud`: chỉ gọi HF Space.
//! - `Local`: chỉ chạy trên máy.
//! - `Auto` : thử backend ưu tiên trước, lỗi "có thể thử chỗ khác" (mất mạng, hết quota,
//!            model chưa cài...) thì chuyển sang backend còn lại. Lỗi `Invalid` (ảnh hỏng)
//!            thì dừng ngay vì backend nào cũng sẽ lỗi như nhau.

pub mod client; // Gradio SSE client cũ, vẫn dùng làm fallback cho Space chưa có /v1/clean
pub mod cloud;
pub mod local;

use std::fmt;
use std::future::Future;
use std::pin::Pin;

use crate::models::CleanerMode;

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone)]
pub struct CleanParams {
    pub detector: String,
    pub inpainter: String,
    pub dilation_offset: i32,
    pub clean_mode: String, // "all" | "bubble_only"
}

#[derive(Debug, Clone)]
pub struct CleanOutput {
    pub image: Vec<u8>,
    pub mime: &'static str,
    pub backend: &'static str,
}

#[derive(Debug, Clone)]
pub enum CleanError {
    /// Đầu vào sai (ảnh hỏng, tham số sai). Không fallback.
    Invalid(String),
    /// Backend không dùng được (chưa cài model, sai token, endpoint chưa sẵn sàng).
    Unavailable(String),
    /// Lỗi mạng / timeout.
    Network(String),
    /// Backend trả lỗi (5xx, hết quota ZeroGPU...).
    Server(String),
}

impl CleanError {
    pub fn can_fallback(&self) -> bool {
        !matches!(self, CleanError::Invalid(_))
    }
}

impl fmt::Display for CleanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CleanError::Invalid(m) => write!(f, "đầu vào không hợp lệ: {m}"),
            CleanError::Unavailable(m) => write!(f, "không khả dụng: {m}"),
            CleanError::Network(m) => write!(f, "lỗi mạng: {m}"),
            CleanError::Server(m) => write!(f, "lỗi máy chủ: {m}"),
        }
    }
}

pub trait Cleaner: Send + Sync {
    fn id(&self) -> &'static str;
    /// Kiểm tra nhanh (vài giây) backend có dùng được không.
    fn is_available(&self) -> BoxFut<'_, bool>;
    fn clean<'a>(
        &'a self,
        image: &'a [u8],
        params: &'a CleanParams,
    ) -> BoxFut<'a, Result<CleanOutput, CleanError>>;
}

/// Đoán MIME từ magic bytes (dùng cho data URL ở frontend).
pub fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

pub async fn clean_with_mode(
    mode: CleanerMode,
    prefer_local: bool,
    cloud: &dyn Cleaner,
    local: &dyn Cleaner,
    image: &[u8],
    params: &CleanParams,
) -> Result<CleanOutput, String> {
    fn tag(id: &str, e: &CleanError) -> String {
        format!("[{}] {}", id, e)
    }

    match mode {
        CleanerMode::Cloud => cloud.clean(image, params).await.map_err(|e| tag(cloud.id(), &e)),
        CleanerMode::Local => local.clean(image, params).await.map_err(|e| tag(local.id(), &e)),
        CleanerMode::Auto => {
            let local_ok = local.is_available().await;
            let order: Vec<&dyn Cleaner> = match (local_ok, prefer_local) {
                (true, true) => vec![local, cloud],
                (true, false) => vec![cloud, local],
                (false, _) => vec![cloud],
            };

            let mut errors: Vec<String> = Vec::new();
            for c in order {
                match c.clean(image, params).await {
                    Ok(out) => return Ok(out),
                    Err(e) => {
                        let stop = !e.can_fallback();
                        errors.push(tag(c.id(), &e));
                        if stop {
                            break;
                        }
                    }
                }
            }
            Err(errors.join(" → "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    struct Mock {
        id: &'static str,
        available: bool,
        result: Result<(), CleanError>,
        calls: Arc<AtomicUsize>,
    }

    impl Mock {
        fn new(id: &'static str, available: bool, result: Result<(), CleanError>) -> Self {
            Self { id, available, result, calls: Arc::new(AtomicUsize::new(0)) }
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl Cleaner for Mock {
        fn id(&self) -> &'static str {
            self.id
        }
        fn is_available(&self) -> BoxFut<'_, bool> {
            Box::pin(async move { self.available })
        }
        fn clean<'a>(&'a self, _i: &'a [u8], _p: &'a CleanParams) -> BoxFut<'a, Result<CleanOutput, CleanError>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                match &self.result {
                    Ok(()) => Ok(CleanOutput { image: vec![1], mime: "image/webp", backend: self.id }),
                    Err(e) => Err(e.clone()),
                }
            })
        }
    }

    fn params() -> CleanParams {
        CleanParams {
            detector: "default".into(),
            inpainter: "lama_large".into(),
            dilation_offset: 2,
            clean_mode: "all".into(),
        }
    }

    #[tokio::test]
    async fn auto_prefers_local_then_falls_back_to_cloud() {
        let local = Mock::new("local", true, Err(CleanError::Unavailable("x".into())));
        let cloud = Mock::new("cloud", true, Ok(()));
        let out = clean_with_mode(CleanerMode::Auto, true, &cloud, &local, b"img", &params()).await.unwrap();
        assert_eq!(out.backend, "cloud");
        assert_eq!((local.calls(), cloud.calls()), (1, 1));
    }

    #[tokio::test]
    async fn auto_skips_unavailable_local() {
        let local = Mock::new("local", false, Ok(()));
        let cloud = Mock::new("cloud", true, Ok(()));
        let out = clean_with_mode(CleanerMode::Auto, true, &cloud, &local, b"img", &params()).await.unwrap();
        assert_eq!(out.backend, "cloud");
        assert_eq!(local.calls(), 0);
    }

    #[tokio::test]
    async fn auto_stops_on_invalid_input() {
        let local = Mock::new("local", true, Err(CleanError::Invalid("bad".into())));
        let cloud = Mock::new("cloud", true, Ok(()));
        let err = clean_with_mode(CleanerMode::Auto, true, &cloud, &local, b"img", &params()).await.unwrap_err();
        assert!(err.contains("local"));
        assert_eq!(cloud.calls(), 0);
    }

    #[tokio::test]
    async fn explicit_modes_never_fall_back() {
        let local = Mock::new("local", true, Ok(()));
        let cloud = Mock::new("cloud", true, Err(CleanError::Network("down".into())));
        let err = clean_with_mode(CleanerMode::Cloud, true, &cloud, &local, b"img", &params()).await.unwrap_err();
        assert!(err.contains("cloud"));
        assert_eq!(local.calls(), 0);
    }

    #[test]
    fn sniff_mime_works() {
        assert_eq!(sniff_mime(&[0x89, 0x50, 0x4E, 0x47]), "image/png");
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(sniff_mime(b"<html>"), "application/octet-stream");
    }
}
