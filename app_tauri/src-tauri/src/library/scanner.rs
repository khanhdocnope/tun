use crate::models::LibraryBook;
use base64::Engine;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

pub fn scan_library_dir(dir_path: &Path) -> Vec<LibraryBook> {
    let mut books = Vec::new();
    if !dir_path.exists() {
        return books;
    }

    let entries = match std::fs::read_dir(dir_path) {
        Ok(e) => e,
        Err(_) => return books,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if ext == "cbz" || ext == "zip" {
                if let Ok(book) = inspect_archive(&path, &ext) {
                    books.push(book);
                }
            }
        } else if path.is_dir() {
            // Check 1 level deeper (e.g. downloads/MangaName/Chapter1.cbz)
            if let Ok(sub_entries) = std::fs::read_dir(&path) {
                for sub in sub_entries.flatten() {
                    let sub_path = sub.path();
                    let sub_ext = sub_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                    if sub_ext == "cbz" || sub_ext == "zip" {
                        if let Ok(book) = inspect_archive(&sub_path, &sub_ext) {
                            books.push(book);
                        }
                    }
                }
            }
        }
    }

    books
}

fn inspect_archive(path: &Path, format: &str) -> Result<LibraryBook, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string();
    let file_path = path.to_string_lossy().to_string();

    let mut manga_title = path.parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Manga")
        .to_string();
    let mut chapter_title = file_name.clone();

    // Check ComicInfo.xml
    if let Ok(mut xml_file) = archive.by_name("ComicInfo.xml") {
        let mut xml_content = String::new();
        if xml_file.read_to_string(&mut xml_content).is_ok() {
            if let Some(s) = extract_xml_tag(&xml_content, "Series") {
                manga_title = s;
            }
            if let Some(t) = extract_xml_tag(&xml_content, "Title") {
                chapter_title = t;
            }
        }
    }

    // Find first image for cover
    let mut image_files = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().to_lowercase();
            if name.ends_with(".webp") || name.ends_with(".jpg") || name.ends_with(".jpeg") || name.ends_with(".png") {
                image_files.push(f.name().to_string());
            }
        }
    }

    image_files.sort();
    let total_pages = image_files.len();

    let mut cover_base64 = None;
    if let Some(first_img_name) = image_files.first() {
        if let Ok(mut img_file) = archive.by_name(first_img_name) {
            let mut img_bytes = Vec::new();
            if img_file.read_to_end(&mut img_bytes).is_ok() {
                cover_base64 = Some(base64::engine::general_purpose::STANDARD.encode(&img_bytes));
            }
        }
    }

    Ok(LibraryBook {
        file_name,
        file_path,
        manga_title,
        chapter_title,
        total_pages,
        cover_base64,
        file_format: format.to_string(),
    })
}

pub fn get_archive_page_base64(archive_path: &str, page_index: usize) -> Result<String, String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut image_files = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().to_lowercase();
            if name.ends_with(".webp") || name.ends_with(".jpg") || name.ends_with(".jpeg") || name.ends_with(".png") {
                image_files.push(f.name().to_string());
            }
        }
    }

    image_files.sort();
    if page_index >= image_files.len() {
        return Err("Page index out of bounds".to_string());
    }

    let target_file = &image_files[page_index];
    let mut file = archive.by_name(target_file).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start = xml.find(&start_tag)? + start_tag.len();
    let end = xml.find(&end_tag)?;
    if start < end {
        Some(xml[start..end].trim().to_string())
    } else {
        None
    }
}
