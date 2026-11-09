//! LocalEngine: ghép detector -> stroke mask -> gộp dòng -> classify/refine -> LaMa.

use image::RgbImage;

use crate::vision::pipeline::{select_and_refine, CleanScope};
use crate::vision::stroke::stroke_mask;

use super::detector::{detect, DetectorConfig};
use super::lama::{inpaint_page, LamaConfig};
use super::runner::TensorRunner;
use super::textline::group_lines;

pub const DETECTOR_FILE: &str = "detector.onnx";
pub const LAMA_FILE: &str = "lama.onnx";

pub struct LocalEngine {
    detector: Box<dyn TensorRunner>,
    lama: Box<dyn TensorRunner>,
    pub det_cfg: DetectorConfig,
    pub lama_cfg: LamaConfig,
}

#[derive(Debug)]
pub struct CleanReport {
    pub image: RgbImage,
    /// Số vùng chữ phát hiện được.
    pub regions: usize,
    /// Số vùng thực sự bị xóa (sau khi lọc theo chế độ).
    pub active: usize,
}

impl LocalEngine {
    pub fn new(detector: Box<dyn TensorRunner>, lama: Box<dyn TensorRunner>) -> Self {
        Self { detector, lama, det_cfg: DetectorConfig::default(), lama_cfg: LamaConfig::default() }
    }

    /// Nạp 2 model ONNX từ `dir` (cần feature `local-ort`).
    #[cfg(feature = "local-ort")]
    pub fn load(dir: &std::path::Path) -> Result<Self, String> {
        use super::ort_runner::OrtRunner;
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
        let detector = OrtRunner::load(&dir.join(DETECTOR_FILE), threads)?;
        let lama = OrtRunner::load(&dir.join(LAMA_FILE), threads)?;
        Ok(Self::new(Box::new(detector), Box::new(lama)))
    }

    pub fn clean(&self, img: &RgbImage, scope: CleanScope, dilation_offset: i32) -> Result<CleanReport, String> {
        let det = detect(self.detector.as_ref(), img, &self.det_cfg)?;
        if det.quads.is_empty() {
            return Ok(CleanReport { image: img.clone(), regions: 0, active: 0 });
        }

        let raw = stroke_mask(img, &det.quads, Some(&det.bitmap));
        let regions = group_lines(&det.quads);
        let total = regions.len();
        let page = select_and_refine(img, regions, &raw, scope, dilation_offset);
        if page.mask.is_empty() {
            return Ok(CleanReport { image: img.clone(), regions: total, active: page.active });
        }

        let image = inpaint_page(self.lama.as_ref(), img, &page.mask, &self.lama_cfg)?;
        Ok(CleanReport { image, regions: total, active: page.active })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::runner::TensorOut;
    use crate::local::test_util::MockRunner;
    use image::Rgb;

    /// Ảnh 200x120 nền `bg`, 4 vạch đen 6x12 (x = 70, 82, 94, 106; y = 48..60) và 1 chấm đen 4x4 ngoài vùng chữ.
    fn page(bg: [u8; 3]) -> RgbImage {
        let mut img = RgbImage::from_pixel(200, 120, Rgb(bg));
        for x0 in [70u32, 82, 94, 106] {
            for y in 48..60 {
                for x in x0..x0 + 6 {
                    img.put_pixel(x, y, Rgb([0, 0, 0]));
                }
            }
        }
        for y in 5..9 {
            for x in 5..9 {
                img.put_pixel(x, y, Rgb([0, 0, 0]));
            }
        }
        img
    }

    /// Detector giả: ảnh vào được resize về 192x128 nên khối chữ nằm ở x 64..112, y 48..68.
    fn detector() -> Box<dyn TensorRunner> {
        Box::new(MockRunner::new(|inputs| {
            assert_eq!(inputs[0].shape, vec![1, 3, 128, 192]);
            let mut p = vec![0.0f32; 192 * 128];
            for y in 48..68 {
                for x in 64..112 {
                    p[y * 192 + x] = 0.9;
                }
            }
            Ok(vec![TensorOut { shape: vec![1, 1, 128, 192], data: p }])
        }))
    }

    fn white_lama() -> Box<dyn TensorRunner> {
        Box::new(MockRunner::new(|inputs| {
            let (th, tw) = (inputs[0].shape[2], inputs[0].shape[3]);
            Ok(vec![TensorOut { shape: vec![1, 3, th, tw], data: vec![1.0; 3 * th * tw] }])
        }))
    }

    fn dark_pixels(img: &RgbImage) -> usize {
        img.pixels().filter(|p| p.0 == [0, 0, 0]).count()
    }

    #[test]
    fn bubble_text_is_removed_and_the_rest_is_untouched() {
        let engine = LocalEngine::new(detector(), white_lama());
        let img = page([255, 255, 255]);
        assert_eq!(dark_pixels(&img), 4 * 6 * 12 + 16);

        let rep = engine.clean(&img, CleanScope::All, 2).unwrap();
        assert_eq!((rep.regions, rep.active), (1, 1));
        // 4 vạch chữ biến mất, chỉ còn chấm 4x4 ngoài vùng chữ.
        assert_eq!(dark_pixels(&rep.image), 16);
        assert_eq!(rep.image.get_pixel(6, 6).0, [0, 0, 0]);
        assert_eq!(rep.image.get_pixel(72, 52).0, [255, 255, 255]);
    }

    #[test]
    fn nothing_detected_returns_original_without_calling_lama() {
        let detector = Box::new(MockRunner::new(|_| {
            Ok(vec![TensorOut { shape: vec![1, 1, 128, 192], data: vec![0.0; 192 * 128] }])
        }));
        let lama = Box::new(MockRunner::new(|_| Err("không được gọi".into())));
        let engine = LocalEngine::new(detector, lama);
        let img = page([255, 255, 255]);
        let rep = engine.clean(&img, CleanScope::All, 2).unwrap();
        assert_eq!((rep.regions, rep.active), (0, 0));
        assert_eq!(rep.image, img);
    }

    #[test]
    fn bubble_only_skips_sfx_region_but_all_cleans_it() {
        let engine = LocalEngine::new(detector(), white_lama());
        let img = page([220, 30, 30]);

        let rep = engine.clean(&img, CleanScope::BubbleOnly, 2).unwrap();
        assert_eq!((rep.regions, rep.active), (1, 0));
        assert_eq!(rep.image, img);

        let rep = engine.clean(&img, CleanScope::All, 2).unwrap();
        assert_eq!(rep.active, 1);
        assert_eq!(rep.image.get_pixel(72, 52).0, [255, 255, 255]);
        assert_eq!(rep.image.get_pixel(100, 100).0, [220, 30, 30], "ngoài mask không đổi");
    }
}
