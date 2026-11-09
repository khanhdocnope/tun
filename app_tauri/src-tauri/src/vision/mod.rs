//! Thị giác máy tính thuần Rust cho LocalCleaner (không phụ thuộc OpenCV).
//!
//! Đã port từ Python:
//! - `classify`: `classify_text_region` (hf_spaces_manga_cleaner/app.py) - khớp 100% theo golden test.
//! - `mask`    : mask refinement kiểu "fit_text" (xem ghi chú về độ khớp trong `mask.rs`).
//! - `morph`   : dilate (ellipse / rect) + connected components, đối chiếu với OpenCV bằng golden test.
//!
//! Chưa port: text detector (CTD/DBNet) và inpainter (LaMa) - cần `ort`.
//! Fixture golden sinh bằng `tools/gen_golden.py`.

pub mod classify;
pub mod geom;
pub mod mask;
pub mod morph;
pub mod pipeline;
pub mod stroke;
pub mod types;
