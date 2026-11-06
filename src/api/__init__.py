"""
Manga Source Connectors & WAF Bypass Module cho MoeJect.
Cung cấp các lớp giao tiếp chuẩn hóa với MangaDex, Cứu Truyện và các nguồn mở rộng.
"""

from typing import Any, Dict, List, Type

from src.api.base import BaseMangaSource
from src.api.browser_runner import (
    CloudflareBypassRunner,
    bypass_comix_waf,
    bypass_url,
    run_bypass_sync,
)
from src.api.comix import ComixSource
from src.api.cuutruyen import CuutruyenSource
from src.api.mangadex import MangaDexSource
from src.utils.dns import enable_smart_dns

# Tự động kích hoạt Smart DNS chống chặn ISP khi nạp tầng API
enable_smart_dns()

# Bảng đăng ký các nguồn truyện có sẵn trong hệ thống
_SOURCE_REGISTRY: Dict[str, Type[BaseMangaSource]] = {
    MangaDexSource.source_id: MangaDexSource,
    CuutruyenSource.source_id: CuutruyenSource,
    ComixSource.source_id: ComixSource,
}

SOURCE_METADATA: Dict[str, Dict[str, Any]] = {
    "mangadex": {
        "id": "mangadex",
        "name": "MangaDex",
        "url": "https://mangadex.org",
        "languages": ["vi", "en", "ja"],
        "description": "Kho truyện tranh quốc tế hỗ trợ REST API chính thức và đa ngôn ngữ.",
        "needs_browser_bypass": False,
        "status": "active",
        "class": MangaDexSource,
    },
    "cuutruyen": {
        "id": "cuutruyen",
        "name": "Cuutruyen",
        "url": "https://cuutruyen.net",
        "languages": ["vi"],
        "description": "Cổng truyện tranh Tiếng Việt chất lượng cao (WAF / Cloudflare nodriver).",
        "needs_browser_bypass": True,
        "status": "active",
        "class": CuutruyenSource,
    },
    "comix": {
        "id": "comix",
        "name": "Comix.to",
        "url": "https://comix.to",
        "languages": ["en", "raw"],
        "description": "Nguồn truyện tranh Comix.to kế thừa từ comix-downloader (WAF Turnstile @waf/challenge).",
        "needs_browser_bypass": True,
        "status": "active",
        "class": ComixSource,
    },
}
AVAILABLE_SOURCES = SOURCE_METADATA


def get_source_metadata(source_id: str) -> Dict[str, Any]:
    """Lấy thông tin chi tiết metadata của nguồn truyện."""
    clean_id = source_id.strip().lower()
    if clean_id in SOURCE_METADATA:
        return SOURCE_METADATA[clean_id]
    if clean_id in _SOURCE_REGISTRY:
        cls = _SOURCE_REGISTRY[clean_id]
        return {
            "id": getattr(cls, "source_id", clean_id),
            "name": getattr(cls, "source_name", clean_id.capitalize()),
            "url": getattr(cls, "base_url", ""),
            "languages": ["vi"],
            "description": "Nguồn truyện mở rộng",
            "needs_browser_bypass": getattr(cls, "needs_browser_bypass", False),
            "status": "active",
            "class": cls,
        }
    raise ValueError(f"Nguồn '{source_id}' không tồn tại trong registry")


def get_all_sources_metadata() -> List[Dict[str, Any]]:
    """Trả về danh sách metadata của tất cả nguồn truyện được đăng ký."""
    return [get_source_metadata(s_id) for s_id in _SOURCE_REGISTRY.keys()]


def register_source(source_cls: Type[BaseMangaSource]) -> None:
    """Đăng ký một MangaSource mới vào registry."""
    if not issubclass(source_cls, BaseMangaSource):
        raise TypeError(f"Class {source_cls} phải kế thừa từ BaseMangaSource")
    _SOURCE_REGISTRY[source_cls.source_id] = source_cls


def get_source(source_id: str, **kwargs) -> BaseMangaSource:
    """
    Factory function khởi tạo connector theo source_id.

    Args:
        source_id: Định danh nguồn ('mangadex', 'cuutruyen', ...)
        **kwargs: Tham số tùy chọn truyền vào constructor của source.

    Returns:
        Instance của BaseMangaSource tương ứng.

    Raises:
        ValueError: Nếu source_id không tồn tại trong registry.
    """
    clean_id = source_id.strip().lower()
    if clean_id not in _SOURCE_REGISTRY:
        available = ", ".join(_SOURCE_REGISTRY.keys())
        raise ValueError(
            f"Nguồn manga '{source_id}' không hợp lệ. Các nguồn hỗ trợ hiện tại: {available}"
        )
    return _SOURCE_REGISTRY[clean_id](**kwargs)


def list_sources() -> List[str]:
    """Trả về danh sách các source_id hiện đang được hỗ trợ."""
    return list(_SOURCE_REGISTRY.keys())


__all__ = [
    "BaseMangaSource",
    "MangaDexSource",
    "CuutruyenSource",
    "ComixSource",
    "CloudflareBypassRunner",
    "bypass_url",
    "bypass_comix_waf",
    "run_bypass_sync",
    "get_source",
    "list_sources",
    "register_source",
    "AVAILABLE_SOURCES",
    "get_source_metadata",
    "get_all_sources_metadata",
]
