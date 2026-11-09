//! Mask refinement kiểu "fit_text".
//!
//! Đầu vào: mask thô của detector (0/255) + polygon từng dòng chữ.
//! Đầu ra: mask sạch hơn để đưa vào inpainter.
//!
//! Các bước (đây là cách tôi tái hiện thuật toán `complete_mask` của manga-image-translator
//! từ mô tả công khai, KHÔNG phải port từng dòng vì mã nguồn đó không có trong repo này):
//!   1. Vẽ viền hộp bao mỗi dòng bằng 0 để cắt các nét dính hai dòng liền kề.
//!   2. Tách connected components (8-hướng); bỏ cc nhỏ (area <= 9).
//!   3. Gán mỗi cc cho dòng chứa nhiều pixel của nó nhất (bỏ nếu < `keep_threshold` diện tích cc).
//!      Bản gốc dùng giao đa giác (Shapely); ở đây bỏ phiếu theo pixel, kết quả tương đương
//!      với chữ bình thường nhưng có thể lệch ở các ca biên.
//!   4. Với mỗi dòng: dilate hình chữ nhật cỡ `max((int((min(w,h) + offset) * 0.3) // 2) * 2 + 1, 3)`
//!      trên cửa sổ đã nới thêm đúng nửa kernel (không bị cắt cụt ở mép hộp).
//!   5. Hợp mọi dòng rồi dilate ellipse `kernel_size` (mặc định 3).
//!
//! Cần đối chiếu độ khớp với bản Python trên ảnh thật (xem `tools/gen_golden.py` và ghi chú
//! trong CHANGELOG) trước khi coi hai bên là tương đương.

use std::cmp::Reverse;

use super::morph::{connected_components_8, dilate_ellipse, dilate_rect};
use super::types::{Mask, Poly};

#[derive(Debug, Clone)]
pub struct RefineOptions {
    /// `dilation_offset` của API (mặc định +2).
    pub dilation_offset: i32,
    /// Kích thước dilate ellipse cuối cùng.
    pub kernel_size: usize,
    /// Tỉ lệ pixel của cc nằm trong dòng tối thiểu để giữ cc.
    pub keep_threshold: f32,
    /// cc có area <= giá trị này bị bỏ.
    pub min_cc_area: u32,
}

impl Default for RefineOptions {
    fn default() -> Self {
        Self { dilation_offset: 2, kernel_size: 3, keep_threshold: 1e-2, min_cc_area: 9 }
    }
}

const NO_LINE: u32 = u32::MAX;

