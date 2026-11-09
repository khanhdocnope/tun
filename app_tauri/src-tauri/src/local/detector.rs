//! Detector chữ kiểu DB (PP-OCR det, ONNX): ảnh -> bản đồ xác suất -> các quad dòng chữ.
//!
//! Hậu xử lý bám theo `DBPostProcess` của PaddleOCR (thresh 0.3, box_thresh 0.5, unclip 1.6),
//! thay `findContours` bằng connected components và Clipper bằng việc nới đều hình chữ nhật xoay
//! (min-area-rect của đa giác unclip bo tròn chính là hình chữ nhật đó nới thêm `d`).
//!
//! Tiền xử lý: ảnh được đưa vào theo thứ tự kênh BGR (như `cv2.imread` mà model được huấn luyện),
//! chuẩn hóa mean/std kiểu ImageNet, cạnh làm tròn về bội số của 32.

use image::imageops::{resize, FilterType};
use image::RgbImage;

use crate::vision::geom::{
    convex_hull, convex_row_ranges, min_area_rect, order_quad, polygon_area, polygon_perimeter, P,
};
use crate::vision::morph::connected_components_8;
use crate::vision::types::{Mask, Poly};

use super::runner::{TensorIn, TensorRunner};

#[derive(Debug, Clone)]
pub struct DetectorConfig {
    pub thresh: f32,
    pub box_thresh: f32,
    pub unclip_ratio: f64,
    pub max_candidates: usize,
    pub min_size: f64,
    /// Giới hạn số pixel đưa vào model (ảnh to sẽ thu nhỏ).
    pub max_pixels: f64,
    pub max_side: u32,
    pub mean: [f32; 3],
    pub std: [f32; 3],
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            thresh: 0.3,
            box_thresh: 0.5,
            unclip_ratio: 1.6,
            max_candidates: 1000,
            min_size: 3.0,
            max_pixels: 2_400_000.0,
            max_side: 4000,
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225],
        }
    }
}

pub struct DbOutput {
    pub quads: Vec<Poly>,
    pub scores: Vec<f32>,
    /// Bitmap prob > thresh, cùng kích thước bản đồ xác suất.
    pub bitmap: Mask,
}

pub struct Detection {
    /// Quad (trên-trái, trên-phải, dưới-phải, dưới-trái) theo tọa độ ảnh gốc.
    pub quads: Vec<Poly>,
    pub scores: Vec<f32>,
    /// Bitmap vùng chữ ở kích thước ảnh gốc.
    pub bitmap: Mask,
}

/// Kích thước đưa vào model: thu nhỏ nếu quá nhiều pixel / quá dài, rồi làm tròn về bội số 32.
pub fn target_size(w: usize, h: usize, cfg: &DetectorConfig) -> (usize, usize) {
    let (wf, hf) = (w as f64, h as f64);
    let scale = (cfg.max_pixels / (wf * hf)).sqrt().min(cfg.max_side as f64 / wf.max(hf)).min(1.0);
    let r32 = |v: f64| ((v / 32.0).round().max(1.0) as usize) * 32;
    (r32(wf * scale), r32(hf * scale))
}

fn box_score(prob: &[f32], w: usize, h: usize, quad: &[P; 4]) -> f32 {
    let (mut sum, mut n) = (0f64, 0usize);
    for (y, x0, x1) in convex_row_ranges(&quad[..], w, h) {
        for x in x0..=x1 {
            sum += prob[y * w + x] as f64;
            n += 1;
        }
    }
    if n == 0 {
        0.0
    } else {
        (sum / n as f64) as f32
    }
}

