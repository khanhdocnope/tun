"""
Xử lý đóng gói truyện tranh sang định dạng CBZ (Comic Book Zip) chuẩn quốc tế.
Tích hợp đặc tả ComicInfo.xml metadata tương thích 100% với các ứng dụng đọc truyện:
Mihon, Tachiyomi, Kuro Reader, ComicRack, Chunky Comic Reader, v.v.
Hỗ trợ cả đóng gói hàng loạt (batch) lẫn ghi đệm luồng trực tiếp (streaming memory).
"""

from pathlib import Path
import threading
from typing import List, Tuple, Optional, Union
import xml.etree.ElementTree as ET
import zipfile

from ..core.models import MangaInfo, Chapter


def generate_comic_info_xml(
    manga_info: Optional[MangaInfo],
    chapter: Chapter,
    page_count: int
) -> str:
    """
    Tạo nội dung XML chuẩn ComicInfo.xml cho file CBZ.
    Tương thích tuyệt đối với các ứng dụng đọc truyện tranh (Mihon, Tachiyomi, Kuro Reader).

    Args:
        manga_info: Thông tin bộ truyện MangaInfo (Title, Authors, Genres, Description, v.v.).
        chapter: Thông tin chương truyện Chapter (Title, Chapter Number, Scanlator, URL).
        page_count: Tổng số trang trong chương.

    Returns:
        Chuỗi XML định dạng UTF-8 chứa đầy đủ các thẻ ComicInfo chuẩn.
    """
    root = ET.Element("ComicInfo")
    root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")
    root.set("xmlns:xsd", "http://www.w3.org/2001/XMLSchema")

    def _add_field(tag: str, text: Optional[object]) -> None:
        if text is not None:
            text_str = str(text).strip()
            if text_str:
                sub = ET.SubElement(root, tag)
                sub.text = text_str

    # 1. Tiêu đề chương
    ch_title = chapter.title.strip() if chapter.title else ""
    if not ch_title:
        ch_title = f"Chapter {chapter.chapter_number}" if chapter.chapter_number else "Chapter"
    _add_field("Title", ch_title)

    # 2. Tên bộ truyện (Series)
    if manga_info and manga_info.title:
        _add_field("Series", manga_info.title)

    # 3. Số chương (Number)
    if chapter.chapter_number:
        _add_field("Number", str(chapter.chapter_number))

    # 4. Tác giả (Writer)
    if manga_info and manga_info.authors:
        _add_field("Writer", ", ".join(manga_info.authors))

    # 5. Tóm tắt / Mô tả (Summary)
    if manga_info and manga_info.description:
        _add_field("Summary", manga_info.description)

    # 6. Thể loại (Genre)
    if manga_info and manga_info.genres:
        _add_field("Genre", ", ".join(manga_info.genres))

    # 7. Tổng số trang (PageCount)
    _add_field("PageCount", str(page_count))

    # 8. Nhóm dịch (ScanInformation)
    if chapter.scanlator:
        _add_field("ScanInformation", chapter.scanlator)

    # 9. Đường dẫn Web gốc
    web_url = chapter.url or (manga_info.url if manga_info else "")
    if web_url:
        _add_field("Web", web_url)

    # 10. Định hướng đọc Manga (phải qua trái)
    _add_field("Manga", "YesAndRightToLeft")

    # 11. Ghi chú nguồn đóng gói
    _add_field("Notes", "Packaged by MoeJect Core Downloader")

    # Canh lề thụt dòng chuẩn
    ET.indent(root, space="  ")
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    xml_str = xml_bytes.decode("utf-8")

    # Chuẩn hóa cú pháp dấu ngoặc kép trong khai báo XML
    if xml_str.startswith("<?xml version='1.0'"):
        xml_str = xml_str.replace("<?xml version='1.0' encoding='utf-8'?>", '<?xml version="1.0" encoding="utf-8"?>', 1)

    return xml_str


