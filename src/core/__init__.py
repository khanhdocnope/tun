"""
Core package của hệ sinh thái MoeJect.
Bao gồm bộ tải ảnh đa luồng Two-Tier Concurrency, quản lý phiên kết nối, và mô hình dữ liệu.
"""

from .models import (
    Chapter,
    MangaInfo,
    MangaSearchResult,
    OutputFormat,
    ImageFailure,
    DownloadReport,
)
from .session import (
    COOKIE_FILE_PATH,
    get_http_session,
    load_cookies_into_session,
    load_cookies_into_httpx,
    save_cookies_from_list,
    get_saved_cookies,
)
from .downloader import (
    HostConnectionGate,
    ConcurrentMangaDownloader,
    download_manga_chapters,
    validate_image_bytes,
)

__all__ = [
    "Chapter",
    "MangaInfo",
    "MangaSearchResult",
    "OutputFormat",
    "ImageFailure",
    "DownloadReport",
    "COOKIE_FILE_PATH",
    "get_http_session",
    "load_cookies_into_session",
    "load_cookies_into_httpx",
    "save_cookies_from_list",
    "get_saved_cookies",
    "HostConnectionGate",
    "ConcurrentMangaDownloader",
    "download_manga_chapters",
    "validate_image_bytes",
]
