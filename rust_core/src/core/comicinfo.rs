use crate::models::{Chapter, MangaInfo};

pub fn generate_comic_info_xml(manga: &MangaInfo, chapter: &Chapter, page_count: usize) -> String {
    let title = xml_escape(&chapter.title);
    let series = xml_escape(&manga.title);
    let number = xml_escape(&chapter.chapter_number);
    let summary = xml_escape(manga.description.as_deref().unwrap_or(""));
    let writer = xml_escape(&manga.authors.join(", "));
    let genre = xml_escape(&manga.genres.join(", "));
    let scanlator = xml_escape(chapter.scanlator.as_deref().unwrap_or(""));

    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>{title}</Title>
  <Series>{series}</Series>
  <Number>{number}</Number>
  <Summary>{summary}</Summary>
  <Writer>{writer}</Writer>
  <Genre>{genre}</Genre>
  <ScanInformation>{scanlator}</ScanInformation>
  <PageCount>{page_count}</PageCount>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>"#
    )
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
