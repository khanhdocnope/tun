use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Detect real image format from magic bytes.
/// Returns "png", "jpg", "webp", "gif", or None if not a supported valid image.
pub fn detect_image_format(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 {
        return None;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    // Also accept 4-byte PNG prefix if truncated header
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("png");
    }

    // JPEG: FF D8 FF
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }

    // WebP: RIFF (4 bytes) + Size (4 bytes) + WEBP (4 bytes)
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }

    // GIF: GIF87a or GIF89a
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("gif");
    }

    None
}

/// Check if bytes represent a valid supported image format.
pub fn is_valid_image(bytes: &[u8]) -> bool {
    detect_image_format(bytes).is_some()
}

/// Validate an existing file on disk by reading its magic bytes.
pub fn validate_saved_image(path: &Path) -> Result<&'static str, String> {
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let mut file = File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    let mut header = [0u8; 16];
    let n = file.read(&mut header).map_err(|e| format!("Cannot read header: {}", e))?;
    if n < 4 {
        return Err("File too small to be a valid image".to_string());
    }

    detect_image_format(&header[..n])
        .ok_or_else(|| "Invalid magic bytes in image file".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_magic_bytes_detection() {
        assert_eq!(detect_image_format(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Some("png"));
        assert_eq!(detect_image_format(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Some("jpg"));
        assert_eq!(detect_image_format(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("webp"));
        assert_eq!(detect_image_format(b"GIF89a\x01\x00\x01\x00"), Some("gif"));
        assert_eq!(detect_image_format(b"<!DOCTYPE html>"), None);
        assert_eq!(detect_image_format(b"{\"error\":\"not found\"}"), None);
        assert_eq!(detect_image_format(&[]), None);
    }
}
