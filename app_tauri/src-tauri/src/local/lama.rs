//! Inpainting bằng LaMa ONNX, theo từng cửa sổ quanh vùng chữ thay vì cả trang.
//!
//! 1. Tách mask thành các thành phần, nới mỗi thành phần một lề ngữ cảnh rồi gộp các cửa sổ chồng nhau.
//! 2. Mỗi cửa sổ: nếu cạnh dài > `max_dim` thì thu nhỏ (mask dùng max-pooling để nét mảnh không biến mất),
//!    nếu nhỏ thì đệm (replicate) lên bội số của 8. Model có kích thước cố định thì resize đúng cỡ đó.
//! 3. Chạy model, đưa kết quả về kích thước cửa sổ, chỉ ghi đè các pixel nằm trong mask.
//!
//! Quy ước model (giống `lama_onnx.py` cũ): input 0 = ảnh NCHW float [0,1], input 1 = mask N1HW {0,1},
//! output 0 = ảnh NCHW; giá trị nhân `output_scale` rồi kẹp [0,255].

use image::imageops::{crop_imm, resize, FilterType};
use image::{Rgb, RgbImage};

use crate::vision::morph::connected_components_8;
use crate::vision::types::Mask;

use super::runner::{TensorIn, TensorRunner};

#[derive(Debug, Clone)]
pub struct LamaConfig {
    pub max_dim: usize,
    pub min_context: usize,
    pub context_ratio: f32,
    pub output_scale: f32,
}

impl Default for LamaConfig {
    fn default() -> Self {
        Self { max_dim: 512, min_context: 24, context_ratio: 0.5, output_scale: 255.0 }
    }
}

/// Hình chữ nhật [x0, x1) x [y0, y1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
}

impl Rect {
    pub fn w(&self) -> usize {
        self.x1 - self.x0
    }
    pub fn h(&self) -> usize {
        self.y1 - self.y0
    }
    fn overlaps(&self, o: &Rect) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.y0 < o.y1 && o.y0 < self.y1
    }
    fn union(&self, o: &Rect) -> Rect {
        Rect { x0: self.x0.min(o.x0), y0: self.y0.min(o.y0), x1: self.x1.max(o.x1), y1: self.y1.max(o.y1) }
    }
}

pub fn plan_windows(mask: &Mask, cfg: &LamaConfig) -> Vec<Rect> {
    let cc = connected_components_8(&mask.data, mask.width, mask.height);
    let mut rects: Vec<Rect> = cc.stats[1..]
        .iter()
        .map(|s| {
            let (x, y, w, h) = (s.x as usize, s.y as usize, s.w as usize, s.h as usize);
            let ctx = ((cfg.context_ratio * w.max(h) as f32) as usize).max(cfg.min_context);
            Rect {
                x0: x.saturating_sub(ctx),
                y0: y.saturating_sub(ctx),
                x1: (x + w + ctx).min(mask.width),
                y1: (y + h + ctx).min(mask.height),
            }
        })
        .collect();

    loop {
        let mut merged = false;
        'search: for i in 0..rects.len() {
            for j in (i + 1)..rects.len() {
                if rects[i].overlaps(&rects[j]) {
                    rects[i] = rects[i].union(&rects[j]);
                    rects.swap_remove(j);
                    merged = true;
                    break 'search;
                }
            }
        }
        if !merged {
            break;
        }
    }
    rects.sort_by_key(|r| (r.y0, r.x0));
    rects
}

fn round8(v: usize) -> usize {
    (((v as f64 / 8.0).round() as usize).max(1)) * 8
}

fn ceil8(v: usize) -> usize {
    ((v + 7) / 8).max(1) * 8
}

/// (w, h) cố định nếu model khai báo input ảnh có H, W dương.
fn fixed_size(runner: &dyn TensorRunner) -> Option<(usize, usize)> {
    let d = runner.input_dims(0)?;
    if d.len() == 4 && d[2] > 0 && d[3] > 0 {
        Some((d[3] as usize, d[2] as usize))
    } else {
        None
    }
}

