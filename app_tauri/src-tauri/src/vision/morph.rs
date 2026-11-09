//! Morphology tối thiểu thay OpenCV: dilate (ellipse / rect) và connected components 8-hướng.
//! Mọi hàm làm việc trên buffer u8 một kênh (0 / 255) kích thước `w * h`.

/// cvRound: làm tròn về số chẵn gần nhất khi đúng .5.
fn round_half_even(x: f64) -> f64 {
    let f = x.floor();
    let d = x - f;
    if d < 0.5 {
        f
    } else if d > 0.5 {
        f + 1.0
    } else if f % 2.0 == 0.0 {
        f
    } else {
        f + 1.0
    }
}

/// Giống `cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))`, trả về k*k phần tử 0/1.
pub fn ellipse_kernel(k: usize) -> Vec<u8> {
    let (rows, cols) = (k as i32, k as i32);
    let r = rows / 2;
    let c = cols / 2;
    let inv_r2 = if r != 0 { 1.0 / (r * r) as f64 } else { 0.0 };
    let mut ker = vec![0u8; k * k];
    for i in 0..rows {
        let dy = i - r;
        let (j1, j2) = if dy.abs() <= r {
            let dx = round_half_even(c as f64 * (((r * r - dy * dy) as f64) * inv_r2).sqrt()) as i32;
            ((c - dx).max(0), (c + dx + 1).min(cols))
        } else {
            (0, 0)
        };
        for j in j1..j2 {
            ker[(i * cols + j) as usize] = 1;
        }
    }
    ker
}

/// Dilate bằng kernel bất kỳ k*k (anchor ở giữa). Duyệt theo điểm sáng nên nhanh với mask thưa.
pub fn dilate_kernel(src: &[u8], w: usize, h: usize, k: usize, kernel: &[u8]) -> Vec<u8> {
    debug_assert_eq!(src.len(), w * h);
    debug_assert_eq!(kernel.len(), k * k);
    let mut out = vec![0u8; w * h];
    let anchor = (k / 2) as i64;
    let mut offs: Vec<(i64, i64)> = Vec::new();
    for i in 0..k {
        for j in 0..k {
            if kernel[i * k + j] != 0 {
                offs.push((j as i64 - anchor, i as i64 - anchor));
            }
        }
    }
    for y in 0..h {
        for x in 0..w {
            if src[y * w + x] == 0 {
                continue;
            }
            for &(ox, oy) in &offs {
                let nx = x as i64 - ox;
                let ny = y as i64 - oy;
                if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                    out[ny as usize * w + nx as usize] = 255;
                }
            }
        }
    }
    out
}

/// `cv2.dilate(src, getStructuringElement(MORPH_ELLIPSE, (k, k)))`.
pub fn dilate_ellipse(src: &[u8], w: usize, h: usize, k: usize) -> Vec<u8> {
    if k <= 1 {
        return src.to_vec();
    }
    dilate_kernel(src, w, h, k, &ellipse_kernel(k))
}

/// Dilate bằng kernel chữ nhật k*k (k lẻ), tách 2 pha + prefix sum nên O(w*h) bất kể k.
pub fn dilate_rect(src: &[u8], w: usize, h: usize, k: usize) -> Vec<u8> {
    debug_assert_eq!(src.len(), w * h);
    debug_assert!(k % 2 == 1, "dilate_rect chỉ hỗ trợ k lẻ");
    if k <= 1 || w == 0 || h == 0 {
        return src.to_vec();
    }
    let a = k / 2;
    let mut pre = vec![0u32; w.max(h) + 1];

    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        pre[0] = 0;
        for x in 0..w {
            pre[x + 1] = pre[x] + (src[y * w + x] != 0) as u32;
        }
        for x in 0..w {
            let lo = x.saturating_sub(a);
            let hi = (x + a + 1).min(w);
            if pre[hi] - pre[lo] > 0 {
                tmp[y * w + x] = 255;
            }
        }
    }

    let mut out = vec![0u8; w * h];
    for x in 0..w {
        pre[0] = 0;
        for y in 0..h {
            pre[y + 1] = pre[y] + (tmp[y * w + x] != 0) as u32;
        }
        for y in 0..h {
            let lo = y.saturating_sub(a);
            let hi = (y + a + 1).min(h);
            if pre[hi] - pre[lo] > 0 {
                out[y * w + x] = 255;
            }
        }
    }
    out
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct CcStat {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub area: u32,
}

#[derive(Debug, Clone)]
pub struct Components {
    /// Số nhãn kể cả nền (nhãn 0).
    pub count: usize,
    /// Nhãn của từng pixel, 0 = nền.
    pub labels: Vec<u32>,
    /// `stats[0]` chỉ là chỗ giữ (nền), không tính; `stats[1..]` là các thành phần.
    pub stats: Vec<CcStat>,
}

