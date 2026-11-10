use crate::models::{MangaItem, ChapterItem, PageItem};
use crate::sources::MangaSource;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

pub struct CuutruyenSource {
    client: reqwest::Client,
}

impl CuutruyenSource {
    pub fn new() -> Self {
        Self {
            client: crate::sources::new_manga_client(),
        }
    }

    pub fn descramble_image(raw_bytes: &[u8], drm_b64: &str) -> Result<Vec<u8>, String> {
        use base64::Engine;
        use image::GenericImageView;

        let decoded_drm = base64::engine::general_purpose::STANDARD
            .decode(drm_b64)
            .map_err(|e| format!("Base64 decode DRM failed: {}", e))?;

        let pi_key = b"3141592653589793";
        let mut xor_bytes = Vec::with_capacity(decoded_drm.len());
        for (i, b) in decoded_drm.iter().enumerate() {
            xor_bytes.push(b ^ pi_key[i % pi_key.len()]);
        }

        // xor_bytes contains integers in JSON format or raw coordinates (#v4|dy-height|...)
        let coords_str = String::from_utf8(xor_bytes).map_err(|e| format!("UTF-8 decode failed: {}", e))?;

        let src_img = image::load_from_memory(raw_bytes).map_err(|e| format!("Load image failed: {}", e))?;
        let (width, height) = src_img.dimensions();

        let mut dest_img = image::RgbaImage::new(width, height);

        if coords_str.starts_with("#v4|") {
            let mut sy = 0u32;
            for part in coords_str.split('|').skip(1) {
                let segs: Vec<&str> = part.split('-').collect();
                if segs.len() == 2 {
                    if let (Ok(dy), Ok(sh)) = (segs[0].parse::<u32>(), segs[1].parse::<u32>()) {
                        for y in 0..sh {
                            if sy + y < height && dy + y < height {
                                for x in 0..width {
                                    let pixel = src_img.get_pixel(x, sy + y);
                                    dest_img.put_pixel(x, dy + y, pixel);
                                }
                            }
                        }
                        sy += sh;
                    }
                }
            }
        } else {
            let coords: Vec<u32> = serde_json::from_str(&coords_str).map_err(|e| format!("JSON parse coords failed: {}", e))?;
            let slice_count = coords.len() as u32;
            if slice_count == 0 {
                return Ok(raw_bytes.to_vec());
            }

            let slice_height = height / slice_count;
            for (i, &dy) in coords.iter().enumerate() {
                let sy = (i as u32) * slice_height;
                for x in 0..width {
                    for y in 0..slice_height {
                        if sy + y < height && dy + y < height {
                            let pixel = src_img.get_pixel(x, sy + y);
                            dest_img.put_pixel(x, dy + y, pixel);
                        }
                    }
                }
            }
        }

        let mut output = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut output);
        dest_img.write_to(&mut cursor, image::ImageFormat::WebP)
            .map_err(|e| format!("Encode WebP failed: {}", e))?;

        Ok(output)
    }
}

impl MangaSource for CuutruyenSource {
    fn source_id(&self) -> &'static str {
        "cuutruyen"
    }

    fn source_name(&self) -> &'static str {
        "Cứu Truyện"
    }

    fn search<'a>(&'a self, query: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<MangaItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = if query.trim().is_empty() {
                "https://cuutruyen.net/api/v2/mangas/recently_updated?page=1&per_page=24".to_string()
            } else {
                format!(
                    "https://cuutruyen.net/api/v2/mangas/search?q={}&page=1&per_page=24",
                    urlencoding::encode(query)
                )
            };

            let resp = self.client.get(&url)
                .header(reqwest::header::REFERER, "https://cuutruyen.net/")
                .send()
                .await
                .map_err(|e| format!("Cuutruyen search failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut results = Vec::new();

            if let Some(arr) = json["data"].as_array() {
                for item in arr {
                    let id = item["id"].as_i64().map(|n| n.to_string()).unwrap_or_default();
                    let title = item["name"].as_str().unwrap_or("Untitled").to_string();
                    let desc = item["description"].as_str().map(|s| s.to_string());
                    let cover_url = item["cover_url"].as_str().unwrap_or("").to_string();

                    results.push(MangaItem {
                        id,
                        title,
                        cover_url,
                        source: "cuutruyen".to_string(),
                        description: desc,
                        authors: vec![],
                        status: item["status"].as_str().map(|s| s.to_string()),
                        genres: vec![],
                    });
                }
            }

            Ok(results)
        })
    }

    fn get_chapters<'a>(&'a self, manga_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<ChapterItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("https://cuutruyen.net/api/v2/mangas/{}/chapters", manga_id);
            let resp = self.client.get(&url)
                .header(reqwest::header::REFERER, "https://cuutruyen.net/")
                .send()
                .await
                .map_err(|e| format!("Cuutruyen chapters failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut chapters = Vec::new();

            if let Some(arr) = json["data"].as_array() {
                for item in arr {
                    let id = item["id"].as_i64().map(|n| n.to_string()).unwrap_or_default();
                    let ch_num = item["number"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                    let title = item["name"].as_str().unwrap_or("").to_string();

                    let display_title = if title.is_empty() {
                        format!("Chương {}", ch_num)
                    } else {
                        format!("Chương {} - {}", ch_num, title)
                    };

                    chapters.push(ChapterItem {
                        id,
                        manga_id: manga_id.to_string(),
                        chapter_number: ch_num,
                        title: display_title,
                        source: "cuutruyen".to_string(),
                        language: "vi".to_string(),
                    });
                }
            }

            Ok(chapters)
        })
    }

    fn get_pages<'a>(&'a self, chapter_id: &'a str) -> Pin<Box<dyn Future<Output = Result<Vec<PageItem>, String>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("https://cuutruyen.net/api/v2/chapters/{}", chapter_id);
            let resp = self.client.get(&url)
                .header(reqwest::header::REFERER, "https://cuutruyen.net/")
                .send()
                .await
                .map_err(|e| format!("Cuutruyen chapter pages failed: {}", e))?;

            let json: Value = resp.json().await.map_err(|e| format!("Parse json failed: {}", e))?;
            let mut pages = Vec::new();

            if let Some(arr) = json["data"]["pages"].as_array() {
                for (idx, p) in arr.iter().enumerate() {
                    let src = p["image_url"].as_str()
                        .or_else(|| p["src"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let drm_data = p["drm_data"].as_str().map(|s| s.to_string());
                    if !src.is_empty() {
                        pages.push(PageItem {
                            page_number: idx + 1,
                            url: src,
                            drm_data,
                            fallback_urls: vec![],
                        });
                    }
                }
            }

            Ok(pages)
        })
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut encoded = String::new();
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(b as char);
                }
                b' ' => encoded.push('+'),
                _ => encoded.push_str(&format!("%{:02X}", b)),
            }
        }
        encoded
    }
}