/// Hậu xử lý bản đồ xác suất `w * h` thành các quad (tọa độ trong bản đồ).
pub fn postprocess_db(prob: &[f32], w: usize, h: usize, cfg: &DetectorConfig) -> DbOutput {
    let bitmap_data: Vec<u8> = prob.iter().map(|&p| if p > cfg.thresh { 255 } else { 0 }).collect();
    let cc = connected_components_8(&bitmap_data, w, h);

    // Cực trị (min x, max x) từng hàng của từng thành phần: đủ để dựng convex hull.
    let mut rows: Vec<Vec<(i32, i32)>> = vec![Vec::new(); cc.count];
    for lab in 1..cc.count {
        rows[lab] = vec![(i32::MAX, i32::MIN); cc.stats[lab].h as usize];
    }
    for y in 0..h {
        for x in 0..w {
            let lab = cc.labels[y * w + x] as usize;
            if lab == 0 {
                continue;
            }
            let r = (y as i32 - cc.stats[lab].y) as usize;
            let e = &mut rows[lab][r];
            e.0 = e.0.min(x as i32);
            e.1 = e.1.max(x as i32);
        }
    }

    let mut quads: Vec<Poly> = Vec::new();
    let mut scores: Vec<f32> = Vec::new();
    for lab in 1..cc.count.min(cfg.max_candidates + 1) {
        let y0 = cc.stats[lab].y;
        let mut pts: Vec<(i32, i32)> = Vec::new();
        for (i, &(a, b)) in rows[lab].iter().enumerate() {
            if a <= b {
                let y = y0 + i as i32;
                pts.push((a, y));
                pts.push((b, y));
            }
        }
        let Some(rect) = min_area_rect(&convex_hull(&pts)) else { continue };
        if rect.w.min(rect.h) < cfg.min_size {
            continue;
        }

        let ordered = order_quad(rect.corners);
        let score = box_score(prob, w, h, &ordered);
        if score < cfg.box_thresh {
            continue;
        }

        let perimeter = polygon_perimeter(&ordered);
        if perimeter <= 0.0 {
            continue;
        }
        let d = polygon_area(&ordered) * cfg.unclip_ratio / perimeter;
        let expanded = rect.expanded(d);
        if expanded.w.min(expanded.h) < cfg.min_size + 2.0 {
            continue;
        }

        let fin = order_quad(expanded.corners);
        quads.push(
            fin.iter()
                .map(|p| [p[0].clamp(0.0, w as f64) as f32, p[1].clamp(0.0, h as f64) as f32])
                .collect(),
        );
        scores.push(score);
    }

    DbOutput { quads, scores, bitmap: Mask { width: w, height: h, data: bitmap_data } }
}

