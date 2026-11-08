use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::core::comicinfo::generate_comic_info_xml;
use crate::error::{MoeJectError, Result};
use crate::models::{Chapter, MangaInfo, OutputFormat};

pub fn detect_extension(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        "png"
    } else if bytes.len() >= 3 && &bytes[0..3] == b"\xff\xd8\xff" {
        "jpg"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        "gif"
    } else {
        "jpg"
    }
}

pub fn package_pages(
    output_dir: &Path,
    manga: &MangaInfo,
    chapter: &Chapter,
    pages: &[(usize, Vec<u8>)],
    format: OutputFormat,
) -> Result<PathBuf> {
    std::fs::create_dir_all(output_dir)?;

    let clean_manga_title = sanitize_filename(&manga.title);
    let clean_chapter_num = sanitize_filename(&chapter.chapter_number);
    let base_name = format!("{clean_manga_title} - Ch.{clean_chapter_num}");

    match format {
        OutputFormat::Images => {
            let chapter_folder = output_dir.join(&base_name);
            std::fs::create_dir_all(&chapter_folder)?;

            for (idx, data) in pages {
                let ext = detect_extension(data);
                let filename = format!("{:03}.{ext}", idx + 1);
                std::fs::write(chapter_folder.join(filename), data)?;
            }
            Ok(chapter_folder)
        }
        OutputFormat::Zip => {
            let zip_path = output_dir.join(format!("{base_name}.zip"));
            let file = File::create(&zip_path)?;
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o755);

            for (idx, data) in pages {
                let ext = detect_extension(data);
                let entry_name = format!("{:03}.{ext}", idx + 1);
                zip.start_file(entry_name, options)?;
                zip.write_all(data)?;
            }

            zip.finish()?;
            Ok(zip_path)
        }
        OutputFormat::Cbz => {
            let cbz_path = output_dir.join(format!("{base_name}.cbz"));
            let file = File::create(&cbz_path)?;
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o755);

            // 1. Add ComicInfo.xml
            let comic_info = generate_comic_info_xml(manga, chapter, pages.len());
            zip.start_file("ComicInfo.xml", options)?;
            zip.write_all(comic_info.as_bytes())?;

            // 2. Add Images
            for (idx, data) in pages {
                let ext = detect_extension(data);
                let entry_name = format!("{:03}.{ext}", idx + 1);
                zip.start_file(entry_name, options)?;
                zip.write_all(data)?;
            }

            zip.finish()?;
            Ok(cbz_path)
        }
        OutputFormat::Pdf => {
            // Fallback to CBZ if PDF not requested specifically
            Err(MoeJectError::InvalidRequest(
                "PDF packaging not yet supported directly, please use CBZ/ZIP".to_string(),
            ))
        }
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    let mut clean: String = name
        .chars()
        .map(|c| if invalid_chars.contains(&c) { '_' } else { c })
        .collect();
    if clean.trim().is_empty() {
        clean = "Untitled".to_string();
    }
    clean.trim().to_string()
}
