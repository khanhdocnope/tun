//! Tách nét chữ trong từng hộp dòng bằng ngưỡng Otsu (thay cho mask nét chữ của detector CTD).
//!
//! Detector PP-OCR chỉ cho vùng chữ (đã co), không cho nét. Trong mỗi hộp ta lấy lớp màu ÍT pixel
//! hơn (chữ thường chiếm ít diện tích hơn nền); nếu hộp gần như một màu (độ tương phản thấp) thì
//! dùng bitmap của detector làm dự phòng.

use image::RgbImage;

use super::classify::gray8;
use super::geom::{convex_row_ranges, P};
use super::types::{Mask, Poly};

/// Giống `cv2.threshold(gray, 0, 255, THRESH_OTSU)`: trả ngưỡng t, pixel > t là lớp sáng.
pub fn otsu_threshold(hist: &[u32; 256]) -> u8 {
    let total: u64 = hist.iter().map(|&c| c as u64).sum();
    if total == 0 {
        return 0;
    }
    let scale = 1.0 / total as f64;
    let mu: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * c as f64).sum::<f64>() * scale;

    const EPS: f64 = 1.1920929e-07;
    let (mut mu1, mut q1) = (0.0f64, 0.0f64);
    let (mut max_sigma, mut max_val) = (0.0f64, 0u8);
    for (i, &c) in hist.iter().enumerate() {
        let p = c as f64 * scale;
        mu1 *= q1;
        q1 += p;
        let q2 = 1.0 - q1;
        if q1.min(q2) < EPS || q1.max(q2) > 1.0 - EPS {
            continue;
        }
        mu1 = (mu1 + i as f64 * p) / q1;
        let mu2 = (mu - q1 * mu1) / q2;
        let sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
        if sigma > max_sigma {
            max_sigma = sigma;
            max_val = i as u8;
        }
    }
    max_val
}

/// Độ lệch trung bình tối thiểu giữa hai lớp để coi hộp là "có chữ rõ".
const MIN_CONTRAST: f64 = 25.0;
/// Số pixel tối thiểu trong hộp.
const MIN_PIXELS: usize = 16;

pub fn stroke_mask(img: &RgbImage, quads: &[Poly], fallback: Option<&Mask>) -> Mask {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let mut out = Mask::new(w, h);
    let raw = img.as_raw();

    for quad in quads {
        let poly: Vec<P> = quad.iter().map(|p| [p[0] as f64, p[1] as f64]).collect();
        let ranges = convex_row_ranges(&poly, w, h);

        let mut hist = [0u32; 256];
        let mut count = 0usize;
        for &(y, x0, x1) in &ranges {
            for x in x0..=x1 {
                let o = (y * w + x) * 3;
                hist[gray8(raw[o] as u32, raw[o + 1] as u32, raw[o + 2] as u32) as usize] += 1;
                count += 1;
            }
        }
        if count < MIN_PIXELS {
            continue;
        }

        let t = otsu_threshold(&hist);
        let (mut n_lo, mut n_hi) = (0usize, 0usize);
        let (mut s_lo, mut s_hi) = (0f64, 0f64);
        for (v, &c) in hist.iter().enumerate() {
            if v as u8 <= t {
                n_lo += c as usize;
                s_lo += v as f64 * c as f64;
            } else {
                n_hi += c as usize;
                s_hi += v as f64 * c as f64;
            }
        }
        let contrast = if n_lo > 0 && n_hi > 0 { (s_hi / n_hi as f64 - s_lo / n_lo as f64).abs() } else { 0.0 };
        let text_is_dark = n_lo <= n_hi;

        for &(y, x0, x1) in &ranges {
            for x in x0..=x1 {
                let i = y * w + x;
                let keep = if contrast >= MIN_CONTRAST {
                    let o = i * 3;
                    let g = gray8(raw[o] as u32, raw[o + 1] as u32, raw[o + 2] as u32);
                    (g <= t) == text_is_dark
                } else {
                    fallback.map_or(false, |f| f.data[i] != 0)
                };
                if keep {
                    out.data[i] = 255;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use image::Rgb;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/golden/geom_cases.json");

    #[test]
    fn otsu_matches_opencv() {
        let g: Value = serde_json::from_str(GOLDEN).unwrap();
        let cases = g["otsu"].as_array().unwrap();
        assert!(cases.len() >= 20);
        for (i, c) in cases.iter().enumerate() {
            let gray = base64::engine::general_purpose::STANDARD.decode(c["gray"].as_str().unwrap()).unwrap();
            let mut hist = [0u32; 256];
            for v in gray {
                hist[v as usize] += 1;
            }
            assert_eq!(otsu_threshold(&hist) as u64, c["threshold"].as_u64().unwrap(), "case {}", i);
        }
    }

    #[test]
    fn dark_text_on_white_is_selected() {
        let mut img = RgbImage::from_pixel(60, 40, Rgb([255, 255, 255]));
        for y in 15..25 {
            for x in 20..24 {
                img.put_pixel(x, y, Rgb([0, 0, 0]));
            }
        }
        let quad = vec![[10.0, 10.0], [50.0, 10.0], [50.0, 30.0], [10.0, 30.0]];
        let m = stroke_mask(&img, &[quad], None);
        assert_eq!(m.get(21, 20), 255);
        assert_eq!(m.get(40, 12), 0);
        assert_eq!(m.count_nonzero(), 4 * 10);
    }

    #[test]
    fn white_text_on_dark_is_selected() {
        let mut img = RgbImage::from_pixel(60, 40, Rgb([10, 10, 10]));
        for y in 15..25 {
            for x in 20..24 {
                img.put_pixel(x, y, Rgb([250, 250, 250]));
            }
        }
        let quad = vec![[10.0, 10.0], [50.0, 10.0], [50.0, 30.0], [10.0, 30.0]];
        let m = stroke_mask(&img, &[quad], None);
        assert_eq!(m.get(21, 20), 255);
        assert_eq!(m.get(40, 12), 0);
    }

    #[test]
    fn flat_region_uses_fallback_bitmap() {
        let img = RgbImage::from_pixel(60, 40, Rgb([128, 128, 128]));
        let quad = vec![[10.0, 10.0], [50.0, 10.0], [50.0, 30.0], [10.0, 30.0]];
        assert!(stroke_mask(&img, &[quad.clone()], None).is_empty());
        let mut fb = Mask::new(60, 40);
        fb.set(30, 20, 255);
        let m = stroke_mask(&img, &[quad], Some(&fb));
        assert_eq!(m.get(30, 20), 255);
        assert_eq!(m.count_nonzero(), 1);
    }
}
