use std::fs::File;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub struct PageData {
    pub filename: String,
    pub bytes: Vec<u8>,
}

pub fn create_cbz(
    output_path: &Path,
    manga_title: &str,
    chapter_title: &str,
    chapter_number: f64,
    pages: &[PageData],
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = File::create(output_path).map_err(|e| format!("Create CBZ file failed: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // 1. Write ComicInfo.xml
    let comic_info = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>{}</Title>
  <Series>{}</Series>
  <Number>{}</Number>
  <PageCount>{}</PageCount>
  <Manga>Yes</Manga>
</ComicInfo>"#,
        quick_xml_escape(chapter_title),
        quick_xml_escape(manga_title),
        chapter_number,
        pages.len()
    );

    zip.start_file("ComicInfo.xml", options).map_err(|e| e.to_string())?;
    zip.write_all(comic_info.as_bytes()).map_err(|e| e.to_string())?;

    // 2. Write each page
    for (idx, page) in pages.iter().enumerate() {
        let ext = Path::new(&page.filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("webp");
        let entry_name = format!("{:03}.{}", idx + 1, ext);

        zip.start_file(&entry_name, options).map_err(|e| e.to_string())?;
        zip.write_all(&page.bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| format!("Finish CBZ failed: {}", e))?;
    Ok(())
}

pub fn create_cbz_from_files(
    output_path: &Path,
    manga_title: &str,
    chapter_title: &str,
    chapter_number: f64,
    file_paths: &[std::path::PathBuf],
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = File::create(output_path).map_err(|e| format!("Create CBZ file failed: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // 1. Write ComicInfo.xml
    let comic_info = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>{}</Title>
  <Series>{}</Series>
  <Number>{}</Number>
  <PageCount>{}</PageCount>
  <Manga>Yes</Manga>
</ComicInfo>"#,
        quick_xml_escape(chapter_title),
        quick_xml_escape(manga_title),
        chapter_number,
        file_paths.len()
    );

    zip.start_file("ComicInfo.xml", options).map_err(|e| e.to_string())?;
    zip.write_all(comic_info.as_bytes()).map_err(|e| e.to_string())?;

    // 2. Stream each file from disk
    for (idx, path) in file_paths.iter().enumerate() {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("webp");
        let entry_name = format!("{:03}.{}", idx + 1, ext);

        zip.start_file(&entry_name, options).map_err(|e| e.to_string())?;
        let mut f = File::open(path).map_err(|e| format!("Open page file {:?} failed: {}", path, e))?;
        std::io::copy(&mut f, &mut zip).map_err(|e| format!("Write page to CBZ failed: {}", e))?;
    }

    zip.finish().map_err(|e| format!("Finish CBZ failed: {}", e))?;
    Ok(())
}

fn quick_xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
