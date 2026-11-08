use std::fs::File;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;
use super::cbz::PageData;

pub fn create_zip(
    output_path: &Path,
    pages: &[PageData],
) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = File::create(output_path).map_err(|e| format!("Create ZIP file failed: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for (idx, page) in pages.iter().enumerate() {
        let ext = Path::new(&page.filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("webp");
        let entry_name = format!("{:03}.{}", idx + 1, ext);

        zip.start_file(&entry_name, options).map_err(|e| e.to_string())?;
        zip.write_all(&page.bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| format!("Finish ZIP failed: {}", e))?;
    Ok(())
}