/// Connected components 8-hướng (flood fill, nhãn đánh số theo thứ tự quét hàng).
/// Số thành phần, tập stats và phân hoạch pixel khớp OpenCV; chỉ khác cách đánh số nhãn.
pub fn connected_components_8(mask: &[u8], w: usize, h: usize) -> Components {
    debug_assert_eq!(mask.len(), w * h);
    let mut labels = vec![0u32; w * h];
    let mut stats = vec![CcStat::default()];
    let mut stack: Vec<usize> = Vec::new();

    for start in 0..w * h {
        if mask[start] == 0 || labels[start] != 0 {
            continue;
        }
        let lab = stats.len() as u32;
        labels[start] = lab;
        stack.push(start);

        let (sx, sy) = ((start % w) as i32, (start / w) as i32);
        let (mut x0, mut y0, mut x1, mut y1) = (sx, sy, sx, sy);
        let mut area = 0u32;

        while let Some(p) = stack.pop() {
            let (px, py) = ((p % w) as i32, (p / w) as i32);
            area += 1;
            x0 = x0.min(px);
            y0 = y0.min(py);
            x1 = x1.max(px);
            y1 = y1.max(py);
            for dy in -1..=1i32 {
                for dx in -1..=1i32 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let (nx, ny) = (px + dx, py + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let q = ny as usize * w + nx as usize;
                    if mask[q] != 0 && labels[q] == 0 {
                        labels[q] = lab;
                        stack.push(q);
                    }
                }
            }
        }
        stats.push(CcStat { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
    }

    Components { count: stats.len(), labels, stats }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use serde_json::Value;
    use std::collections::HashMap;

    const GOLDEN: &str = include_str!("../../tests/golden/morph_cases.json");

    fn decode(v: &Value) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.decode(v.as_str().unwrap()).unwrap()
    }

    fn golden() -> Value {
        serde_json::from_str(GOLDEN).expect("golden json")
    }

    #[test]
    fn ellipse_kernels_match_opencv() {
        let g = golden();
        for (k, want) in g["ellipse_kernels"].as_object().unwrap() {
            let want: Vec<u8> = want.as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8).collect();
            assert_eq!(ellipse_kernel(k.parse().unwrap()), want, "kernel {}", k);
        }
    }

    #[test]
    fn dilate_matches_opencv() {
        let g = golden();
        for (i, c) in g["dilate"].as_array().unwrap().iter().enumerate() {
            let (w, h) = (c["w"].as_u64().unwrap() as usize, c["h"].as_u64().unwrap() as usize);
            let src = decode(&c["mask"]);
            for (key, want) in c["results"].as_object().unwrap() {
                let want = decode(want);
                let got = if let Some(k) = key.strip_prefix("ellipse") {
                    dilate_ellipse(&src, w, h, k.parse().unwrap())
                } else {
                    dilate_rect(&src, w, h, key.strip_prefix("rect").unwrap().parse().unwrap())
                };
                assert_eq!(got, want, "case {} op {}", i, key);
            }
        }
    }

    #[test]
    fn connected_components_match_opencv_up_to_label_order() {
        let g = golden();
        for (i, c) in g["cc"].as_array().unwrap().iter().enumerate() {
            let (w, h) = (c["w"].as_u64().unwrap() as usize, c["h"].as_u64().unwrap() as usize);
            let mask = decode(&c["mask"]);
            let got = connected_components_8(&mask, w, h);
            assert_eq!(got.count as u64, c["num_labels"].as_u64().unwrap(), "case {}", i);

            // Phân hoạch pixel phải trùng: ánh xạ nhãn ta -> nhãn OpenCV là song ánh.
            let want_labels: Vec<u32> = decode(&c["labels"])
                .chunks_exact(4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            let mut fwd: HashMap<u32, u32> = HashMap::new();
            let mut bwd: HashMap<u32, u32> = HashMap::new();
            for (a, b) in got.labels.iter().zip(want_labels.iter()) {
                assert_eq!(*fwd.entry(*a).or_insert(*b), *b, "case {}", i);
                assert_eq!(*bwd.entry(*b).or_insert(*a), *a, "case {}", i);
            }

            // Tập stats (bỏ nền) phải trùng.
            let mut got_stats: Vec<CcStat> = got.stats[1..].to_vec();
            let mut want_stats: Vec<CcStat> = c["stats"].as_array().unwrap()[1..]
                .iter()
                .map(|s| {
                    let s = s.as_array().unwrap();
                    CcStat {
                        x: s[0].as_i64().unwrap() as i32,
                        y: s[1].as_i64().unwrap() as i32,
                        w: s[2].as_i64().unwrap() as i32,
                        h: s[3].as_i64().unwrap() as i32,
                        area: s[4].as_u64().unwrap() as u32,
                    }
                })
                .collect();
            got_stats.sort();
            want_stats.sort();
            assert_eq!(got_stats, want_stats, "case {}", i);
        }
    }
}
