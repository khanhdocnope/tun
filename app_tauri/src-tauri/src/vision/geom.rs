//! Hình học 2D tối thiểu: convex hull, minAreaRect, đa giác lồi -> dải pixel theo hàng.
//! Thay cho `cv2.convexHull` / `cv2.minAreaRect` / `cv2.fillPoly` mà bước hậu xử lý DB cần.

pub type P = [f64; 2];

/// Hình chữ nhật xoay: tâm, hai cạnh (w dọc theo `corners[0]->corners[1]`) và 4 góc.
#[derive(Debug, Clone, Copy)]
pub struct RotRect {
    pub center: P,
    pub w: f64,
    pub h: f64,
    pub corners: [P; 4],
}

fn cross(o: (i64, i64), a: (i64, i64), b: (i64, i64)) -> i64 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

/// Convex hull (Andrew monotone chain) của các điểm nguyên; bỏ điểm trùng và điểm thẳng hàng.
pub fn convex_hull(points: &[(i32, i32)]) -> Vec<P> {
    let mut pts: Vec<(i64, i64)> = points.iter().map(|&(x, y)| (x as i64, y as i64)).collect();
    pts.sort();
    pts.dedup();
    let to_p = |v: Vec<(i64, i64)>| v.into_iter().map(|(x, y)| [x as f64, y as f64]).collect::<Vec<P>>();
    if pts.len() <= 2 {
        return to_p(pts);
    }

    let mut lower: Vec<(i64, i64)> = Vec::new();
    for &p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<(i64, i64)> = Vec::new();
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    to_p(lower)
}

pub fn polygon_area(poly: &[P]) -> f64 {
    let n = poly.len();
    let mut s = 0.0;
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        s += a[0] * b[1] - b[0] * a[1];
    }
    s.abs() / 2.0
}

pub fn polygon_perimeter(poly: &[P]) -> f64 {
    let n = poly.len();
    (0..n)
        .map(|i| {
            let (a, b) = (poly[i], poly[(i + 1) % n]);
            (b[0] - a[0]).hypot(b[1] - a[1])
        })
        .sum()
}

