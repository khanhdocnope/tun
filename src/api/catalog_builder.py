"""
Công cụ trích xuất và tối ưu hóa Catalog từ 1,328 Connectors của HakuNeko.
Chuyển hóa metadata HakuNeko JS (.mjs) thành Catalog JSON chuẩn hóa siêu nhẹ (<250KB).
Giúp MoeJect tải và quản lý hơn 1,300 nguồn truyện mà không làm tốn RAM hay chậm khởi động.
"""

import json
import logging
from pathlib import Path
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CATALOG_OUTPUT_PATH = Path(__file__).parent / "data" / "sources_catalog.json"


def extract_connector_metadata(file_path: Path) -> Optional[Dict[str, Any]]:
    """
    Bóc tách ID, Name, URL, Template và Tags từ file connector .mjs của HakuNeko.
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as e:
        logger.debug(f"Không thể đọc file {file_path}: {e}")
        return None

    # 1. Tìm Base Class / Template
    inherit_match = re.search(r"export\s+default\s+class\s+\w+\s+extends\s+(\w+)", content)
    template_name = inherit_match.group(1) if inherit_match else "Connector"

    # 2. Tìm super.id hoặc this.id
    id_match = re.search(r"(?:super|this)\.id\s*=\s*['\"]([^'\"]+)['\"]", content)
    source_id = id_match.group(1) if id_match else file_path.stem.lower()

    # 3. Tìm super.label hoặc this.label
    label_match = re.search(r"(?:super|this)\.label\s*=\s*['\"]([^'\"]+)['\"]", content)
    source_name = label_match.group(1) if label_match else file_path.stem

    # 4. Tìm this.url hoặc value url
    url_match = re.search(r"this\.url\s*=\s*['\"]([^'\"]+)['\"]", content)
    if not url_match:
        url_match = re.search(r"value:\s*['\"](https?://[^'\"]+)['\"]", content)
    source_url = url_match.group(1) if url_match else ""

    # 5. Tìm tags
    tags_match = re.search(r"this\.tags\s*=\s*\[([^\]]+)\]", content)
    tags: List[str] = []
    if tags_match:
        tags_raw = tags_match.group(1)
        tags = [t.strip().strip("'\"") for t in tags_raw.split(",") if t.strip().strip("'\"")]

    # Xác định ngôn ngữ chính từ tags
    languages = []
    if "vietnamese" in tags:
        languages.append("vi")
    if "english" in tags:
        languages.append("en")
    if "japanese" in tags or "raw" in tags:
        languages.append("ja")
    if "korean" in tags:
        languages.append("ko")
    if "chinese" in tags:
        languages.append("zh")
    if "spanish" in tags:
        languages.append("es")
    if "french" in tags:
        languages.append("fr")
    if "indonesian" in tags:
        languages.append("id")
    if not languages:
        languages.append("multi")

    return {
        "id": source_id,
        "name": source_name,
        "url": source_url,
        "template": template_name,
        "languages": languages,
        "tags": tags,
    }


def build_catalog_from_hakuneko(
    hakuneko_dir: Optional[Path] = None, output_path: Optional[Path] = None
) -> Dict[str, Any]:
    """
    Quét toàn bộ thư mục connectors của HakuNeko và sinh ra file JSON Catalog hoàn chỉnh.
    """
    src_dir = hakuneko_dir or Path("temp/hakuneko/src/web/mjs/connectors")
    out_file = output_path or CATALOG_OUTPUT_PATH
    out_file.parent.mkdir(parents=True, exist_ok=True)

    if not src_dir.exists():
        logger.warning(f"Thư mục HakuNeko không tồn tại: {src_dir}")
        return {"total": 0, "sources": []}

    sources_map: Dict[str, Dict[str, Any]] = {}

    for file_p in sorted(src_dir.glob("*.mjs")):
        meta = extract_connector_metadata(file_p)
        if meta and meta["id"] and meta["url"]:
            # Tránh trùng lặp ID
            sources_map[meta["id"]] = meta

    catalog_data = {
        "total": len(sources_map),
        "templates_supported": [
            "WordPressMadara",
            "WordPressMangastream",
            "MojoPortalComic",
            "FlatManga",
            "Connector",
        ],
        "sources": list(sources_map.values()),
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(catalog_data, f, ensure_ascii=False, indent=2)

    logger.info(f"Đã lưu thành công Catalog {len(sources_map)} nguồn vào {out_file}")
    return catalog_data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    data = build_catalog_from_hakuneko()
    print(f"Tổng số nguồn bóc tách thành công: {data['total']}")