class CBZStreamPackager:
    """
    Bộ đóng gói Streaming cho định dạng CBZ.
    Ghi từng trang ảnh trực tiếp vào file .cbz đệm (.tmp) trên đĩa ngay khi tải xong.
    Tự động chèn ComicInfo.xml vào gốc file khi hoàn tất đóng gói.
    Giải phóng dữ liệu trang khỏi RAM tức thì, bảo đảm cam kết RAM < 80MB.
    """
    def __init__(
        self,
        output_path: Union[str, Path],
        manga_info: Optional[MangaInfo] = None,
        chapter: Optional[Chapter] = None,
        total_pages: int = 0,
        extension: str = "webp"
    ):
        self.output_path = Path(output_path)
        self.temp_path = self.output_path.with_suffix(self.output_path.suffix + ".tmp")
        self.manga_info = manga_info
        self.chapter = chapter
        self.total_pages = total_pages
        self.extension = extension.lstrip(".")
        self.pad_width = max(3, len(str(total_pages))) if total_pages > 0 else 3
        self._lock = threading.Lock()
        self._zip: Optional[zipfile.ZipFile] = None
        self._written_pages = 0
        self._is_closed = False

    def open(self) -> None:
        """Khởi tạo file CBZ đệm nếu chưa mở."""
        if self._zip is None:
            self.temp_path.parent.mkdir(parents=True, exist_ok=True)
            self._zip = zipfile.ZipFile(self.temp_path, "w", compression=zipfile.ZIP_DEFLATED)

    def __enter__(self) -> "CBZStreamPackager":
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None:
            self.abort()
        else:
            self.close()

    def format_page_name(self, index: int, custom_ext: Optional[str] = None) -> str:
        """Định dạng tên trang tuần tự chuẩn (001.webp, 002.webp,...)."""
        ext = (custom_ext or self.extension).lstrip(".")
        page_num = index + 1 if index >= 0 else abs(index)
        return f"{page_num:0{self.pad_width}d}.{ext}"

    def add_page(self, index: int, data: bytes, custom_ext: Optional[str] = None) -> str:
        """
        Ghi trực tiếp byte của 1 trang ảnh vào file CBZ và giải phóng RAM.

        Args:
            index: Thứ tự trang (0-based hoặc 1-based).
            data: Dữ liệu nhị phân của ảnh.
            custom_ext: Định dạng đuôi mở rộng riêng (nếu khác với đuôi mặc định).

        Returns:
            Tên file đã được lưu trong file CBZ.
        """
        filename = self.format_page_name(index, custom_ext=custom_ext)
        with self._lock:
            if self._zip is None:
                self.open()
            self._zip.writestr(filename, data)
            self._written_pages += 1
        return filename

    def close(self) -> Path:
        """Đóng file CBZ, chèn ComicInfo.xml và đổi tên từ .tmp sang file đích chính thức."""
        with self._lock:
            if self._zip is not None and not self._is_closed:
                # Chèn file ComicInfo.xml vào gốc của CBZ
                if self.chapter is not None:
                    count = self.total_pages if self.total_pages > 0 else self._written_pages
                    xml_content = generate_comic_info_xml(self.manga_info, self.chapter, count)
                    self._zip.writestr("ComicInfo.xml", xml_content.encode("utf-8"))

                self._zip.close()
                self._is_closed = True

                if self.temp_path.exists():
                    if self.output_path.exists():
                        self.output_path.unlink()
                    self.temp_path.rename(self.output_path)

        return self.output_path

    def abort(self) -> None:
        """Hủy đóng gói khi có sự cố, dọn dẹp file tạm trên đĩa."""
        with self._lock:
            if self._zip is not None and not self._is_closed:
                try:
                    self._zip.close()
                except Exception:
                    pass
                self._is_closed = True

            if self.temp_path.exists():
                try:
                    self.temp_path.unlink()
                except Exception:
                    pass


def create_chapter_cbz(
    output_path: Path,
    manga_info: MangaInfo,
    chapter: Chapter,
    pages: List[Tuple[int, bytes]],
    extension: str = "webp"
) -> Path:
    """
    Đóng gói các trang ảnh và chèn file ComicInfo.xml vào gốc của file .cbz.
    Sử dụng zipfile.ZipFile(..., compression=zipfile.ZIP_DEFLATED).

    Args:
        output_path: Đường dẫn file cbz đầu ra.
        manga_info: Thông tin tổng thể của Manga (title, tác giả, mô tả, thể loại).
        chapter: Thông tin chương (title, số chương, scanlator, url).
        pages: Danh sách tuple (index, image_bytes).
        extension: Đuôi file ảnh trong zip (mặc định 'webp').

    Returns:
        Path dẫn tới file cbz đã hoàn thành.
    """
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    sorted_pages = sorted(pages, key=lambda x: x[0])
    total_pages = len(sorted_pages)
    pad_width = max(3, len(str(total_pages)))

    min_idx = min((p[0] for p in sorted_pages), default=0)
    shift = 1 if min_idx == 0 else 0

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as cbz:
        # 1. Chèn metadata chuẩn ComicInfo.xml vào gốc
        xml_content = generate_comic_info_xml(manga_info, chapter, total_pages)
        cbz.writestr("ComicInfo.xml", xml_content.encode("utf-8"))

        # 2. Chèn các trang ảnh theo thứ tự 001.webp, 002.webp,...
        for idx, img_bytes in sorted_pages:
            page_num = idx + shift
            filename = f"{page_num:0{pad_width}d}.{extension.lstrip('.')}"
            cbz.writestr(filename, img_bytes)

    return out_path


def export_to_cbz(
    output_path: Path,
    pages: List[Tuple[int, bytes]],
    extension: str = "webp"
) -> Path:
    """
    Hàm tương thích ngược (legacy) để đóng gói ảnh sang CBZ không kèm metadata MangaInfo.
    """
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    dummy_chapter = Chapter(
        id=out_path.stem,
        title=out_path.stem,
        chapter_number="1",
        url=""
    )
    return create_chapter_cbz(
        output_path=out_path,
        manga_info=None,
        chapter=dummy_chapter,
        pages=pages,
        extension=extension
    )