/// Hình chữ nhật xoay có diện tích nhỏ nhất bao hull (thử lần lượt hướng của từng cạnh hull).
pub fn min_area_rect(hull: &[P]) -> Option<RotRect> {
    let n = hull.len();
    if n == 0 {
        return None;
    }
    if n == 1 {
        return Some(RotRect { center: hull[0], w: 0.0, h: 0.0, corners: [hull[0]; 4] });
    }

    // (area, ux, uy, nx, ny, umin, umax, nmin, nmax)
    let mut best: Option<(f64, f64, f64, f64, f64, f64, f64, f64, f64)> = None;
    for i in 0..n {
        let (a, b) = (hull[i], hull[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len = dx.hypot(dy);
        if len == 0.0 {
            continue;
        }
        let (ux, uy) = (dx / len, dy / len);
        let (nx, ny) = (-uy, ux);
        let (mut umin, mut umax, mut nmin, mut nmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in hull {
            let u = p[0] * ux + p[1] * uy;
            let v = p[0] * nx + p[1] * ny;
            umin = umin.min(u);
            umax = umax.max(u);
            nmin = nmin.min(v);
            nmax = nmax.max(v);
        }
        let area = (umax - umin) * (nmax - nmin);
        if best.map_or(true, |b| area < b.0 - 1e-9) {
            best = Some((area, ux, uy, nx, ny, umin, umax, nmin, nmax));
        }
    }

    let (_, ux, uy, nx, ny, umin, umax, nmin, nmax) = best?;
    let pt = |u: f64, v: f64| -> P { [u * ux + v * nx, u * uy + v * ny] };
    Some(RotRect {
        center: pt((umin + umax) / 2.0, (nmin + nmax) / 2.0),
        w: umax - umin,
        h: nmax - nmin,
        corners: [pt(umin, nmin), pt(umax, nmin), pt(umax, nmax), pt(umin, nmax)],
    })
}

impl RotRect {
    /// Nới đều mọi cạnh thêm `d` (đúng bằng min-area-rect của đa giác sau unclip bo tròn).
    pub fn expanded(&self, d: f64) -> RotRect {
        let c = self.corners;
        let (ux, uy) = if self.w > 0.0 {
            ((c[1][0] - c[0][0]) / self.w, (c[1][1] - c[0][1]) / self.w)
        } else {
            (1.0, 0.0)
        };
        let (nx, ny) = (-uy, ux);
        let (hw, hh) = (self.w / 2.0 + d, self.h / 2.0 + d);
        let pt = |a: f64, b: f64| -> P { [self.center[0] + a * ux + b * nx, self.center[1] + a * uy + b * ny] };
        RotRect {
            center: self.center,
            w: self.w + 2.0 * d,
            h: self.h + 2.0 * d,
            corners: [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)],
        }
    }
}

/// Sắp 4 góc theo thứ tự trên-trái, trên-phải, dưới-phải, dưới-trái (như `get_mini_boxes` của PaddleOCR).
pub fn order_quad(corners: [P; 4]) -> [P; 4] {
    let mut p = corners;
    p.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    let (i1, i4) = if p[1][1] > p[0][1] { (0, 1) } else { (1, 0) };
    let (i2, i3) = if p[3][1] > p[2][1] { (2, 3) } else { (3, 2) };
    [p[i1], p[i2], p[i3], p[i4]]
}

/// Với đa giác LỒI: dải pixel [x0, x1] của từng hàng y nó phủ (kẹp trong ảnh), dạng `(y, x0, x1)`.
/// Dựa trên việc lấy mẫu dọc các cạnh nên cả đa giác rất mỏng cũng có pixel.
pub fn convex_row_ranges(poly: &[P], width: usize, height: usize) -> Vec<(usize, usize, usize)> {
    let n = poly.len();
    if n == 0 || width == 0 || height == 0 {
        return Vec::new();
    }
    let mut rows: Vec<Option<(i64, i64)>> = vec![None; height];
    let mut mark = |x: i64, y: i64| {
        if y >= 0 && (y as usize) < height {
            let xc = x.clamp(0, width as i64 - 1);
            let e = &mut rows[y as usize];
            *e = Some(match *e {
                Some((a, b)) => (a.min(xc), b.max(xc)),
                None => (xc, xc),
            });
        }
    };
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        let steps = (b[0] - a[0]).abs().max((b[1] - a[1]).abs()).max(1.0).ceil() as i64;
        for s in 0..=steps {
            let t = s as f64 / steps as f64;
            let x = (a[0] + (b[0] - a[0]) * t).round() as i64;
            let y = (a[1] + (b[1] - a[1]) * t).round() as i64;
            mark(x, y);
        }
    }
    rows.iter()
        .enumerate()
        .filter_map(|(y, r)| r.map(|(a, b)| (y, a as usize, b as usize)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const GOLDEN: &str = include_str!("../../tests/golden/geom_cases.json");

    #[test]
    fn hull_and_min_area_rect_match_opencv() {
        let g: Value = serde_json::from_str(GOLDEN).unwrap();
        let cases = g["rect"].as_array().unwrap();
        assert!(cases.len() >= 30);
        for (i, c) in cases.iter().enumerate() {
            let pts: Vec<(i32, i32)> = c["pts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| (p[0].as_i64().unwrap() as i32, p[1].as_i64().unwrap() as i32))
                .collect();
            let hull = convex_hull(&pts);
            let want_hull = c["hull_area"].as_f64().unwrap();
            assert!((polygon_area(&hull) - want_hull).abs() < 1e-6, "hull case {}", i);

            let r = min_area_rect(&hull).unwrap();
            let want = c["rect_area"].as_f64().unwrap();
            let got = r.w * r.h;
            // OpenCV tính bằng float32 nên có thể lớn hơn cực nhẹ; ta không được lớn hơn đáng kể.
            assert!(got <= want * (1.0 + 1e-3) + 1e-6, "rect case {}: {} vs {}", i, got, want);
            assert!(got >= polygon_area(&hull) - 1e-6, "rect case {} nhỏ hơn hull", i);
        }
    }

    #[test]
    fn rect_of_axis_aligned_box() {
        let pts = [(0, 0), (10, 0), (10, 4), (0, 4)];
        let r = min_area_rect(&convex_hull(&pts)).unwrap();
        assert!((r.w * r.h - 40.0).abs() < 1e-9);
        assert!((r.center[0] - 5.0).abs() < 1e-9 && (r.center[1] - 2.0).abs() < 1e-9);
        let e = r.expanded(2.0);
        assert!((e.w.max(e.h) - 14.0).abs() < 1e-9 && (e.w.min(e.h) - 8.0).abs() < 1e-9);
    }

    #[test]
    fn order_quad_is_tl_tr_br_bl() {
        let q = order_quad([[10.0, 8.0], [0.0, 0.0], [10.0, 0.0], [0.0, 8.0]]);
        assert_eq!(q, [[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [0.0, 8.0]]);
    }

    #[test]
    fn row_ranges_cover_rectangle() {
        let poly = [[2.0, 3.0], [10.0, 3.0], [10.0, 8.0], [2.0, 8.0]];
        let r = convex_row_ranges(&poly, 20, 20);
        assert_eq!(r.len(), 6);
        assert!(r.iter().all(|&(_, a, b)| a == 2 && b == 10));
        assert_eq!(r.first().unwrap().0, 3);
        assert_eq!(r.last().unwrap().0, 8);
    }

    #[test]
    fn row_ranges_clip_to_image() {
        let poly = [[-5.0, -5.0], [30.0, -5.0], [30.0, 30.0], [-5.0, 30.0]];
        let r = convex_row_ranges(&poly, 10, 10);
        assert_eq!(r.len(), 10);
        assert!(r.iter().all(|&(_, a, b)| a == 0 && b == 9));
    }
}
