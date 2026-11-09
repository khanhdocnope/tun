//! Keo dán bước 2-3 của `_process_page_impl` (app.py): phân loại vùng, lọc theo chế độ xóa,
//! rồi refine mask. Detector (đầu vào) và inpainter (đầu ra) sẽ nối vào hai đầu này.

use super::classify::classify_text_region;
use super::mask::{refine_text_mask, RefineOptions};
use super::types::{BoxType, Mask, Poly, Rgb, TextRegion};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanScope {
    All,
    BubbleOnly,
}

impl CleanScope {
    /// Giống Python: chỉ đúng chuỗi "bubble_only" mới lọc, mọi giá trị khác = xóa tất cả.
    pub fn parse(s: &str) -> Self {
        if s == "bubble_only" {
            CleanScope::BubbleOnly
        } else {
            CleanScope::All
        }
    }
}

pub struct PageMask {
    /// Mọi vùng, đã gán `box_type` (kể cả vùng bị lọc, để trả về cho UI).
    pub regions: Vec<TextRegion>,
    /// Số vùng thực sự được xóa.
    pub active: usize,
    /// Mask cuối cùng để đưa vào inpainter (cùng kích thước ảnh).
    pub mask: Mask,
}

pub fn select_and_refine(
    img: &Rgb,
    mut regions: Vec<TextRegion>,
    raw_mask: &Mask,
    scope: CleanScope,
    dilation_offset: i32,
) -> PageMask {
    let (w, h) = (img.width() as usize, img.height() as usize);

    for r in regions.iter_mut() {
        r.box_type = Some(classify_text_region(r.xywh, img));
    }

    let is_active = |r: &TextRegion| scope == CleanScope::All || r.box_type == Some(BoxType::Bubble);
    let active = regions.iter().filter(|&r| is_active(r)).count();

    if active == 0 {
        return PageMask { regions, active, mask: Mask::new(w, h) };
    }

    let lines: Vec<Poly> = regions
        .iter()
        .filter(|&r| is_active(r))
        .flat_map(|r| r.lines.iter().cloned())
        .collect();

    let raw = raw_mask.resize_nearest(w, h);
    let opts = RefineOptions { dilation_offset, ..Default::default() };
    let mask = refine_text_mask(&raw, &lines, &opts);

    PageMask { regions, active, mask }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb as Px;

    fn poly(x0: f32, y0: f32, x1: f32, y1: f32) -> Poly {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    }

    /// Nửa trái: bóng thoại trắng; nửa phải: nền đỏ (SFX). Mỗi bên có vài nét trong mask thô.
    fn scene() -> (Rgb, Vec<TextRegion>, Mask) {
        let mut img = Rgb::from_pixel(100, 60, Px([255, 255, 255]));
        for y in 0..60 {
            for x in 60..100 {
                img.put_pixel(x, y, Px([220, 30, 30]));
            }
        }
        let mut raw = Mask::new(100, 60);
        for x in [10usize, 16, 22] {
            for y in 20..30 {
                for dx in 0..3 {
                    raw.set(x + dx, y, 255);
                    raw.set(x + 55 + dx, y, 255);
                }
            }
        }
        let a = TextRegion::from_lines(vec![poly(8.0, 18.0, 28.0, 32.0)]);
        let b = TextRegion::from_lines(vec![poly(63.0, 18.0, 83.0, 32.0)]);
        (img, vec![a, b], raw)
    }

    #[test]
    fn all_cleans_both_regions() {
        let (img, regions, raw) = scene();
        let out = select_and_refine(&img, regions, &raw, CleanScope::All, 2);
        assert_eq!(out.active, 2);
        assert_eq!(out.regions[0].box_type, Some(BoxType::Bubble));
        assert_eq!(out.regions[1].box_type, Some(BoxType::Sfx));
        assert_eq!(out.mask.get(11, 25), 255);
        assert_eq!(out.mask.get(66, 25), 255);
    }

    #[test]
    fn bubble_only_keeps_sfx_untouched() {
        let (img, regions, raw) = scene();
        let out = select_and_refine(&img, regions, &raw, CleanScope::BubbleOnly, 2);
        assert_eq!(out.active, 1);
        assert_eq!(out.mask.get(11, 25), 255);
        assert_eq!(out.mask.get(66, 25), 0);
    }

    #[test]
    fn nothing_active_gives_empty_mask() {
        let (img, mut regions, raw) = scene();
        regions.remove(0);
        let out = select_and_refine(&img, regions, &raw, CleanScope::BubbleOnly, 2);
        assert_eq!(out.active, 0);
        assert!(out.mask.is_empty());
    }

    #[test]
    fn scope_parse_matches_python_semantics() {
        assert_eq!(CleanScope::parse("bubble_only"), CleanScope::BubbleOnly);
        assert_eq!(CleanScope::parse("all"), CleanScope::All);
        assert_eq!(CleanScope::parse("anything"), CleanScope::All);
    }
}
