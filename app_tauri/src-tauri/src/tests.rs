#[cfg(test)]
mod tests {
    use crate::downloader::is_valid_image;
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

    #[test]
    fn test_sources_catalog_loading_and_counts() {
        use crate::sources::catalog::{get_catalog, is_template_supported, search_catalog_sources};

        let cat = get_catalog();
        assert!(cat.total >= 1300, "Catalog should have at least 1300 sources, got {}", cat.total);

        // Check template coverage
        let madara_count = cat.sources.iter().filter(|s| s.template == "WordPressMadara").count();
        let mangastream_count = cat.sources.iter().filter(|s| s.template == "WordPressMangastream").count();
        let mojoportal_count = cat.sources.iter().filter(|s| s.template == "MojoPortalComic").count();

        assert!(madara_count >= 400, "Madara count: {}", madara_count);
        assert!(mangastream_count >= 190, "MangaStream count: {}", mangastream_count);
        assert!(mojoportal_count >= 10, "MojoPortal count: {}", mojoportal_count);

        // Verify supported template checker
        assert!(is_template_supported("WordPressMadara"));
        assert!(is_template_supported("WordPressMangastream"));
        assert!(is_template_supported("MojoPortalComic"));
        assert!(!is_template_supported("Connector"));

        // Search test
        let net_results = search_catalog_sources("nettruyen", None);
        assert!(!net_results.is_empty(), "Should find NetTruyen in catalog");
        assert_eq!(net_results[0].id, "nettruyen");

        // Language filter test
        let vi_results = search_catalog_sources("", Some("vi"));
        assert!(!vi_results.is_empty(), "Should find Vietnamese sources");
        assert!(vi_results.iter().all(|s| s.languages.contains(&"vi".to_string())));
    }
}
