#[cfg(test)]
mod tests {
    use crate::downloader::pool::is_valid_image;
    use crate::sources::hitomi::HitomiSource;

    #[test]
    fn test_valid_image_magic_bytes() {
        // PNG magic bytes
        assert!(is_valid_image(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        // JPEG magic bytes
        assert!(is_valid_image(&[0xFF, 0xD8, 0xFF, 0xE0]));
        // GIF magic bytes
        assert!(is_valid_image(b"GIF89a..."));
        // WebP magic bytes
        assert!(is_valid_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ..."));
        // HTML or broken response
        assert!(!is_valid_image(b"<!DOCTYPE html><html>404 Not Found</html>"));
        assert!(!is_valid_image(&[0x00, 0x01]));
    }

    #[test]
    fn test_hitomi_image_url_resolver() {
        let hash = "1234567890abcdef";
        let url = HitomiSource::resolve_image_url(hash);
        assert!(url.contains("hitomi.la/webp"));
        assert!(url.ends_with(".webp"));
    }
}
