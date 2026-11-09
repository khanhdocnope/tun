//! Gộp các dòng chữ (quad từ detector) thành vùng chữ (bóng thoại / cụm SFX).
//!
//! Hai dòng được gộp khi hộp bao của chúng đủ gần (khoảng cách nhỏ hơn `GAP_RATIO` lần cạnh
//! ngắn hơn) và kích thước chữ tương đương (tỉ lệ cạnh ngắn trong [1/SIZE_RATIO, SIZE_RATIO]).
//! Gộp sai chỉ làm vùng phân loại bubble/sfx rộng hơn, không đổi mask nên rủi ro thấp.

use crate::vision::types::{Poly, TextRegion};

const GAP_RATIO: f32 = 0.75;
const SIZE_RATIO: f32 = 2.0;

#[derive(Clone, Copy)]
struct Box2 {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

impl Box2 {
    fn of(poly: &Poly) -> Option<Box2> {
        if poly.is_empty() {
            return None;
        }
        let mut b = Box2 { x0: f32::MAX, y0: f32::MAX, x1: f32::MIN, y1: f32::MIN };
        for p in poly {
            b.x0 = b.x0.min(p[0]);
            b.y0 = b.y0.min(p[1]);
            b.x1 = b.x1.max(p[0]);
            b.y1 = b.y1.max(p[1]);
        }
        Some(b)
    }

    fn short_side(&self) -> f32 {
        (self.x1 - self.x0).min(self.y1 - self.y0).max(1.0)
    }
}

fn find(parent: &mut Vec<usize>, i: usize) -> usize {
    let mut r = i;
    while parent[r] != r {
        r = parent[r];
    }
    let mut c = i;
    while parent[c] != r {
        let next = parent[c];
        parent[c] = r;
        c = next;
    }
    r
}

pub fn group_lines(lines: &[Poly]) -> Vec<TextRegion> {
    let boxes: Vec<Option<Box2>> = lines.iter().map(Box2::of).collect();
    let n = lines.len();
    let mut parent: Vec<usize> = (0..n).collect();

    for i in 0..n {
        let Some(a) = boxes[i] else { continue };
        for j in (i + 1)..n {
            let Some(b) = boxes[j] else { continue };
            let (sa, sb) = (a.short_side(), b.short_side());
            let ratio = sa / sb;
            if ratio > SIZE_RATIO || ratio < 1.0 / SIZE_RATIO {
                continue;
            }
            let gap_x = (a.x0.max(b.x0) - a.x1.min(b.x1)).max(0.0);
            let gap_y = (a.y0.max(b.y0) - a.y1.min(b.y1)).max(0.0);
            let limit = GAP_RATIO * sa.min(sb);
            if gap_x <= limit && gap_y <= limit {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                if ri != rj {
                    parent[rj.max(ri)] = rj.min(ri);
                }
            }
        }
    }

    // Giữ thứ tự xuất hiện của nhóm theo dòng đầu tiên.
    let mut order: Vec<usize> = Vec::new();
    let mut groups: Vec<Vec<Poly>> = vec![Vec::new(); n];
    for i in 0..n {
        let r = find(&mut parent, i);
        if groups[r].is_empty() {
            order.push(r);
        }
        groups[r].push(lines[i].clone());
    }
    order.into_iter().map(|r| TextRegion::from_lines(std::mem::take(&mut groups[r]))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quad(x0: f32, y0: f32, x1: f32, y1: f32) -> Poly {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    #[test]
    fn stacked_lines_merge_and_far_ones_do_not() {
        // 2 dòng chồng nhau trong cùng bóng thoại (cao 12, cách 4px) + 1 dòng ở xa.
        let lines = vec![
            quad(10.0, 10.0, 60.0, 22.0),
            quad(12.0, 26.0, 58.0, 38.0),
            quad(200.0, 10.0, 250.0, 22.0),
        ];
        let regions = group_lines(&lines);
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].lines.len(), 2);
        assert_eq!(regions[0].xywh, [10, 10, 50, 28]);
        assert_eq!(regions[1].lines.len(), 1);
    }

    #[test]
    fn vertical_columns_merge() {
        // Chữ dọc kiểu Nhật: hai cột cao 80, rộng 12, sát nhau.
        let lines = vec![quad(100.0, 10.0, 112.0, 90.0), quad(86.0, 12.0, 98.0, 88.0)];
        assert_eq!(group_lines(&lines).len(), 1);
    }

    #[test]
    fn very_different_sizes_stay_separate() {
        let lines = vec![quad(10.0, 10.0, 60.0, 22.0), quad(10.0, 26.0, 200.0, 90.0)];
        assert_eq!(group_lines(&lines).len(), 2);
    }

    #[test]
    fn empty_input() {
        assert!(group_lines(&[]).is_empty());
    }
}
