"""Batch helpers shared by the Gradio Space UI (single image / ZIP upload).

The FastAPI endpoints already expose every primitive; this module wraps them
into the two operations the UI actually needs: "erase one page" and "erase a
whole ZIP", with limits that keep a free CPU Space responsive.
"""

from __future__ import annotations

import io
import os
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

from app.services.inpainting.smart_erase import smart_erase
from app.services.ocr.manager import ocr_manager

SUPPORTED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
MAX_ZIP_IMAGES = int(os.getenv("UI_MAX_ZIP_IMAGES", "40"))
MAX_ZIP_BYTES = int(float(os.getenv("UI_MAX_ZIP_MB", "150")) * 1024 * 1024)
MAX_UNCOMPRESSED = MAX_ZIP_BYTES * 3
#: UI engines, in the order the dropdown shows them.
ENGINE_CHOICES = ["auto", "lama", "flat", "texture", "opencv_telea", "opencv_ns"]

ProgressFn = Optional[Callable[[int, int, str], None]]


@dataclass
class PageResult:
    name: str
    status: str
    engine: str = ""
    regions: int = 0
    elapsed_ms: float = 0.0
    error: str = ""
    output_name: str = ""
    data: bytes = b""

    def line(self) -> str:
        if self.error:
            return f"❌ `{self.name}` — {self.error}"
        if self.status == "no_text":
            return f"➖ `{self.name}` — không tìm thấy chữ (giữ nguyên ảnh)"
        return (
            f"✅ `{self.name}` — {self.regions} vùng chữ, engine `{self.engine}`, "
            f"{self.elapsed_ms / 1000:.1f}s"
        )


def decode_image(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as pil:
        return np.array(pil.convert("RGB"))


def encode_png(rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


def detect_text_boxes(
    image_bytes: bytes, direction: str = "rtl"
) -> Tuple[List[Tuple[int, int, int, int]], str]:
    """OCR boxes for the page, falling back to the contour detector.

    Returns ``(boxes, engine_name)`` in ``(x, y, w, h)`` form.  An empty list
    means "nothing found"; callers keep the page untouched instead of guessing.
    """

    for name in ("rapidocr", "contour"):
        try:
            engine = ocr_manager.get_engine(name)
            regions = engine.detect_and_recognize(
                image_bytes, reading_direction=direction
            )
        except Exception:
            continue
        boxes = [
            (int(r.box.x), int(r.box.y), int(r.box.width), int(r.box.height))
            for r in regions
            if r.box.width >= 2 and r.box.height >= 2
        ]
        if boxes:
            return boxes, name
    return [], "none"


def erase_page(
    image_bytes: bytes,
    engine: str = "auto",
    direction: str = "rtl",
    dilation: int = 5,
) -> PageResult:
    """OCR + mask + fill for a single page.  Never raises."""

    started = time.perf_counter()
    try:
        boxes, ocr_name = detect_text_boxes(image_bytes, direction)
        if not boxes:
            return PageResult(
                name="image",
                status="no_text",
                engine=ocr_name,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                data=image_bytes,
            )
        cleaned, stats = smart_erase(
            image_bytes,
            boxes,
            dilation=max(0, min(int(dilation), 12)),
            engine_name=engine,
        )
        return PageResult(
            name="image",
            status="ok",
            engine=str(stats.get("engine_used", engine)),
            regions=int(stats.get("text_boxes", len(boxes))),
            elapsed_ms=(time.perf_counter() - started) * 1000,
            data=cleaned,
        )
    except Exception as exc:  # pragma: no cover - defensive for the UI
        return PageResult(
            name="image",
            status="error",
            error=str(exc),
            elapsed_ms=(time.perf_counter() - started) * 1000,
        )


def _zip_members(archive: zipfile.ZipFile) -> List[zipfile.ZipInfo]:
    members: List[zipfile.ZipInfo] = []
    total = 0
    for info in archive.infolist():
        if info.is_dir() or info.filename.startswith("__MACOSX"):
            continue
        if info.filename.rsplit("/", 1)[-1].startswith("."):
            continue
        suffix = os.path.splitext(info.filename)[1].lower()
        if suffix not in SUPPORTED_SUFFIXES:
            continue
        total += info.file_size
        if total > MAX_UNCOMPRESSED:
            break
        members.append(info)
        if len(members) >= MAX_ZIP_IMAGES:
            break
    return members


def erase_zip(
    zip_bytes: bytes,
    engine: str = "auto",
    direction: str = "rtl",
    dilation: int = 5,
    progress: ProgressFn = None,
) -> Tuple[bytes, List[PageResult]]:
    """Erase every image inside a ZIP and return a new ZIP plus per-page results."""

    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise ValueError(
            f"ZIP quá lớn ({len(zip_bytes) / 1e6:.0f} MB > {MAX_ZIP_BYTES / 1e6:.0f} MB)"
        )
    results: List[PageResult] = []
    out_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        members = _zip_members(archive)
        if not members:
            raise ValueError("Không tìm thấy ảnh PNG/JPG/WebP nào trong ZIP")
        with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as out_zip:
            for index, info in enumerate(members):
                if progress is not None:
                    progress(index, len(members), info.filename)
                try:
                    data = archive.read(info)
                    page = erase_page(data, engine, direction, dilation)
                except Exception as exc:
                    page = PageResult(name=info.filename, status="error", error=str(exc))
                page.name = info.filename
                if page.status == "no_text":
                    page.output_name = info.filename
                    out_zip.writestr(info.filename, data)
                elif page.status == "ok":
                    stem = os.path.splitext(info.filename)[0]
                    page.output_name = f"{stem}_cleaned.png"
                    out_zip.writestr(page.output_name, page.data)
                results.append(page)
    if progress is not None:
        progress(len(members), len(members), "")
    return out_buf.getvalue(), results


def summary_markdown(results: List[PageResult]) -> str:
    if not results:
        return "Không có trang nào được xử lý."
    ok = sum(1 for r in results if r.status == "ok")
    skipped = sum(1 for r in results if r.status == "no_text")
    failed = sum(1 for r in results if r.status == "error")
    elapsed = sum(r.elapsed_ms for r in results) / 1000.0
    head = (
        f"**{len(results)} trang** · ✅ {ok} đã xoá · ➖ {skipped} không có chữ · "
        f"❌ {failed} lỗi · tổng {elapsed:.1f}s"
    )
    body = "\n".join(f"- {r.line()}" for r in results[:30])
    if len(results) > 30:
        body += f"\n- … và {len(results) - 30} trang nữa"
    return head + "\n\n" + body


def write_temp(prefix: str, suffix: str, data: bytes) -> str:
    """Persist bytes to a temp file and return the path (Gradio needs a path)."""

    directory = os.path.join(tempfile.gettempdir(), "manga-cleaner")
    os.makedirs(directory, exist_ok=True)
    handle, path = tempfile.mkstemp(prefix=prefix, suffix=suffix, dir=directory)
    with os.fdopen(handle, "wb") as fh:
        fh.write(data)
    return path