/// Hộp bao nguyên (x, y, w, h) của polygon: floor(min), ceil(max).
fn aabb(poly: &Poly) -> Option<(i32, i32, i32, i32)> {
    if poly.is_empty() {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in poly {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    let (x0, y0) = (x0.floor() as i32, y0.floor() as i32);
    let (x1, y1) = (x1.ceil() as i32, y1.ceil() as i32);
    Some((x0, y0, x1 - x0, y1 - y0))
}

/// `cv2.rectangle(mask, (x, y), (x + w, y + h), 0, 1)`: viền 1px, kẹp trong ảnh.
fn clear_rect_outline(data: &mut [u8], width: usize, height: usize, x: i32, y: i32, w: i32, h: i32) {
    let (x2, y2) = (x + w, y + h);
    let mut clear = |px: i32, py: i32| {
        if px >= 0 && py >= 0 && (px as usize) < width && (py as usize) < height {
            data[py as usize * width + px as usize] = 0;
        }
    };
    for px in x..=x2 {
        clear(px, y);
        clear(px, y2);
    }
    for py in y..=y2 {
        clear(x, py);
        clear(x2, py);
    }
}

/// Tô polygon (even-odd) + vẽ cạnh vào `ids`, giá trị `id`.
fn fill_polygon(ids: &mut [u32], width: usize, height: usize, poly: &Poly, id: u32) {
    let n = poly.len();
    if n == 0 {
        return;
    }
    let (w, h) = (width as i64, height as i64);

    if n >= 3 {
        let min_y = poly.iter().map(|p| p[1]).fold(f32::MAX, f32::min);
        let max_y = poly.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        let y_start = (min_y.floor() as i64).max(0);
        let y_end = (max_y.ceil() as i64).min(h - 1);
        let mut xs: Vec<f64> = Vec::new();
        let mut y = y_start;
        while y <= y_end {
            let yf = y as f64;
            xs.clear();
            for i in 0..n {
                let (x0, y0) = (poly[i][0] as f64, poly[i][1] as f64);
                let (x1, y1) = (poly[(i + 1) % n][0] as f64, poly[(i + 1) % n][1] as f64);
                if (y0 <= yf && yf < y1) || (y1 <= yf && yf < y0) {
                    let t = (yf - y0) / (y1 - y0);
                    xs.push(x0 + t * (x1 - x0));
                }
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            for pair in xs.chunks_exact(2) {
                let xa = (pair[0].ceil() as i64).max(0);
                let xb = (pair[1].floor() as i64).min(w - 1);
                let mut x = xa;
                while x <= xb {
                    ids[y as usize * width + x as usize] = id;
                    x += 1;
                }
            }
            y += 1;
        }
    }

    // Cạnh (đảm bảo dòng rất mỏng vẫn có pixel).
    for i in 0..n {
        let (x0, y0) = (poly[i][0] as f64, poly[i][1] as f64);
        let (x1, y1) = (poly[(i + 1) % n][0] as f64, poly[(i + 1) % n][1] as f64);
        let steps = (x1 - x0).abs().max((y1 - y0).abs()).max(1.0) as i64;
        for s in 0..=steps {
            let t = s as f64 / steps as f64;
            let x = (x0 + (x1 - x0) * t).round() as i64;
            let y = (y0 + (y1 - y0) * t).round() as i64;
            if x >= 0 && y >= 0 && x < w && y < h {
                ids[y as usize * width + x as usize] = id;
            }
        }
    }
}

struct LineAcc {
    x0: i32,
    y0: i32,
    x1: i32, // loại trừ
    y1: i32, // loại trừ
}

pub fn refine_text_mask(raw: &Mask, lines: &[Poly], opts: &RefineOptions) -> Mask {
    let (w, h) = (raw.width, raw.height);
    let mut out = Mask::new(w, h);
    if w == 0 || h == 0 || lines.is_empty() || raw.is_empty() {
        return out;
    }

    // 1. Nhị phân hóa + cắt viền hộp từng dòng.
    let mut m: Vec<u8> = raw.data.iter().map(|&v| if v > 0 { 255 } else { 0 }).collect();
    for poly in lines {
        if let Some((x, y, bw, bh)) = aabb(poly) {
            clear_rect_outline(&mut m, w, h, x, y, bw, bh);
        }
    }

    // 2. Connected components.
    let cc = connected_components_8(&m, w, h);

    // 3. Gán cc -> dòng bằng bỏ phiếu theo pixel.
    let mut ids = vec![NO_LINE; w * h];
    for (i, poly) in lines.iter().enumerate() {
        fill_polygon(&mut ids, w, h, poly, i as u32);
    }

    let mut votes: Vec<Vec<(u32, u32)>> = vec![Vec::new(); cc.count];
    for p in 0..w * h {
        let lab = cc.labels[p] as usize;
        let line = ids[p];
        if lab == 0 || line == NO_LINE {
            continue;
        }
        let v = &mut votes[lab];
        match v.iter_mut().find(|e| e.0 == line) {
            Some(e) => e.1 += 1,
            None => v.push((line, 1)),
        }
    }

    let mut owner: Vec<Option<usize>> = vec![None; cc.count];
    let mut acc: Vec<Option<LineAcc>> = (0..lines.len()).map(|_| None).collect();
    for lab in 1..cc.count {
        let st = cc.stats[lab];
        if st.area <= opts.min_cc_area {
            continue;
        }
        // Nhiều phiếu nhất; hòa thì lấy dòng có chỉ số nhỏ hơn (giống np.argmax).
        let best = votes[lab].iter().max_by_key(|&&(line, cnt)| (cnt, Reverse(line)));
        let Some(&(line, cnt)) = best else { continue };
        if (cnt as f32) / (st.area as f32) < opts.keep_threshold {
            continue;
        }
        let li = line as usize;
        owner[lab] = Some(li);
        let (ex1, ey1) = (st.x + st.w, st.y + st.h);
        if let Some(a) = acc[li].as_mut() {
            a.x0 = a.x0.min(st.x);
            a.y0 = a.y0.min(st.y);
            a.x1 = a.x1.max(ex1);
            a.y1 = a.y1.max(ey1);
        } else {
            acc[li] = Some(LineAcc { x0: st.x, y0: st.y, x1: ex1, y1: ey1 });
        }
    }

    // 4. Dilate chữ nhật theo từng dòng.
    let mut fin = vec![0u8; w * h];
    for (li, slot) in acc.iter().enumerate() {
        let Some(a) = slot else { continue };
        let text_size = (a.x1 - a.x0).min(a.y1 - a.y0);
        let v = ((text_size + opts.dilation_offset) as f64 * 0.3).trunc() as i32;
        let dilate_size = (v.div_euclid(2) * 2 + 1).max(3) as usize;
        let pad = (dilate_size / 2) as i32;

        let wx0 = (a.x0 - pad).max(0) as usize;
        let wy0 = (a.y0 - pad).max(0) as usize;
        let wx1 = ((a.x1 + pad).min(w as i32)) as usize;
        let wy1 = ((a.y1 + pad).min(h as i32)) as usize;
        let (lw, lh) = (wx1 - wx0, wy1 - wy0);

        let mut local = vec![0u8; lw * lh];
        for y in (a.y0 as usize)..(a.y1 as usize) {
            for x in (a.x0 as usize)..(a.x1 as usize) {
                let lab = cc.labels[y * w + x] as usize;
                if lab != 0 && owner[lab] == Some(li) {
                    local[(y - wy0) * lw + (x - wx0)] = 255;
                }
            }
        }

        let dilated = dilate_rect(&local, lw, lh, dilate_size);
        for y in 0..lh {
            for x in 0..lw {
                if dilated[y * lw + x] != 0 {
                    fin[(y + wy0) * w + (x + wx0)] = 255;
                }
            }
        }
    }

    // 5. Dilate ellipse cuối.
    out.data = if opts.kernel_size > 1 { dilate_ellipse(&fin, w, h, opts.kernel_size) } else { fin };
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect_poly(x0: f32, y0: f32, x1: f32, y1: f32) -> Poly {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    fn fill(m: &mut Mask, x0: usize, y0: usize, x1: usize, y1: usize) {
        for y in y0..y1 {
            for x in x0..x1 {
                m.set(x, y, 255);
            }
        }
    }

    /// Hai dòng chữ + thanh dọc 3px nối xuyên cả hai + cc ngoài mọi dòng.
    fn scene() -> (Mask, Vec<Poly>) {
        let mut raw = Mask::new(100, 60);
        for x in [12usize, 18, 30, 36] {
            fill(&mut raw, x, 12, x + 3, 18);
            fill(&mut raw, x, 32, x + 3, 38);
        }
        fill(&mut raw, 24, 10, 27, 40);
        fill(&mut raw, 60, 50, 64, 56);
        let lines = vec![rect_poly(10.0, 10.0, 40.0, 20.0), rect_poly(10.0, 30.0, 40.0, 40.0)];
        (raw, lines)
    }

    #[test]
    fn keeps_strokes_cuts_bridge_and_drops_outside() {
        let (raw, lines) = scene();
        let out = refine_text_mask(&raw, &lines, &RefineOptions { dilation_offset: 0, ..Default::default() });

        assert_eq!(out.get(13, 15), 255, "nét dòng 1");
        assert_eq!(out.get(13, 35), 255, "nét dòng 2");
        assert_eq!(out.get(25, 15), 255, "đoạn thanh thuộc dòng 1");
        assert_eq!(out.get(25, 35), 255, "đoạn thanh thuộc dòng 2");
        assert_eq!(out.get(25, 25), 0, "đoạn thanh giữa hai dòng phải bị bỏ");
        assert_eq!(out.get(62, 52), 0, "cc ngoài mọi dòng phải bị bỏ");
        for y in 22..29 {
            assert!((0..100).all(|x| out.get(x, y) == 0), "hàng {} phải trống", y);
        }
    }

    #[test]
    fn larger_offset_grows_mask_and_small_offset_is_clamped() {
        let (raw, lines) = scene();
        let count = |off| refine_text_mask(&raw, &lines, &RefineOptions { dilation_offset: off, ..Default::default() }).count_nonzero();
        assert!(count(10) > count(0));
        assert_eq!(count(-6), count(0), "kernel tối thiểu là 3");
    }

    #[test]
    fn empty_inputs_give_empty_mask() {
        let (raw, lines) = scene();
        assert!(refine_text_mask(&raw, &[], &RefineOptions::default()).is_empty());
        assert!(refine_text_mask(&Mask::new(100, 60), &lines, &RefineOptions::default()).is_empty());
    }

    #[test]
    fn line_at_image_corner_does_not_panic() {
        let mut raw = Mask::new(20, 20);
        fill(&mut raw, 0, 0, 4, 6);
        let out = refine_text_mask(&raw, &[rect_poly(0.0, 0.0, 8.0, 6.0)], &RefineOptions::default());
        assert_eq!(out.get(2, 3), 255);
    }
}
