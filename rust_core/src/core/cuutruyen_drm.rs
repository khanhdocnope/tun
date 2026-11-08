use base64::prelude::*;
use image::{DynamicImage, ImageFormat, RgbImage};
use std::io::Cursor;

pub fn descramble_cuutruyen(img_bytes: &[u8], drm_b64: &str) -> Vec<u8> {
    let raw = match BASE64_STANDARD.decode(drm_b64.trim()) {
        Ok(b) => b,
        Err(_) => return img_bytes.to_vec(),
    };

    let key = b"3141592653589793";
    let decrypted: String = raw
        .iter()
        .enumerate()
        .map(|(i, &b)| (b ^ key[i % key.len()]) as char)
        .collect();

    if !decrypted.starts_with("#v4|") {
        return img_bytes.to_vec();
    }

    let img = match image::load_from_memory(img_bytes) {
        Ok(im) => im.to_rgb8(),
        Err(_) => return img_bytes.to_vec(),
    };

    let (width, height) = img.dimensions();
    let mut canvas = RgbImage::new(width, height);
    let mut sy: u32 = 0;

    for slice_def in decrypted.split('|').skip(1) {
        let trimmed = slice_def.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split('-').collect();
        if parts.len() != 2 {
            continue;
        }

        let dy: u32 = match parts[0].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let slice_h: u32 = match parts[1].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };

        if sy + slice_h > height || dy + slice_h > height {
            continue;
        }

        for y in 0..slice_h {
            for x in 0..width {
                let pixel = img.get_pixel(x, sy + y);
                canvas.put_pixel(x, dy + y, *pixel);
            }
        }

        sy += slice_h;
    }

    let mut buf = Cursor::new(Vec::new());
    match DynamicImage::ImageRgb8(canvas).write_to(&mut buf, ImageFormat::Jpeg) {
        Ok(_) => buf.into_inner(),
        Err(_) => img_bytes.to_vec(),
    }
}