fn inpaint_window(
    runner: &dyn TensorRunner,
    img: &RgbImage,
    mask: &Mask,
    out: &mut RgbImage,
    r: Rect,
    fixed: Option<(usize, usize)>,
    cfg: &LamaConfig,
) -> Result<(), String> {
    let (ww, wh) = (r.w(), r.h());
    let big = ww.max(wh);

    let (tw, th, pad_mode) = match fixed {
        Some((fw, fh)) => (fw, fh, false),
        None if big > cfg.max_dim => {
            let s = cfg.max_dim as f64 / big as f64;
            (round8((ww as f64 * s).round() as usize), round8((wh as f64 * s).round() as usize), false)
        }
        None => (ceil8(ww), ceil8(wh), true),
    };
    let plane = tw * th;

    // --- ảnh ---
    let crop = crop_imm(img, r.x0 as u32, r.y0 as u32, ww as u32, wh as u32).to_image();
    let model_img: RgbImage = if pad_mode {
        let mut p = RgbImage::new(tw as u32, th as u32);
        for y in 0..th {
            for x in 0..tw {
                let px = crop.get_pixel(x.min(ww - 1) as u32, y.min(wh - 1) as u32);
                p.put_pixel(x as u32, y as u32, *px);
            }
        }
        p
    } else if (tw, th) == (ww, wh) {
        crop
    } else {
        resize(&crop, tw as u32, th as u32, FilterType::Triangle)
    };

    let mut img_data = vec![0f32; 3 * plane];
    let raw = model_img.as_raw();
    for i in 0..plane {
        for c in 0..3 {
            img_data[c * plane + i] = raw[i * 3 + c] as f32 / 255.0;
        }
    }

    // --- mask ---
    let mut mask_data = vec![0f32; plane];
    for ty in 0..th {
        for tx in 0..tw {
            let hit = if pad_mode {
                tx < ww && ty < wh && mask.get(r.x0 + tx, r.y0 + ty) != 0
            } else {
                let sx0 = tx * ww / tw;
                let sx1 = (((tx + 1) * ww + tw - 1) / tw).max(sx0 + 1).min(ww);
                let sy0 = ty * wh / th;
                let sy1 = (((ty + 1) * wh + th - 1) / th).max(sy0 + 1).min(wh);
                (sy0..sy1).any(|sy| (sx0..sx1).any(|sx| mask.get(r.x0 + sx, r.y0 + sy) != 0))
            };
            if hit {
                mask_data[ty * tw + tx] = 1.0;
            }
        }
    }

    // --- chạy model ---
    let outs = runner.run(&[
        TensorIn { shape: vec![1, 3, th, tw], data: &img_data },
        TensorIn { shape: vec![1, 1, th, tw], data: &mask_data },
    ])?;
    let o = outs.first().ok_or("LaMa không trả về output nào")?;
    if o.data.len() != 3 * plane {
        return Err(format!(
            "output LaMa có {} phần tử, cần {} (3x{}x{}); kiểm tra thứ tự input/output của model",
            o.data.len(),
            3 * plane,
            th,
            tw
        ));
    }

    let mut small = RgbImage::new(tw as u32, th as u32);
    for i in 0..plane {
        let mut px = [0u8; 3];
        for c in 0..3 {
            px[c] = (o.data[c * plane + i] * cfg.output_scale).round().clamp(0.0, 255.0) as u8;
        }
        small.put_pixel((i % tw) as u32, (i / tw) as u32, Rgb(px));
    }

    let result: RgbImage = if pad_mode {
        crop_imm(&small, 0, 0, ww as u32, wh as u32).to_image()
    } else if (tw, th) == (ww, wh) {
        small
    } else {
        resize(&small, ww as u32, wh as u32, FilterType::Lanczos3)
    };

    // --- chỉ ghi đè pixel trong mask ---
    for y in 0..wh {
        for x in 0..ww {
            if mask.get(r.x0 + x, r.y0 + y) != 0 {
                out.put_pixel((r.x0 + x) as u32, (r.y0 + y) as u32, *result.get_pixel(x as u32, y as u32));
            }
        }
    }
    Ok(())
}

