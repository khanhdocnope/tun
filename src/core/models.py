"""
Mô hình dữ liệu chuẩn của hệ thống MoeJect.
Đảm bảo đồng nhất cấu trúc từ tầng Crawler đến tầng lưu trữ CBZ/Database.
"""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any


class OutputFormat(str, Enum):
    IMAGES = "images"  # Thư mục ảnh rời
    ZIP = "zip"        # File .zip chứa ảnh thô (thuận tiện cho lưu trữ hoặc tải lên AI Cleaner batch)
    CBZ = "cbz"        # File .cbz chuẩn truyện tranh quốc tế (kèm ComicInfo.xml metadata)
    PDF = "pdf"        # File PDF đóng gói


@dataclass
class Chapter:
    """Đại diện cho 1 chương truyện."""
    id: str
    title: str
    chapter_number: str
    url: str
    scanlator: Optional[str] = None
    pages: List[str] = field(default_factory=list)  # Danh sách URL ảnh


@dataclass
class MangaSearchResult:
    """Kết quả tìm kiếm manga rút gọn."""
    id: str
    title: str
    url: str
    cover_url: Optional[str] = None
    latest_chapter: Optional[str] = None
    description: Optional[str] = None
    authors: List[str] = field(default_factory=list)
    genres: List[str] = field(default_factory=list)


@dataclass
class MangaInfo:
    """Thông tin toàn diện của bộ manga."""
    id: str
    title: str
    url: str
    cover_url: Optional[str] = None
    description: Optional[str] = None
    authors: List[str] = field(default_factory=list)
    genres: List[str] = field(default_factory=list)
    chapters: List[Chapter] = field(default_factory=list)


@dataclass(frozen=True)
class ImageFailure:
    """Báo cáo chuẩn đoán chi tiết khi tải 1 trang ảnh thất bại."""
    index: int
    category: str
    attempts: int
    message: str
    host: str = ""


@dataclass
class DownloadReport:
    """Báo cáo kết quả tải toàn bộ chapter."""
    chapter_id: str
    total_pages: int
    downloaded_pages: List[Tuple[int, bytes]] = field(default_factory=list)
    failures: List[ImageFailure] = field(default_factory=list)
    output_path: Optional[Path] = None

    @property
    def is_successful(self) -> bool:
        return len(self.downloaded_pages) == self.total_pages and not self.failures