pub fn detect(runner: &dyn TensorRunner, img: &RgbImage, cfg: &DetectorConfig) -> Result<Detection, String> {
    let (ow, oh) = (img.width() as usize, img.height() as usize);
    if ow == 0 || oh == 0 {
        return Ok(Detection { quads: Vec::new(), scores: Vec::new(), bitmap: Mask::new(ow, oh) });
    }

    let (nw, nh) = target_size(ow, oh, cfg);
    let resized;
    let src: &RgbImage = if (nw, nh) == (ow, oh) {
        img
    } else {
        resized = resize(img, nw as u32, nh as u32, FilterType::Triangle);
        &resized
    };

    let plane = nw * nh;
    let raw = src.as_raw();
    let mut data = vec![0f32; 3 * plane];
    for i in 0..plane {
        let bgr = [raw[i * 3 + 2], raw[i * 3 + 1], raw[i * 3]];
        for c in 0..3 {
            data[c * plane + i] = (bgr[c] as f32 / 255.0 - cfg.mean[c]) / cfg.std[c];
        }
    }

    let outs = runner.run(&[TensorIn { shape: vec![1, 3, nh, nw], data: &data }])?;
    let out = outs.first().ok_or("detector không trả về output nào")?;
    if out.data.len() != plane {
        return Err(format!(
            "output detector có {} phần tử, cần {} ({}x{}); kiểm tra model có đúng DB det không",
            out.data.len(),
            plane,
            nw,
            nh
        ));
    }

    let db = postprocess_db(&out.data, nw, nh, cfg);
    let (sx, sy) = (ow as f32 / nw as f32, oh as f32 / nh as f32);
    let quads = db
        .quads
        .iter()
        .map(|q| q.iter().map(|p| [p[0] * sx, p[1] * sy]).collect())
        .collect();

    Ok(Detection { quads, scores: db.scores, bitmap: db.bitmap.resize_nearest(ow, oh) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::runner::TensorOut;
    use crate::local::test_util::MockRunner;
    use image::Rgb;

    fn blob(w: usize, h: usize, x0: usize, y0: usize, x1: usize, y1: usize, v: f32) -> Vec<f32> {
        let mut p = vec![0.0; w * h];
        for y in y0..y1 {
            for x in x0..x1 {
                p[y * w + x] = v;
            }
        }
        p
    }

    fn bbox(q: &Poly) -> (f32, f32, f32, f32) {
        let xs = q.iter().map(|p| p[0]);
        let ys = q.iter().map(|p| p[1]);
        (
            xs.clone().fold(f32::MAX, f32::min),
            ys.clone().fold(f32::MAX, f32::min),
            xs.fold(f32::MIN, f32::max),
            ys.fold(f32::MIN, f32::max),
        )
    }

    #[test]
    fn target_size_rounds_to_32_and_limits() {
        let cfg = DetectorConfig::default();
        assert_eq!(target_size(800, 1200, &cfg), (800, 1216));
        assert_eq!(target_size(100, 60, &cfg), (96, 64));
        assert_eq!(target_size(800, 12000, &cfg), (256, 4000));
    }

    #[test]
    fn postprocess_finds_one_unclipped_quad() {
        let prob = blob(192, 128, 40, 50, 120, 70, 0.9);
        let out = postprocess_db(&prob, 192, 128, &DetectorConfig::default());
        assert_eq!(out.quads.len(), 1);
        assert!((out.scores[0] - 0.9).abs() < 1e-4);
        let (x0, y0, x1, y1) = bbox(&out.quads[0]);
        // tâm (79.5, 59.5), rect 79x19 nới d = 1501*1.6/196 = 12.25
        assert!((x0 - 27.75).abs() < 0.05 && (x1 - 131.25).abs() < 0.05, "x {} {}", x0, x1);
        assert!((y0 - 37.75).abs() < 0.05 && (y1 - 81.25).abs() < 0.05, "y {} {}", y0, y1);
        assert_eq!(out.bitmap.get(60, 60), 255);
        assert_eq!(out.bitmap.get(5, 5), 0);
    }

    #[test]
    fn low_score_and_thin_blobs_are_dropped() {
        let cfg = DetectorConfig::default();
        // trên ngưỡng bitmap (0.3) nhưng điểm trung bình < box_thresh (0.5)
        assert!(postprocess_db(&blob(192, 128, 40, 50, 120, 70, 0.4), 192, 128, &cfg).quads.is_empty());
        // quá mỏng (cao 2px)
        assert!(postprocess_db(&blob(192, 128, 40, 50, 120, 52, 0.9), 192, 128, &cfg).quads.is_empty());
        // không có gì
        assert!(postprocess_db(&vec![0.0; 192 * 128], 192, 128, &cfg).quads.is_empty());
    }

    #[test]
    fn detect_resizes_normalizes_bgr_and_rescales_quads() {
        let img = RgbImage::from_pixel(200, 120, Rgb([255, 255, 255]));
        let runner = MockRunner::new(|inputs| {
            assert_eq!(inputs.len(), 1);
            assert_eq!(inputs[0].shape, vec![1, 3, 128, 192]);
            // pixel trắng, kênh 0 (B): (1 - 0.485) / 0.229
            assert!((inputs[0].data[0] - 2.2489).abs() < 1e-3);
            Ok(vec![TensorOut { shape: vec![1, 1, 128, 192], data: blob(192, 128, 40, 50, 120, 70, 0.9) }])
        });
        let det = detect(&runner, &img, &DetectorConfig::default()).unwrap();
        assert_eq!(det.quads.len(), 1);
        let (x0, y0, x1, y1) = bbox(&det.quads[0]);
        let (sx, sy) = (200.0 / 192.0, 120.0 / 128.0);
        assert!((x0 - 27.75 * sx).abs() < 0.1 && (x1 - 131.25 * sx).abs() < 0.1);
        assert!((y0 - 37.75 * sy).abs() < 0.1 && (y1 - 81.25 * sy).abs() < 0.1);
        assert_eq!((det.bitmap.width, det.bitmap.height), (200, 120));
    }

    #[test]
    fn detect_rejects_wrong_output_size() {
        let img = RgbImage::from_pixel(64, 64, Rgb([0, 0, 0]));
        let runner = MockRunner::new(|_| Ok(vec![TensorOut { shape: vec![1], data: vec![0.0; 10] }]));
        assert!(detect(&runner, &img, &DetectorConfig::default()).is_err());
    }
}
