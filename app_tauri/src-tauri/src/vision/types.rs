use image::RgbImage;

/// Một điểm (x, y) theo pixel.
pub type Pt = [f32; 2];
/// Đa giác của một dòng chữ (thường 4 điểm - quadrilateral từ detector).
pub type Poly = Vec<Pt>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoxType {
    Bubble,
    Sfx,
}

impl BoxType {
    pub fn as_str(self) -> &'static str {
        match self {
            BoxType::Bubble => "bubble",
            BoxType::Sfx => "sfx",
        }
    }
}

/// Vùng chữ đã gộp dòng (tương đương TextBlock của manga-image-translator).
#[derive(Debug, Clone)]
pub struct TextRegion {
    /// Hộp bao [x, y, w, h] theo pixel ảnh gốc.
    pub xywh: [i32; 4],
    pub lines: Vec<Poly>,
    pub box_type: Option<BoxType>,
}

impl TextRegion {
    /// Tạo vùng từ các dòng; `xywh` là hộp bao của mọi điểm (cắt phần thập phân).
    pub fn from_lines(lines: Vec<Poly>) -> Self {
        let mut min = [f32::MAX; 2];
        let mut max = [f32::MIN; 2];
        for p in lines.iter().flatten() {
            for k in 0..2 {
                min[k] = min[k].min(p[k]);
                max[k] = max[k].max(p[k]);
            }
        }
        let xywh = if min[0] > max[0] {
            [0, 0, 0, 0]
        } else {
            [min[0] as i32, min[1] as i32, (max[0] - min[0]) as i32, (max[1] - min[1]) as i32]
        };
        Self { xywh, lines, box_type: None }
    }
}

/// Mask 1 kênh, giá trị 0 hoặc 255, lưu theo hàng.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mask {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl Mask {
    pub fn new(width: usize, height: usize) -> Self {
        Self { width, height, data: vec![0; width * height] }
    }

    pub fn from_raw(width: usize, height: usize, data: Vec<u8>) -> Result<Self, String> {
        if data.len() != width * height {
            return Err(format!("mask {}x{} cần {} byte, nhận {}", width, height, width * height, data.len()));
        }
        Ok(Self { width, height, data })
    }

    pub fn get(&self, x: usize, y: usize) -> u8 {
        self.data[y * self.width + x]
    }

    pub fn set(&mut self, x: usize, y: usize, v: u8) {
        self.data[y * self.width + x] = v;
    }

    pub fn count_nonzero(&self) -> usize {
        self.data.iter().filter(|&&v| v != 0).count()
    }

    pub fn is_empty(&self) -> bool {
        self.data.iter().all(|&v| v == 0)
    }

    /// Resize nearest-neighbor (dùng khi mask của detector khác kích thước ảnh).
    pub fn resize_nearest(&self, width: usize, height: usize) -> Mask {
        if width == self.width && height == self.height {
            return self.clone();
        }
        let mut out = Mask::new(width, height);
        if self.width == 0 || self.height == 0 {
            return out;
        }
        for y in 0..height {
            let sy = (y * self.height / height).min(self.height - 1);
            for x in 0..width {
                let sx = (x * self.width / width).min(self.width - 1);
                out.data[y * width + x] = self.data[sy * self.width + sx];
            }
        }
        out
    }
}

/// Ảnh RGB dùng chung toàn pipeline.
pub type Rgb = RgbImage;
