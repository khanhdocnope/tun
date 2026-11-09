//! Engine AI chạy trên máy: detector DB + LaMa inpainting, nói chuyện với model qua `TensorRunner`.
//!
//! Toàn bộ logic (tiền xử lý, hậu xử lý DB, gộp dòng, chia cửa sổ, blend) viết trên trait
//! `TensorRunner` nên test được bằng runner giả mà không cần file model. Chỉ adapter `ort`
//! (feature `local-ort`) mới chạm vào ONNX Runtime.

pub mod detector;
pub mod engine;
pub mod lama;
#[cfg(feature = "local-ort")]
pub mod ort_runner;
pub mod runner;
pub mod textline;

#[cfg(test)]
pub(crate) mod test_util;
