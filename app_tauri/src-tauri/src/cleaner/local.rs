//! LocalCleaner: xóa chữ ngay trên máy (detector DB + LaMa qua ONNX Runtime).
//!
//! Cần build với `--features local-ort` và 2 file model trong `local_model_dir`
//! (`detector.onnx`, `lama.onnx`; lấy bằng `tools/fetch_models.py`). Thiếu một trong hai điều kiện
//! thì `is_available()` trả false và chế độ Auto tự dùng Cloud.
//!
//! Logic nằm ở `crate::local` (engine) và `crate::vision`; file này chỉ là lớp nối vào trait `Cleaner`.

use std::path::PathBuf;

use super::{BoxFut, CleanError, CleanOutput, CleanParams, Cleaner};
use crate::local::engine::{DETECTOR_FILE, LAMA_FILE};
use crate::vision::pipeline::CleanScope;

pub const REQUIRED_MODELS: [&str; 2] = [DETECTOR_FILE, LAMA_FILE];

pub struct LocalCleaner {
    model_dir: Option<PathBuf>,
}

impl LocalCleaner {
    pub fn new(model_dir: Option<PathBuf>) -> Self {
        Self { model_dir }
    }

    fn missing_models(&self) -> Result<(), String> {
        let dir = self.model_dir.as_ref().ok_or("chưa chọn thư mục model local")?;
        let missing: Vec<&str> = REQUIRED_MODELS
            .iter()
            .copied()
            .filter(|f| !dir.join(f).is_file())
            .collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(format!("thiếu model: {}", missing.join(", ")))
        }
    }
}

impl Cleaner for LocalCleaner {
    fn id(&self) -> &'static str {
        "local"
    }

    fn is_available(&self) -> BoxFut<'_, bool> {
        Box::pin(async move { cfg!(feature = "local-ort") && self.missing_models().is_ok() })
    }

    fn clean<'a>(&'a self, image: &'a [u8], params: &'a CleanParams) -> BoxFut<'a, Result<CleanOutput, CleanError>> {
        Box::pin(async move {
            self.missing_models().map_err(CleanError::Unavailable)?;
            let dir = self.model_dir.clone().ok_or_else(|| CleanError::Unavailable("chưa chọn thư mục model".into()))?;
            let bytes = image.to_vec();
            let scope = CleanScope::parse(&params.clean_mode);
            let offset = params.dilation_offset;

            // Suy luận nặng CPU/GPU: tách khỏi runtime async.
            tokio::task::spawn_blocking(move || run_blocking(dir, bytes, scope, offset))
                .await
                .map_err(|e| CleanError::Server(format!("tác vụ local bị hủy: {e}")))?
        })
    }
}

#[cfg(not(feature = "local-ort"))]
fn run_blocking(_dir: PathBuf, _bytes: Vec<u8>, _scope: CleanScope, _offset: i32) -> Result<CleanOutput, CleanError> {
    Err(CleanError::Unavailable("bản build này chưa bật feature `local-ort`".into()))
}

#[cfg(feature = "local-ort")]
fn run_blocking(dir: PathBuf, bytes: Vec<u8>, scope: CleanScope, offset: i32) -> Result<CleanOutput, CleanError> {
    let img = image::load_from_memory(&bytes)
        .map_err(|e| CleanError::Invalid(format!("không đọc được ảnh: {e}")))?
        .to_rgb8();

    let engine = cached::get_engine(&dir).map_err(CleanError::Unavailable)?;
    let report = engine.clean(&img, scope, offset).map_err(CleanError::Server)?;

    let mut buf: Vec<u8> = Vec::new();
    report
        .image
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::WebP)
        .map_err(|e| CleanError::Server(format!("mã hóa kết quả thất bại: {e}")))?;
    Ok(CleanOutput { image: buf, mime: "image/webp", backend: "local" })
}

/// Giữ engine đã nạp (nạp model mất vài giây) và nạp lại khi đổi thư mục.
#[cfg(feature = "local-ort")]
mod cached {
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, OnceLock};

    use crate::local::engine::LocalEngine;

    static ENGINE: OnceLock<Mutex<Option<(PathBuf, Arc<LocalEngine>)>>> = OnceLock::new();

    pub fn get_engine(dir: &Path) -> Result<Arc<LocalEngine>, String> {
        let cell = ENGINE.get_or_init(|| Mutex::new(None));
        let mut guard = cell.lock().map_err(|_| "khóa engine bị hỏng".to_string())?;
        if let Some((cached_dir, engine)) = guard.as_ref() {
            if cached_dir == dir {
                return Ok(engine.clone());
            }
        }
        let engine = Arc::new(LocalEngine::load(dir)?);
        *guard = Some((dir.to_path_buf(), engine.clone()));
        Ok(engine)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> CleanParams {
        CleanParams {
            detector: "default".into(),
            inpainter: "lama_large".into(),
            dilation_offset: 2,
            clean_mode: "all".into(),
        }
    }

    #[tokio::test]
    async fn unavailable_without_model_dir_or_files() {
        let none = LocalCleaner::new(None);
        assert!(!none.is_available().await);
        assert!(matches!(none.clean(b"x", &params()).await, Err(CleanError::Unavailable(_))));

        let empty = LocalCleaner::new(Some(std::env::temp_dir().join("moeject-no-such-dir")));
        assert!(!empty.is_available().await);
        let err = empty.clean(b"x", &params()).await.unwrap_err();
        assert!(err.to_string().contains("thiếu model"));
        assert!(err.can_fallback());
    }
}
