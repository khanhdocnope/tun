"""
Manga Source Connectors & WAF Bypass Module cho MoeJect.
Cung cấp các lớp giao tiếp chuẩn hóa với MangaDex, Cứu Truyện và các nguồn mở rộng.
"""

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Type

from src.api.base import BaseMangaSource
from src.api.browser_runner import (
    CloudflareBypassRunner,
    bypass_comix_waf,
    bypass_url,
    run_bypass_sync,
)
from src.api.comix import ComixSource
from src.api.cuutruyen import CuutruyenSource
from src.api.hitomi import HitomiSource
from src.api.mangadex import MangaDexSource
from src.api.templates.madara import MadaraSource
from src.api.templates.mangastream import MangaStreamSource
from src.api.templates.mojoportal import MojoPortalSource
from src.utils.dns import enable_smart_dns

logger = logging.getLogger(__name__)

# Tự động kích hoạt Smart DNS chống chặn ISP khi nạp tầng API
enable_smart_dns()

# Bảng đăng ký các nguồn truyện Tier 1 tuyển chọn & xác thực cao cấp
_SOURCE_REGISTRY: Dict[str, Type[BaseMangaSource]] = {
    MangaDexSource.source_id: MangaDexSource,
    CuutruyenSource.source_id: CuutruyenSource,
    ComixSource.source_id: ComixSource,
    HitomiSource.source_id: HitomiSource,
    "nettruyen": MojoPortalSource,
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
    "hitomi": {
        "id": "hitomi",
        "name": "Hitomi.la",
        "url": "https://hitomi.la",
        "languages": ["vi", "en", "ja", "ko", "zh"],
        "description": "Kho Doujinshi/Manga lớn (Bẻ khóa giải thuật CDN gg.js & binary index .nozomi).",
        "needs_browser_bypass": False,
        "status": "active",
        "class": HitomiSource,
    },
    "cuutruyen": {
        "id": "cuutruyen",
        "name": "Cuutruyen",
        "url": "https://cuutruyen.net",
        "languages": ["vi"],
        "description": "Cổng truyện tranh Tiếng Việt chất lượng cao (Tự động giải mã DRM Scramble số Pi).",
        "needs_browser_bypass": False,
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
    "nettruyen": {
        "id": "nettruyen",
        "name": "NetTruyen",
        "url": "https://www.nettruyenus.com",
        "languages": ["vi"],
        "description": "Kho truyện tranh Tiếng Việt khổng lồ bóc tách theo chuẩn MojoPortal Comic.",
        "needs_browser_bypass": False,
        "status": "active",
        "class": MojoPortalSource,
    },
}
AVAILABLE_SOURCES = SOURCE_METADATA

# Cache nạp Catalog 1,312 nguồn truyện từ HakuNeko (Lazy Loaded)
_CATALOG_CACHE: Optional[Dict[str, Dict[str, Any]]] = None


def _load_sources_catalog() -> Dict[str, Dict[str, Any]]:
    """Đọc file sources_catalog.json (350KB) vào bộ nhớ một lần duy nhất."""
    global _CATALOG_CACHE
    if _CATALOG_CACHE is not None:
        return _CATALOG_CACHE

    catalog_file = Path(__file__).parent / "data" / "sources_catalog.json"
    if not catalog_file.exists():
        _CATALOG_CACHE = {}
        return _CATALOG_CACHE

    try:
        data = json.loads(catalog_file.read_text(encoding="utf-8"))
        _CATALOG_CACHE = {item["id"]: item for item in data.get("sources", [])}
    except Exception as e:
        logger.warning(f"Lỗi đọc catalog sources: {e}")
        _CATALOG_CACHE = {}

    return _CATALOG_CACHE


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

    catalog = _load_sources_catalog()
    if clean_id in catalog:
        entry = catalog[clean_id]
        return {
            "id": entry["id"],
            "name": entry["name"],
            "url": entry["url"],
            "languages": entry.get("languages", ["multi"]),
            "description": f"Nguồn mở rộng từ HakuNeko ({entry.get('template', 'Generic')})",
            "needs_browser_bypass": False,
            "status": "active",
            "template": entry.get("template", "Connector"),
        }

    raise ValueError(f"Nguồn '{source_id}' không tồn tại trong registry")


def get_all_sources_metadata(
    language: Optional[str] = None, limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Trả về danh sách metadata của các nguồn truyện đã đăng ký.
    Hỗ trợ lọc theo ngôn ngữ (vd: 'vi', 'en') hoặc giới hạn số lượng.
    """
    # Nguồn Tier 1 ưu tiên hàng đầu
    results = [get_source_metadata(s_id) for s_id in _SOURCE_REGISTRY.keys()]

    # Thêm các nguồn từ Catalog nếu cần
    catalog = _load_sources_catalog()
    for s_id, entry in catalog.items():
        if s_id in _SOURCE_REGISTRY:
            continue
        if language and language != "all":
            if language not in entry.get("languages", []):
                continue
        results.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "url": entry["url"],
                "languages": entry.get("languages", ["multi"]),
                "description": f"Kho mở rộng HakuNeko ({entry.get('template', 'Generic')})",
                "needs_browser_bypass": False,
                "status": "active",
                "template": entry.get("template", "Connector"),
            }
        )
        if limit and len(results) >= limit:
            break

    return results


def register_source(source_cls: Type[BaseMangaSource]) -> None:
    """Đăng ký một MangaSource mới vào registry."""
    if not issubclass(source_cls, BaseMangaSource):
        raise TypeError(f"Class {source_cls} phải kế thừa từ BaseMangaSource")
    _SOURCE_REGISTRY[source_cls.source_id] = source_cls


def get_source(source_id: str, **kwargs) -> BaseMangaSource:
    """
    Factory function khởi tạo connector theo source_id.
    Tự động liên kết với Template tương ứng (Madara, MangaStream, MojoPortal)
    nếu source_id nằm trong catalog 1,312 nguồn của HakuNeko.
    """
    clean_id = source_id.strip().lower()

    # 1. Kiểm tra Tier 1 đăng ký trực tiếp
    if clean_id in _SOURCE_REGISTRY:
        return _SOURCE_REGISTRY[clean_id](**kwargs)

    # 2. Kiểm tra Dynamic Catalog từ HakuNeko
    catalog = _load_sources_catalog()
    if clean_id in catalog:
        entry = catalog[clean_id]
        template = entry.get("template", "Connector")
        name = entry.get("name", clean_id)
        url = entry.get("url", "")

        if template == "WordPressMadara":
            return MadaraSource(
                source_id=clean_id, source_name=name, base_url=url, **kwargs
            )
        elif template == "WordPressMangastream":
            return MangaStreamSource(
                source_id=clean_id, source_name=name, base_url=url, **kwargs
            )
        elif template == "MojoPortalComic":
            return MojoPortalSource(
                source_id=clean_id, source_name=name, base_url=url, **kwargs
            )
        else:
            # Mặc định thử qua MadaraSource hoặc MangaStreamSource
            return MadaraSource(
                source_id=clean_id, source_name=name, base_url=url, **kwargs
            )

    available = ", ".join(list(_SOURCE_REGISTRY.keys())[:10])
    raise ValueError(
        f"Nguồn manga '{source_id}' không hợp lệ. Các nguồn hỗ trợ hiện tại: {available}..."
    )


def list_sources() -> List[str]:
    """Trả về danh sách các source_id hiện đang được hỗ trợ trực tiếp."""
    return list(_SOURCE_REGISTRY.keys())


__all__ = [
    "BaseMangaSource",
    "MangaDexSource",
    "CuutruyenSource",
    "ComixSource",
    "MojoPortalSource",
    "MadaraSource",
    "MangaStreamSource",
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
