//! Phân loại vùng chữ: bóng thoại (`Bubble`) hay SFX/chữ vẽ trên tranh (`Sfx`).
//!
//! Port 1-1 của `classify_text_region` trong hf_spaces_manga_cleaner/app.py, giữ nguyên ngưỡng
//! và dùng đúng công thức số nguyên của OpenCV (RGB->Gray, kênh S của HSV 8-bit) để kết quả
//! trùng khít với bản Python (kiểm chứng bằng golden test).

use image::RgbImage;

use super::types::BoxType;

/// Kênh S (0..=255) của HSV 8-bit theo cách OpenCV tính.
#[inline]
fn hsv_saturation(r: u32, g: u32, b: u32, sdiv: &[u32; 256]) -> u32 {
    let v = r.max(g).max(b);
    if v == 0 {
        return 0;
    }
    let diff = v - r.min(g).min(b);
    (diff * sdiv[v as usize] + (1 << 11)) >> 12
}

/// Gray 8-bit theo OpenCV: (R*4899 + G*9617 + B*1868 + 8192) >> 14.
#[inline]
pub(crate) fn gray8(r: u32, g: u32, b: u32) -> u8 {
    ((r * 4899 + g * 9617 + b * 1868 + 8192) >> 14) as u8
}

fn kth_value(hist: &[u32; 256], k: usize) -> u8 {
    let mut cum = 0usize;
    for (v, &c) in hist.iter().enumerate() {
        cum += c as usize;
        if k < cum {
            return v as u8;
        }
    }
    255
}

/// Giống `np.percentile(..., p)` (nội suy tuyến tính) trên dữ liệu u8 cho trước dưới dạng histogram.
fn percentile_u8(hist: &[u32; 256], n: usize, p: f64) -> f64 {
    let pos = (p / 100.0) * ((n - 1) as f64);
    let lo = pos.floor() as usize;
    let t = pos - lo as f64;
    let hi = (lo + 1).min(n - 1);
    let a = kth_value(hist, lo) as f64;
    let b = kth_value(hist, hi) as f64;
    let diff = b - a;
    if t >= 0.5 {
        b - diff * (1.0 - t)
    } else {
        a + diff * t
    }
}

/// `xywh` là hộp của vùng chữ trên ảnh `img`; hộp được kẹp vào trong ảnh (như bản Python).
pub fn classify_text_region(xywh: [i32; 4], img: &RgbImage) -> BoxType {
    let (iw, ih) = (img.width() as i32, img.height() as i32);
    if iw == 0 || ih == 0 {
        return BoxType::Bubble;
    }

    let x = xywh[0].min(iw - 1).max(0);
    let y = xywh[1].min(ih - 1).max(0);
    let w = xywh[2].min(iw - x).max(1) as usize;
    let h = xywh[3].min(ih - y).max(1) as usize;

    let mut sdiv = [0u32; 256];
    for (v, slot) in sdiv.iter_mut().enumerate().skip(1) {
        *slot = (((255u64 << 12) as f64) / v as f64).round() as u32;
    }

    let raw = img.as_raw();
    let stride = iw as usize * 3;

    let n = w * h;
    let mut sat_hist = [0u32; 256];
    let mut sat_sum: u64 = 0;
    let mut var_sum = 0.0f64;
    let mut gray = vec![0u8; n];
    let (mut white_cnt, mut black_cnt) = (0usize, 0usize);

    for cy in 0..h {
        let row = (y as usize + cy) * stride + x as usize * 3;
        for cx in 0..w {
            let o = row + cx * 3;
            let (r, g, b) = (raw[o] as u32, raw[o + 1] as u32, raw[o + 2] as u32);

            let s = hsv_saturation(r, g, b, &sdiv);
            sat_hist[s as usize] += 1;
            sat_sum += s as u64;

            let m = (r + g + b) as f64 / 3.0;
            let (dr, dg, db) = (r as f64 - m, g as f64 - m, b as f64 - m);
            var_sum += (dr * dr + dg * dg + db * db) / 3.0;

            let gv = gray8(r, g, b);
            gray[cy * w + cx] = gv;
            if gv > 215 {
                white_cnt += 1;
            }
            if gv < 40 {
                black_cnt += 1;
            }
        }
    }

    let nf = n as f64;
    let sat_mean = sat_sum as f64 / nf;
    let sat_p85 = percentile_u8(&sat_hist, n, 85.0);
    let color_var = var_sum / nf;

    // 1. Có màu (bão hòa cao / lệch kênh RGB lớn) => chữ nghệ thuật / SFX.
    if sat_p85 > 45.0 || sat_mean > 18.0 || color_var > 45.0 {
        return BoxType::Sfx;
    }

    // Viền: hàng đầu, hàng cuối, cột đầu, cột cuối (góc đếm 2 lần, giống np.concatenate).
    let border_total = 2 * w + 2 * h;
    let (mut border_white, mut border_black) = (0usize, 0usize);
    let mut count_border = |v: u8| {
        if v > 210 {
            border_white += 1;
        }
        if v < 40 {
            border_black += 1;
        }
    };
    for cx in 0..w {
        count_border(gray[cx]);
        count_border(gray[(h - 1) * w + cx]);
    }
    for cy in 0..h {
        count_border(gray[cy * w]);
        count_border(gray[cy * w + w - 1]);
    }

    let border_white_pct = (border_white as f64 / border_total as f64) * 100.0;
    let pct_white = (white_cnt as f64 / nf) * 100.0;
    if border_white_pct >= 50.0 && pct_white >= 35.0 {
        return BoxType::Bubble;
    }

    let border_black_pct = (border_black as f64 / border_total as f64) * 100.0;
    let pct_black = (black_cnt as f64 / nf) * 100.0;
    if border_black_pct > 65.0 && pct_black > 40.0 {
        return BoxType::Bubble;
    }

    BoxType::Sfx
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/golden/classify_cases.json");

    #[test]
    fn matches_python_reference() {
        let cases: Vec<Value> = serde_json::from_str(GOLDEN).expect("golden json");
        assert!(cases.len() >= 50);
        for (i, c) in cases.iter().enumerate() {
            let w = c["w"].as_u64().unwrap() as u32;
            let h = c["h"].as_u64().unwrap() as u32;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(c["rgb"].as_str().unwrap())
                .unwrap();
            let img = RgbImage::from_raw(w, h, bytes).unwrap();
            let b = c["xywh"].as_array().unwrap();
            let xywh = [
                b[0].as_i64().unwrap() as i32,
                b[1].as_i64().unwrap() as i32,
                b[2].as_i64().unwrap() as i32,
                b[3].as_i64().unwrap() as i32,
            ];
            let want = c["expected"].as_str().unwrap();
            assert_eq!(classify_text_region(xywh, &img).as_str(), want, "case {}", i);
        }
    }

    #[test]
    fn white_bubble_black_bubble_and_color() {
        let white = RgbImage::from_pixel(20, 20, image::Rgb([255, 255, 255]));
        assert_eq!(classify_text_region([0, 0, 20, 20], &white), BoxType::Bubble);
        let black = RgbImage::from_pixel(20, 20, image::Rgb([5, 5, 5]));
        assert_eq!(classify_text_region([0, 0, 20, 20], &black), BoxType::Bubble);
        let red = RgbImage::from_pixel(20, 20, image::Rgb([220, 30, 30]));
        assert_eq!(classify_text_region([0, 0, 20, 20], &red), BoxType::Sfx);
    }
}