pub fn inpaint_page(
    runner: &dyn TensorRunner,
    img: &RgbImage,
    mask: &Mask,
    cfg: &LamaConfig,
) -> Result<RgbImage, String> {
    if mask.width != img.width() as usize || mask.height != img.height() as usize {
        return Err(format!(
            "mask {}x{} không khớp ảnh {}x{}",
            mask.width,
            mask.height,
            img.width(),
            img.height()
        ));
    }
    let mut out = img.clone();
    if mask.is_empty() {
        return Ok(out);
    }
    let fixed = fixed_size(runner);
    for r in plan_windows(mask, cfg) {
        inpaint_window(runner, img, mask, &mut out, r, fixed, cfg)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local::runner::TensorOut;
    use crate::local::test_util::MockRunner;

    fn mask_with(w: usize, h: usize, blobs: &[(usize, usize, usize, usize)]) -> Mask {
        let mut m = Mask::new(w, h);
        for &(x0, y0, x1, y1) in blobs {
            for y in y0..y1 {
                for x in x0..x1 {
                    m.set(x, y, 255);
                }
            }
        }
        m
    }

    /// Runner giả: trả ảnh trắng đúng kích thước input.
    fn white_runner() -> MockRunner {
        MockRunner::new(|inputs| {
            let (th, tw) = (inputs[0].shape[2], inputs[0].shape[3]);
            Ok(vec![TensorOut { shape: vec![1, 3, th, tw], data: vec![1.0; 3 * th * tw] }])
        })
    }

    #[test]
    fn windows_merge_when_overlapping_only() {
        let cfg = LamaConfig::default();
        let m = mask_with(300, 100, &[(20, 40, 30, 50), (250, 40, 260, 50)]);
        assert_eq!(plan_windows(&m, &cfg).len(), 2);
        let m = mask_with(300, 100, &[(20, 40, 30, 50), (60, 40, 70, 50), (250, 40, 260, 50)]);
        let w = plan_windows(&m, &cfg);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0], Rect { x0: 0, y0: 16, x1: 94, y1: 74 });
    }

    #[test]
    fn small_window_is_padded_and_only_masked_pixels_change() {
        let img = RgbImage::from_pixel(100, 80, Rgb([100, 100, 100]));
        let m = mask_with(100, 80, &[(30, 30, 40, 40)]);
        let runner = MockRunner::new(|inputs| {
            assert_eq!(inputs.len(), 2);
            // cửa sổ x 6..64, y 6..64 -> 58x58 -> đệm lên 64x64
            assert_eq!(inputs[0].shape, vec![1, 3, 64, 64]);
            assert_eq!(inputs[1].shape, vec![1, 1, 64, 64]);
            assert!((inputs[0].data[0] - 100.0 / 255.0).abs() < 1e-6);
            assert_eq!(inputs[1].data.iter().sum::<f32>(), 100.0);
            Ok(vec![TensorOut { shape: vec![1, 3, 64, 64], data: vec![1.0; 3 * 64 * 64] }])
        });
        let out = inpaint_page(&runner, &img, &m, &LamaConfig::default()).unwrap();
        assert_eq!(out.get_pixel(35, 35).0, [255, 255, 255]);
        assert_eq!(out.get_pixel(29, 35).0, [100, 100, 100]);
        assert_eq!(out.get_pixel(5, 5).0, [100, 100, 100]);
    }

    #[test]
    fn large_window_is_downscaled_with_max_pooled_mask() {
        let img = RgbImage::from_pixel(1200, 300, Rgb([100, 100, 100]));
        // vệt mảnh 2px nằm giữa: nearest-neighbor có thể bỏ sót, max-pooling thì không.
        let m = mask_with(1200, 300, &[(100, 149, 1100, 151)]);
        let runner = MockRunner::new(|inputs| {
            assert_eq!(inputs[0].shape, vec![1, 3, 128, 512]);
            assert!(inputs[1].data.iter().sum::<f32>() > 0.0);
            Ok(vec![TensorOut { shape: vec![1, 3, 128, 512], data: vec![1.0; 3 * 128 * 512] }])
        });
        let out = inpaint_page(&runner, &img, &m, &LamaConfig::default()).unwrap();
        assert_eq!(out.get_pixel(600, 150).0, [255, 255, 255]);
        assert_eq!(out.get_pixel(600, 100).0, [100, 100, 100]);
    }

    #[test]
    fn fixed_size_model_gets_exact_input_size() {
        let img = RgbImage::from_pixel(200, 200, Rgb([50, 50, 50]));
        let m = mask_with(200, 200, &[(80, 80, 100, 100)]);
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let wrapped = MockRunner::new(move |inputs| {
            seen2.lock().unwrap().push(inputs[0].shape.clone());
            let (th, tw) = (inputs[0].shape[2], inputs[0].shape[3]);
            Ok(vec![TensorOut { shape: vec![1, 3, th, tw], data: vec![1.0; 3 * th * tw] }])
        })
        .with_dims(vec![1, 3, 96, 96]);
        let out = inpaint_page(&wrapped, &img, &m, &LamaConfig::default()).unwrap();
        assert_eq!(seen.lock().unwrap()[0], vec![1, 3, 96, 96]);
        assert_eq!(out.get_pixel(90, 90).0, [255, 255, 255]);
    }

    #[test]
    fn empty_mask_skips_the_model() {
        let img = RgbImage::from_pixel(50, 50, Rgb([7, 7, 7]));
        let runner = MockRunner::new(|_| Err("không được gọi".into()));
        let out = inpaint_page(&runner, &img, &Mask::new(50, 50), &LamaConfig::default()).unwrap();
        assert_eq!(out, img);
    }

    #[test]
    fn wrong_output_size_and_mask_mismatch_are_errors() {
        let img = RgbImage::from_pixel(100, 80, Rgb([100, 100, 100]));
        let m = mask_with(100, 80, &[(30, 30, 40, 40)]);
        let bad = MockRunner::new(|_| Ok(vec![TensorOut { shape: vec![1], data: vec![0.0; 5] }]));
        assert!(inpaint_page(&bad, &img, &m, &LamaConfig::default()).is_err());
        assert!(inpaint_page(&white_runner(), &img, &Mask::new(10, 10), &LamaConfig::default()).is_err());
    }
}
