"""
Autonomous Manga Cleaner (ZeroGPU A100 Edition).
Features:
- Smart Chat vs SFX classification (Green: Chat, Red: SFX).
- Sub-second Big-LaMa Inpainting on Hugging Face ZeroGPU.
- 2-Column Responsive UI (Input, Output, Color Mask, Stats).
- Brush Editor (ImageEditor with Proxy Canvas for RAM savings).
- Batch ZIP Archive Processing with history & download.
- Full FastAPI REST Endpoints (/health, /api/clean_page, /api/inpaint, /api/clean_zip).
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import gradio as gr
import numpy as np
import torch
from fastapi import FastAPI, APIRouter, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from core.ocr_engine import process_page_ocr
from core.translator import MangaTranslator
from download_models import ensure_models
from manga_cleaner import cleaner_pipeline

# Ensure SSR mode disabled for Gradio stability
os.environ["GRADIO_SSR_MODE"] = "false"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("manga_cleaner.app")

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_STORAGE_DIR = Path("/data/outputs") if Path("/data").is_dir() else BASE_DIR / "outputs"
OUTPUT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def natural_sort_key(s: str):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", s)]


def get_saved_zip_files() -> List[str]:
    if not OUTPUT_STORAGE_DIR.is_dir():
        return []
    try:
        files = [f.name for f in OUTPUT_STORAGE_DIR.glob("*.zip")]
        files.sort(key=lambda x: (OUTPUT_STORAGE_DIR / x).stat().st_mtime, reverse=True)
        return files
    except Exception:
        return []


def save_pil_to_jpg_bytes(pil_img: Image.Image, quality: int = 95) -> bytes:
    buf = io.BytesIO()
    if pil_img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", pil_img.size, (255, 255, 255))
        if pil_img.mode == "RGBA":
            bg.paste(pil_img, mask=pil_img.split()[-1])
        else:
            bg.paste(pil_img.convert("RGB"))
        save_img = bg
    else:
        save_img = pil_img.convert("RGB")
    save_img.save(buf, format="JPEG", quality=quality, subsampling=0)
    return buf.getvalue()


def b64_to_pil(b64_str: str) -> Image.Image:
    if not b64_str:
        raise ValueError("Empty image data.")
    b64_clean = b64_str.strip()
    if "," in b64_clean:
        b64_clean = b64_clean.split(",", 1)[1]
    b64_clean = b64_clean.replace(" ", "+").replace("\n", "").replace("\r", "")
    missing_padding = len(b64_clean) % 4
    if missing_padding:
        b64_clean += "=" * (4 - missing_padding)
    img_bytes = base64.b64decode(b64_clean)
    return ImageOps.exif_transpose(Image.open(io.BytesIO(img_bytes)))


def pil_to_b64(pil_img: Image.Image, fmt="PNG") -> str:
    buf = io.BytesIO()
    if fmt.upper() == "PNG":
        pil_img.save(buf, format=fmt, compress_level=1)  # nhanh hơn nhiều so với mức 6 mặc định, cùng định dạng PNG
    else:
        pil_img.save(buf, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def extract_editor_data(editor_data: Any) -> Tuple[Optional[Image.Image], Optional[Image.Image]]:
    if not editor_data or not isinstance(editor_data, dict):
        return None, None
    bg = editor_data.get("background")
    layers = editor_data.get("layers", [])
    if bg is None:
        return None, None
    bg_pil = Image.fromarray(bg).convert("RGB") if isinstance(bg, np.ndarray) else bg.convert("RGB")
    w, h = bg_pil.size
    combined_mask = np.zeros((h, w), dtype=np.uint8)
    has_brush = False
    if layers:
        for layer in layers:
            if layer is None:
                continue
            arr = np.array(layer)
            if len(arr.shape) == 3 and arr.shape[2] == 4:
                alpha = arr[:, :, 3]
                l_mask = (alpha > 10).astype(np.uint8) * 255
                if l_mask.shape[:2] != (h, w):
                    l_mask = cv2.resize(l_mask, (w, h), interpolation=cv2.INTER_NEAREST)
                combined_mask = np.maximum(combined_mask, l_mask)
                if combined_mask.any():
                    has_brush = True
    mask_pil = Image.fromarray(combined_mask, mode="L") if has_brush else None
    return bg_pil, mask_pil


def draw_reading_order_boxes(image: Image.Image, items: List[Dict[str, Any]]) -> Image.Image:
    """Vẽ bounding box kèm số thứ tự đọc logic (#1, #2...) trực tiếp lên ảnh."""
    img_bgr = cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    for it in items:
        idx = it.get("id", 1)
        ymin, xmin, ymax, xmax = it.get("bbox") or it.get("box", [0, 0, 0, 0])
        # Vẽ khung màu cam nổi bật quanh bóng thoại
        cv2.rectangle(img_bgr, (xmin, ymin), (xmax, ymax), (0, 140, 255), 2)
        # Vẽ thẻ số thứ tự đọc
        label = f"#{idx}"
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        badge_top = max(0, ymin - h - 8)
        cv2.rectangle(img_bgr, (xmin, badge_top), (xmin + w + 10, ymin), (0, 140, 255), -1)
        cv2.putText(img_bgr, label, (xmin + 5, ymin - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))


INPAINT_MODEL_CHOICES = [
    ("🌸 Anime-Manga LaMa (Tốt nhất cho Manga B&W, trame, nét vẽ)", "anime-lama"),
    ("🎨 Big-LaMa Standard (Tốt nhất cho Manhwa / Webtoon màu)", "big-lama"),
    ("⚡ OpenCV Telea (Siêu tốc độ, CPU FMM)", "opencv-telea"),
    ("💧 OpenCV Navier-Stokes (Mượt mà, CPU PDE)", "opencv-ns"),
]


def render_box_canvas_html(pil_img: Optional[Image.Image]) -> str:
    if pil_img is None:
        return """
        <div style="border: 2px dashed #4b5563; border-radius: 8px; padding: 48px 20px; text-align: center; color: #9ca3af; background: #111827;">
            <p style="font-size: 18px; margin-bottom: 8px;">📥 <strong>Chưa có ảnh để khoanh vùng</strong></p>
            <p style="font-size: 14px;">Vui lòng tải ảnh lên ở <strong>Bước 1 (cột bên trái)</strong> trước. Sau đó bạn có thể kéo chuột khoanh vùng trực tiếp trên ảnh!</p>
        </div>
        """
    b64_url = pil_to_b64(pil_img, fmt="PNG")
    w, h = pil_img.size
    return f"""
    <div id="manga_box_tool_wrapper" style="font-family: inherit; user-select: none;">
        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
            <button id="btn_undo_box" type="button" style="padding: 6px 14px; background: #374151; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">↩️ Hoàn tác box (Undo)</button>
            <button id="btn_clear_box" type="button" style="padding: 6px 14px; background: #4b5563; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;">🗑️ Xóa hết box (Clear)</button>
            <span id="box_counter_badge" style="padding: 4px 12px; background: #064e3b; color: #34d399; font-weight: 700; border-radius: 6px; font-size: 13px;">Đã khoanh: 0 vùng</span>
            <span style="font-size: 12px; color: #9ca3af;">(💡 Nhấn & kéo chuột tạo khung chữ nhật quanh chữ. Giữ Shift hoặc kéo tiếp để thêm nhiều vùng)</span>
        </div>
        <div id="canvas_scroll_area" style="position: relative; overflow: auto; max-height: 650px; border: 2px solid #374151; border-radius: 8px; background: #0b0f19; text-align: center;">
            <canvas id="manga_interactive_canvas" width="{w}" height="{h}" style="max-width: 100%; height: auto; cursor: crosshair; display: inline-block; vertical-align: middle;"></canvas>
        </div>
        <img src="{b64_url}" style="display:none;" onload="(function(imgEl){{
            const canvas = document.getElementById('manga_interactive_canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            window.__manga_boxes = [];
            let isDrawing = false;
            let startX = 0, startY = 0;
            let currentX = 0, currentY = 0;

            function syncWithGradio() {{
                const hiddenInput = document.querySelector('#hidden_box_json textarea') || document.querySelector('#hidden_box_json input');
                if (hiddenInput) {{
                    hiddenInput.value = JSON.stringify(window.__manga_boxes);
                    hiddenInput.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    hiddenInput.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                const badge = document.getElementById('box_counter_badge');
                if (badge) {{
                    badge.innerText = 'Đã khoanh: ' + window.__manga_boxes.length + ' vùng';
                    badge.style.background = window.__manga_boxes.length > 0 ? '#065f46' : '#1f2937';
                }}
            }}

            function redraw() {{
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(imgEl, 0, 0);

                window.__manga_boxes.forEach((b, idx) => {{
                    const bx = b[0], by = b[1], bw = b[2] - b[0], bh = b[3] - b[1];
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
                    ctx.fillRect(bx, by, bw, bh);

                    ctx.strokeStyle = '#06b6d4';
                    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 500));
                    ctx.setLineDash([8, 4]);
                    ctx.strokeRect(bx, by, bw, bh);

                    ctx.fillStyle = '#0891b2';
                    ctx.fillRect(bx, by, 28, 20);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.setLineDash([]);
                    ctx.fillText('#' + (idx + 1), bx + 4, by + 14);
                }});

                if (isDrawing) {{
                    const minX = Math.min(startX, currentX);
                    const minY = Math.min(startY, currentY);
                    const bw = Math.abs(currentX - startX);
                    const bh = Math.abs(currentY - startY);

                    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
                    ctx.fillRect(minX, minY, bw, bh);

                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 500));
                    ctx.setLineDash([6, 3]);
                    ctx.strokeRect(minX, minY, bw, bh);
                    ctx.setLineDash([]);
                }}
            }}

            redraw();
            syncWithGradio();

            function getCanvasPos(e) {{
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return [
                    Math.round((clientX - rect.left) * scaleX),
                    Math.round((clientY - rect.top) * scaleY)
                ];
            }}

            canvas.onmousedown = function(e) {{
                isDrawing = true;
                const [x, y] = getCanvasPos(e);
                startX = x; startY = y;
                currentX = x; currentY = y;
            }};

            canvas.onmousemove = function(e) {{
                if (!isDrawing) return;
                const [x, y] = getCanvasPos(e);
                currentX = x; currentY = y;
                redraw();
            }};

            window.onmouseup = function(e) {{
                if (!isDrawing) return;
                isDrawing = false;
                const x1 = Math.max(0, Math.min(startX, currentX));
                const y1 = Math.max(0, Math.min(startY, currentY));
                const x2 = Math.min(canvas.width, Math.max(startX, currentX));
                const y2 = Math.min(canvas.height, Math.max(startY, currentY));

                if ((x2 - x1) > 6 && (y2 - y1) > 6) {{
                    window.__manga_boxes.push([x1, y1, x2, y2]);
                }}
                redraw();
                syncWithGradio();
            }};

            const undoBtn = document.getElementById('btn_undo_box');
            if (undoBtn) {{
                undoBtn.onclick = function() {{
                    window.__manga_boxes.pop();
                    redraw();
                    syncWithGradio();
                }};
            }}

            const clearBtn = document.getElementById('btn_clear_box');
            if (clearBtn) {{
                clearBtn.onclick = function() {{
                    window.__manga_boxes = [];
                    redraw();
                    syncWithGradio();
                }};
            }}
        }})(this)" />
    </div>
    """


def process_manga_box_selection(
    image: Optional[Image.Image],
    boxes_json: str,
    clean_mode: str,
    dilation_px: int,
    inpaint_model: str,
    compute_mode: str = "auto",
) -> Tuple[Optional[Image.Image], Optional[Image.Image], Dict[str, Any], Optional[str], Optional[str]]:
    if image is None:
        raise gr.Error("Vui lòng tải ảnh lên ở Bước 1!")
    if not boxes_json or not boxes_json.strip() or boxes_json == "[]":
        raise gr.Error("Vui lòng khoanh ít nhất 1 vùng chữ trên ảnh trước khi bấm xóa!")
    try:
        boxes = json.loads(boxes_json)
    except Exception:
        boxes = []
    if not boxes:
        raise gr.Error("Chưa có vùng nào được khoanh. Vui lòng kéo chuột tạo khung chữ nhật quanh chữ!")

    img_pil = ImageOps.exif_transpose(image).convert("RGB")
    w, h = img_pil.size
    img_rgb = np.array(img_pil)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    user_mask = np.zeros((h, w), dtype=np.uint8)

    if clean_mode == "ai_text":
        # AI guided text extraction inside user's boxes (preserves bubble frame 100%)
        seg = cleaner_pipeline.ctd.seg_map(img_bgr)
        seg_bin = (seg > 0.18).astype(np.uint8) * 255
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

        for b in boxes:
            x1, y1, x2, y2 = max(0, int(b[0])), max(0, int(b[1])), min(w, int(b[2])), min(h, int(b[3]))
            if x2 <= x1 or y2 <= y1:
                continue
            box_seg = seg_bin[y1:y2, x1:x2]
            if box_seg.any():
                user_mask[y1:y2, x1:x2] = box_seg
            else:
                # Fallback: dark ink inside box
                sub_gray = gray[y1:y2, x1:x2]
                user_mask[y1:y2, x1:x2] = (sub_gray < 225).astype(np.uint8) * 255
    else:
        # Full rectangular box fill
        for b in boxes:
            x1, y1, x2, y2 = max(0, int(b[0])), max(0, int(b[1])), min(w, int(b[2])), min(h, int(b[3]))
            if x2 <= x1 or y2 <= y1:
                continue
            user_mask[y1:y2, x1:x2] = 255

    cleaned_pil, color_mask_pil, stats = cleaner_pipeline.clean_image(
        image_input=img_pil,
        user_mask=Image.fromarray(user_mask, mode="L"),
        dilation_px=int(dilation_px),
        inpaint_model=inpaint_model,
        force_cpu=("CPU" in compute_mode),
    )

    pages_dir = OUTPUT_STORAGE_DIR / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    jpg_path = str(pages_dir / f"box_cleaned_{ts}.jpg")
    png_path = str(pages_dir / f"box_cleaned_{ts}.png")
    cleaned_pil.save(jpg_path, format="JPEG", quality=98, subsampling=0)
    cleaned_pil.save(png_path, format="PNG", compress_level=1)

    stats["total_boxes"] = len(boxes)
    stats["clean_mode"] = "AI bóc tách chữ trong box (giữ viền)" if clean_mode == "ai_text" else "Xóa trọn vẹn toàn bộ lòng box"

    return cleaned_pil, color_mask_pil, stats, jpg_path, png_path


# --------------------------------------------------------------------------------------
# Core Execution Handlers for Gradio
# --------------------------------------------------------------------------------------
def process_manga_auto(
    image: Optional[np.ndarray | Image.Image],
    clean_sfx: bool,
    dilation_strength: int,
    det_threshold: float,
    compute_mode: str,
    inpaint_model: str = "anime-lama",
) -> Tuple[Optional[Image.Image], Optional[Image.Image], str, Dict[str, Any], Optional[str], Optional[str]]:
    """
    Main 2-column Auto-clean handler:
    Detects Chat vs SFX, renders color mask, executes inpainting, and prepares direct JPG/PNG downloads.
    """
    if image is None:
        return None, None, "0.0 ms | Vui lòng tải ảnh lên", {"error": "Chưa tải ảnh"}, None, None

    start_time = time.perf_counter()
    force_cpu = "CPU" in compute_mode

    cleaned_pil, color_mask_pil, stats = cleaner_pipeline.clean_image(
        image_input=image,
        clean_sfx=clean_sfx,
        dilation_px=int(dilation_strength),
        det_threshold=float(det_threshold),
        force_cpu=force_cpu,
        inpaint_model=inpaint_model,
    )

    elapsed_ms = (time.perf_counter() - start_time) * 1000.0
    stats["total_time_ms"] = round(elapsed_ms, 1)
    time_badge = f"{elapsed_ms:.1f} ms | {stats.get('engine', 'N/A')}"

    # Save original quality JPG (quality=98) & lossless PNG for direct download button (avoids browser webp)
    pages_dir = OUTPUT_STORAGE_DIR / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    jpg_path = str(pages_dir / f"cleaned_manga_{ts}.jpg")
    png_path = str(pages_dir / f"cleaned_manga_{ts}.png")
    if cleaned_pil.mode in ("RGBA", "LA", "P"):
        cleaned_pil.convert("RGB").save(jpg_path, format="JPEG", quality=98, subsampling=0)
    else:
        cleaned_pil.save(jpg_path, format="JPEG", quality=98, subsampling=0)
    cleaned_pil.save(png_path, format="PNG", compress_level=1)

    return cleaned_pil, color_mask_pil, time_badge, stats, jpg_path, png_path


def process_manga_zip(
    zip_file: Any,
    clean_sfx: bool = False,
    dilation_val: int = 4,
    det_thresh_val: float = 0.20,
    jpg_quality: int = 95,
    device_mode: str = "auto",
    inpaint_model: str = "anime-lama",
    progress=gr.Progress(track_tqdm=True),
) -> Tuple[Optional[str], Dict[str, Any], Any]:
    if zip_file is None:
        raise gr.Error("Vui lòng tải lên một tệp .zip!")

    zip_path = Path(zip_file.name if hasattr(zip_file, "name") else str(zip_file))
    if not zip_path.is_file():
        raise gr.Error("Không tìm thấy tệp .zip!")

    valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".jfif"}
    in_name = zip_path.stem
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_zip_name = f"cleaned_{in_name}_{timestamp}.zip"
    out_zip_path = OUTPUT_STORAGE_DIR / out_zip_name

    start_time = time.time()
    processed_count = 0

    with zipfile.ZipFile(str(zip_path), "r") as in_zip:
        file_list = [
            f for f in in_zip.namelist() if not f.startswith("__MACOSX/") and not Path(f).name.startswith(".")
        ]
        image_files = [f for f in file_list if Path(f).suffix.lower() in valid_exts]

        if not image_files:
            raise gr.Error("Không tìm thấy tệp ảnh hợp lệ (.png, .jpg) trong file ZIP!")

        image_files.sort(key=natural_sort_key)
        total = len(image_files)

        with zipfile.ZipFile(str(out_zip_path), "w", compression=zipfile.ZIP_DEFLATED) as out_zip:
            for idx, img_rel in enumerate(image_files):
                progress((idx + 0.1) / total, desc=f"Đang xử lý trang {idx + 1}/{total}: {Path(img_rel).name}")
                try:
                    raw_data = in_zip.read(img_rel)
                    img_pil = Image.open(io.BytesIO(raw_data))

                    cleaned_pil, _, _ = cleaner_pipeline.clean_image(
                        image_input=img_pil,
                        clean_sfx=clean_sfx,
                        dilation_px=dilation_val,
                        det_threshold=det_thresh_val,
                        force_cpu=(device_mode == "cpu"),
                        inpaint_model=inpaint_model,
                    )

                    jpg_bytes = save_pil_to_jpg_bytes(cleaned_pil, quality=jpg_quality)
                    base_stem = Path(img_rel).stem
                    out_entry = str(Path(img_rel).parent / f"{base_stem}_clean.jpg").replace("\\", "/")
                    out_zip.writestr(out_entry, jpg_bytes)
                    processed_count += 1
                except Exception as exc:
                    logger.error("Lỗi trang %s: %s", img_rel, exc)

    total_s = round(time.time() - start_time, 2)
    stats = {
        "status": "success",
        "total_pages": processed_count,
        "clean_sfx": clean_sfx,
        "inpaint_model": inpaint_model,
        "output_zip": out_zip_name,
        "size_mb": round(out_zip_path.stat().st_size / (1024 * 1024), 2),
        "total_time_seconds": f"{total_s}s",
        "avg_speed": f"{round(total_s / max(1, processed_count), 2)}s/trang",
    }
    progress(1.0, desc="✅ Hoàn tất toàn bộ tệp ZIP!")
    dropdown_update = gr.update(choices=get_saved_zip_files(), value=out_zip_name)
    return str(out_zip_path), stats, dropdown_update


# --------------------------------------------------------------------------------------
# REST API Endpoints
# --------------------------------------------------------------------------------------
api_router = APIRouter()


class CleanPagePayload(BaseModel):
    imageBase64: str
    cleanSFX: Optional[bool] = False
    dilationPx: Optional[int] = 4
    detThreshold: Optional[float] = 0.20
    inpaintModel: Optional[str] = "anime-lama"


@api_router.get("/health")
@api_router.get("/api/v1/health")
def health():
    return {
        "status": "online",
        "device": "ZeroGPU (Nvidia A100)" if torch.cuda.is_available() else "CPU",
        "detector_ready": cleaner_pipeline.detector.ready,
        "available_models": ["anime-lama", "big-lama", "opencv-telea", "opencv-ns"],
        "features": ["Chat vs SFX classification", "Multi-model Inpainting", "Color Mask (Green/Red)"],
    }


@api_router.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(openapi_url="/openapi.json", title="⚡ Manga Cleaner & Translation API - Swagger Docs")


@api_router.get("/redoc", include_in_schema=False)
async def custom_redoc_html():
    return get_redoc_html(openapi_url="/openapi.json", title="⚡ Manga Cleaner & Translation API - ReDoc")


@api_router.get("/openapi.json", include_in_schema=False)
async def get_open_api_endpoint():
    return get_openapi(
        title="⚡ Manga Cleaner & Translation API",
        version="2.0.0",
        description="Backend API đa chế độ cho Manga/Manhwa: OCR, Comic-Text-Detection, Inpainting & DeepSeek Translation.",
        routes=api_router.routes,
    )


@api_router.post("/clean_page")
@api_router.post("/api/clean_page")
async def api_clean_page(req: CleanPagePayload):
    try:
        img_pil = b64_to_pil(req.imageBase64)
        cleaned_pil, color_mask_pil, stats = await run_in_threadpool(
            cleaner_pipeline.clean_image,
            image_input=img_pil,
            clean_sfx=bool(req.cleanSFX),
            dilation_px=int(req.dilationPx or 4),
            det_threshold=float(req.detThreshold or 0.20),
            inpaint_model=str(req.inpaintModel or "anime-lama"),
        )
        return {
            "success": True,
            "cleanedImageBase64": await run_in_threadpool(pil_to_b64, cleaned_pil),
            "colorMaskBase64": await run_in_threadpool(pil_to_b64, color_mask_pil),
            "stats": stats,
        }
    except Exception as exc:
        logger.error("API error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


class TextItemResponse(BaseModel):
    id: int = Field(..., description="Mã định danh thứ tự logic")
    box: List[int] = Field(..., description="Tọa độ khung [ymin, xmin, ymax, xmax]")
    original_text: str = Field(..., description="Văn bản gốc nhận diện từ OCR")
    translated_text: str = Field(..., description="Bản dịch từ DeepSeek LLM")


class TranslatePageResponse(BaseModel):
    total_boxes: int = Field(..., description="Tổng số khối văn bản tìm thấy")
    reading_order: str = Field(..., description="Thứ tự đọc ('manga' hoặc 'webtoon')")
    ocr_engine: str = Field(..., description="Công cụ OCR ('ja_manga' hoặc 'multilingual')")
    data: List[TextItemResponse] = Field(..., description="Danh sách khối văn bản kèm bản dịch")
    execution_time_ms: float = Field(..., description="Thời gian thực thi (ms)")


@api_router.post(
    "/api/v1/translate-page",
    response_model=TranslatePageResponse,
    tags=["Translation & OCR"],
    summary="Dịch toàn bộ trang truyện tranh (OCR + Reading Order + Context LLM)",
    description=(
        "Nhận diện văn bản bằng Comic-Text-Detector, sắp xếp thứ tự đọc thông minh (manga RTL / webtoon TTB), "
        "thực hiện OCR theo cơ chế Lazy A/B (ja_manga hoặc multilingual) và gửi toàn bộ ngữ cảnh trang truyện sang "
        "DeepSeek LLM để dịch thuật chuẩn xác nhất."
    ),
)
async def api_translate_page(
    file: UploadFile = File(..., description="Tệp ảnh trang truyện cần dịch (JPG, PNG, WebP)"),
    reading_order: str = Form("manga", description="Thứ tự đọc: 'manga' (phải qua trái) hoặc 'webtoon' (trên xuống dưới)"),
    ocr_engine: str = Form("ja_manga", description="Cơ chế OCR: 'ja_manga' (manga-ocr) hoặc 'multilingual' (PaddleOCR)"),
    source_lang: Optional[str] = Form("ch", description="Ngôn ngữ nguồn nếu chọn multilingual (vd: 'ch', 'korean', 'en', 'japan')"),
    chat_only: bool = Form(True, description="Chỉ nhận diện & dịch chữ trong bong bóng chat (bỏ SFX vẽ tay)"),
    api_key: Optional[str] = Form(None, description="DeepSeek / OpenAI API Key (tùy chọn, mặc định đọc từ ENV DEEPSEEK_API_KEY)"),
    target_lang: str = Form("vi", description="Ngôn ngữ đích (mặc định: 'vi' hoặc 'Vietnamese')"),
    det_threshold: Optional[float] = Form(0.20, description="Ngưỡng phát hiện khung thoại (0.1 - 0.5)"),
    ocr_only: bool = Form(False, description="Chỉ OCR và bóc tách bóng thoại, không gọi LLM"),
):
    start_t = time.perf_counter()
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Tệp ảnh tải lên rỗng.")
        img_pil = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không thể đọc file ảnh: {exc}")

    engine_val = "ja_manga" if ocr_engine.lower() in ("ja", "ja_manga") else "multilingual"
    order_val = "webtoon" if reading_order.lower() in ("webtoon", "manhwa") else "manga"

    try:
        # Bước 1 & 2: Phát hiện text box & chạy Lazy OCR theo Reading Order (có hỗ trợ chat_only)
        total_boxes, ocr_items = await run_in_threadpool(
            process_page_ocr,
            image=img_pil,
            ocr_engine=engine_val,
            reading_order=order_val,
            source_lang=source_lang or "ch",
            det_threshold=float(det_threshold or 0.20),
            chat_only=bool(chat_only),
        )

        # Bước 3: Dịch ngữ cảnh nếu không phải ocr_only và có api_key
        if ocr_only or not api_key:
            final_items = ocr_items
        else:
            translator = MangaTranslator(api_key=api_key)
            final_items = await translator.translate_page(
                items=ocr_items,
                target_lang=target_lang,
                api_key=api_key,
            )

        elapsed_ms = round((time.perf_counter() - start_t) * 1000.0, 1)

        formatted_data = []
        for it in final_items:
            box_coords = it.get("bbox") or it.get("box", [0, 0, 0, 0])
            formatted_data.append({
                "id": int(it.get("id", 0)),
                "box": list(box_coords),
                "original_text": str(it.get("original_text", "")),
                "translated_text": str(it.get("translated_text", "")),
            })

        return {
            "total_boxes": total_boxes,
            "reading_order": order_val,
            "ocr_engine": engine_val,
            "data": formatted_data,
            "execution_time_ms": elapsed_ms,
        }
    except Exception as exc:
        logger.error("Lỗi khi xử lý translate-page: %s", exc)
        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý translate-page: {type(exc).__name__}: {exc}")
class TranslateDirectRequest(BaseModel):
    messages: List[Dict[str, Any]]
    model: Optional[str] = "gemini-3-flash-preview"
    base_url: Optional[str] = "https://generativelanguage.googleapis.com/v1beta/openai"
    api_key: Optional[str] = None
    temperature: Optional[float] = 0.3
    thinking: Optional[Dict[str, Any]] = None
    max_tokens: Optional[int] = 4096


@api_router.post(
    "/api/v1/translate",
    tags=["Translation & OCR"],
    summary="Proxy endpoint gọi AI Dịch (Gemini / DeepSeek / OpenAI)",
)
async def api_translate_direct(req: TranslateDirectRequest):
    active_key = (
        req.api_key
        or os.getenv("API_KEY_GEMINI")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("DEEPSEEK_API_KEY")
        or os.getenv("API_KEY")
        or ""
    ).strip()
    if not active_key:
        raise HTTPException(status_code=400, detail="Chưa cấu hình API Key.")

    active_model = req.model or "gemini-3-flash-preview"
    is_gemini = "gemini" in active_model.lower()

    default_base = "https://generativelanguage.googleapis.com/v1beta/openai" if is_gemini else "https://discovery-api.intern-ai.org.cn/v1"
    clean_base = (req.base_url or default_base).rstrip("/")
    if clean_base.endswith("/chat/completions"):
        clean_base = clean_base[:-len("/chat/completions")].rstrip("/")
    url = f"{clean_base}/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {active_key}",
    }
    payload = {
        "model": active_model,
        "messages": req.messages,
        "temperature": float(req.temperature or 0.3),
        "max_tokens": int(req.max_tokens or 4096),
    }
    if not is_gemini:
        payload["thinking"] = req.thinking if req.thinking is not None else {"type": "disabled"}

    try:
        import httpx
        async with httpx.AsyncClient(timeout=65.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"LLM API lỗi ({resp.status_code}): {resp.text}")
            resp_content = resp.text.strip() if resp.text else ""
            if not resp_content:
                raise HTTPException(status_code=502, detail="LLM API trả về phản hồi rỗng (Empty body).")
            try:
                return resp.json()
            except Exception as json_err:
                raise HTTPException(status_code=502, detail=f"LLM API trả về JSON không hợp lệ: {resp_content[:200]}")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI Dịch phản hồi quá thời gian quy định (Timeout > 65s).")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Lỗi khi proxy gọi LLM: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@api_router.post(
    "/api/v1/translate-zip",
    tags=["Translation & OCR"],
    summary="Dịch hàng loạt trang truyện từ tệp ZIP (Hỗ trợ lọc bóng thoại & xuất kịch bản)",
)
async def api_translate_zip(
    file: UploadFile = File(..., description="Tệp ZIP chứa nhiều trang truyện (.zip)"),
    reading_order: str = Form("manga", description="Thứ tự đọc ('manga' hoặc 'webtoon')"),
    ocr_engine: str = Form("ja_manga", description="Cơ chế OCR ('ja_manga' hoặc 'multilingual')"),
    source_lang: Optional[str] = Form("ch", description="Ngôn ngữ gốc nếu dùng multilingual"),
    chat_only: bool = Form(True, description="Chỉ nhận diện & dịch chữ trong bong bóng chat (bỏ SFX)"),
    api_key: Optional[str] = Form(None, description="API Key DeepSeek / OpenAI"),
    target_lang: str = Form("vi", description="Ngôn ngữ dịch đích"),
    det_threshold: Optional[float] = Form(0.20),
):
    start_t = time.perf_counter()
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Tệp ZIP tải lên rỗng.")
        zip_buf = io.BytesIO(content)
        in_zip = zipfile.ZipFile(zip_buf, "r")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không thể đọc tệp ZIP: {exc}")

    valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".jfif"}
    file_list = [f for f in in_zip.namelist() if not f.startswith("__MACOSX/") and not Path(f).name.startswith(".")]
    image_files = [f for f in file_list if Path(f).suffix.lower() in valid_exts]
    image_files.sort(key=natural_sort_key)

    if not image_files:
        raise HTTPException(status_code=400, detail="Không tìm thấy tệp ảnh hợp lệ (.jpg, .png, .webp) trong file ZIP.")

    engine_val = "ja_manga" if ocr_engine.lower() in ("ja", "ja_manga") else "multilingual"
    order_val = "webtoon" if reading_order.lower() in ("webtoon", "manhwa") else "manga"
    translator = MangaTranslator(api_key=api_key)

    pages_result = []
    total_all_boxes = 0

    for idx, img_rel in enumerate(image_files, start=1):
        try:
            raw_data = in_zip.read(img_rel)
            img_pil = Image.open(io.BytesIO(raw_data)).convert("RGB")

            total_boxes, ocr_items = await run_in_threadpool(
                process_page_ocr,
                image=img_pil,
                ocr_engine=engine_val,
                reading_order=order_val,
                source_lang=source_lang or "ch",
                det_threshold=float(det_threshold or 0.20),
                chat_only=bool(chat_only),
            )

            if total_boxes > 0:
                translated_items = await translator.translate_page(
                    items=ocr_items,
                    target_lang=target_lang,
                    api_key=api_key,
                )
            else:
                translated_items = []

            total_all_boxes += total_boxes
            page_data = []
            for it in translated_items:
                page_data.append({
                    "id": it.get("id"),
                    "box": it.get("bbox") or it.get("box", [0, 0, 0, 0]),
                    "original_text": it.get("original_text", ""),
                    "translated_text": it.get("translated_text", ""),
                })

            pages_result.append({
                "page_index": idx,
                "filename": Path(img_rel).name,
                "total_boxes": total_boxes,
                "data": page_data,
            })
        except Exception as exc:
            logger.error("Lỗi trang %s trong ZIP: %s", img_rel, exc)
            pages_result.append({
                "page_index": idx,
                "filename": Path(img_rel).name,
                "total_boxes": 0,
                "error": str(exc),
                "data": [],
            })

    elapsed_s = round(time.perf_counter() - start_t, 2)
    return {
        "status": "success",
        "total_pages": len(image_files),
        "total_dialogue_boxes": total_all_boxes,
        "chat_only": chat_only,
        "reading_order": order_val,
        "ocr_engine": engine_val,
        "execution_time_seconds": elapsed_s,
        "pages": pages_result,
    }



# --------------------------------------------------------------------------------------
# Gradio UI Layout
# --------------------------------------------------------------------------------------
CUSTOM_CSS = """
#main-container { max-width: 1400px; margin: 0 auto; }
.badge { font-weight: 600; padding: 4px 10px; border-radius: 6px; }
.action-btn { min-height: 50px !important; font-size: 16px !important; font-weight: 600 !important; }
"""


def create_ui() -> gr.Blocks:
    with gr.Blocks(title="⚡ Autonomous Manga Cleaner (ZeroGPU A100)", css=CUSTOM_CSS) as demo:
        gr.Markdown(
            """
            # ⚡ Autonomous Manga Cleaner (ZeroGPU A100)
            ### Pipeline tự động bóc tách thông minh **Chat (Bóng thoại)** & **SFX (Hiệu ứng âm thanh)** bằng ComicTextDetector & Big-LaMa Inpainting.
            * 🟢 **Màu Xanh lá:** Chữ thoại (Chat / Speech bubble) $\\rightarrow$ Luôn được làm sạch chuẩn nét.
            * 🔴 **Màu Đỏ:** Hiệu ứng âm thanh (SFX vẽ tay) $\\rightarrow$ Mặc định giữ nguyên nét vẽ tác giả (hoặc xóa sạch nếu bật tùy chọn).
            * ⚡ **Tốc độ:** Sub-second (0.2s – 1.0s) trên Nvidia A100 ZeroGPU!
            """
        )

        with gr.Tabs():
            # ================= TAB 1: AUTO CLEAN (2 CỘT CHÍNH) =================
            with gr.TabItem("⚡ Tự Động Xóa (Auto Clean - Phân loại Chat & SFX)"):
                with gr.Row():
                    # Cột trái (Input & Điều khiển)
                    with gr.Column(scale=5):
                        input_image = gr.Image(
                            type="pil",
                            label="📥 Tải lên trang truyện Manga / Manhwa",
                            sources=["upload", "clipboard"],
                        )

                        with gr.Group():
                            inpaint_model_dropdown = gr.Dropdown(
                                choices=INPAINT_MODEL_CHOICES,
                                value="anime-lama",
                                label="🎨 Mô hình xóa ảnh (Inpainting Model)",
                                info="Chọn Anime-LaMa cho Manga B&W, Big-LaMa cho Manhwa màu, hoặc OpenCV cho siêu tốc.",
                            )

                            clean_sfx_checkbox = gr.Checkbox(
                                value=False,
                                label="🔊 Xóa cả hiệu ứng âm thanh (SFX)",
                                info="Mặc định TẮT (chỉ xóa chữ thoại, giữ nguyên SFX của tác giả). Bật để xóa toàn bộ.",
                            )

                            dilation_slider = gr.Slider(
                                minimum=0,
                                maximum=50,
                                step=1,
                                value=4,
                                label="Độ mở rộng viền nét (Dilation px)",
                                info="Tăng lên 10-30+ px để bao trùm triệt để viền bóng chữ đậm nét hoặc ảnh độ phân giải cao.",
                            )

                            threshold_slider = gr.Slider(
                                minimum=0.05,
                                maximum=0.45,
                                step=0.01,
                                value=0.20,
                                label="Ngưỡng nhạy phát hiện chữ (Threshold)",
                                info="Giá trị càng nhỏ càng bắt nhạy các ký tự mờ / nét mảnh.",
                            )

                            compute_radio = gr.Radio(
                                choices=[
                                    ("⚡ Tự động (Ưu tiên ZeroGPU A100)", "auto"),
                                    ("💻 Chạy CPU RAM", "cpu"),
                                ],
                                value="auto",
                                label="Chế độ phần cứng (Compute Mode)",
                            )

                        clean_btn = gr.Button(
                            "🚀 Làm sạch trang truyện (Clean Page)",
                            variant="primary",
                            size="lg",
                            elem_classes="action-btn",
                        )

                        exec_time_box = gr.Textbox(
                            label="⏱️ Thời gian xử lý (Execution Time)",
                            value="Chưa xử lý",
                            interactive=False,
                        )

                    # Cột phải (Output & Phân tích trực quan)
                    with gr.Column(scale=7):
                        with gr.Tabs():
                            with gr.TabItem("✨ Clean Canvas (Ảnh đã làm sạch)"):
                                output_image = gr.Image(
                                    type="pil",
                                    label="Trang truyện đã làm sạch",
                                    interactive=False,
                                    format="png",
                                )
                                with gr.Row():
                                    download_jpg_btn = gr.DownloadButton(
                                        label="⬇️ Tải ảnh JPG chất lượng cao (98%)",
                                        variant="primary",
                                        elem_classes="action-btn",
                                    )
                                    download_png_btn = gr.DownloadButton(
                                        label="⬇️ Tải ảnh PNG gốc (Lossless)",
                                        variant="secondary",
                                    )

                            with gr.TabItem("🎯 Color Mask (Xanh: Chat | Đỏ: SFX)"):
                                mask_output = gr.Image(
                                    type="pil",
                                    label="Bản đồ phân tách: Xanh lá = Thoại | Đỏ = SFX | Đen = Nền giữ nguyên",
                                    interactive=False,
                                    format="png",
                                )

                            with gr.TabItem("📊 Thống kê chi tiết (Stats)"):
                                stats_output = gr.JSON(label="Thông số nhận diện & Phần cứng")

                # Ví dụ Manga mẫu
                example_files = [
                    ["examples/sample1.jpg", False, 4, 0.20, "auto", "anime-lama"],
                    ["examples/sample2.jpg", False, 4, 0.20, "auto", "anime-lama"],
                ]
                valid_examples = [ex for ex in example_files if Path(ex[0]).is_file()]
                if valid_examples:
                    gr.Examples(
                        examples=valid_examples,
                        inputs=[input_image, clean_sfx_checkbox, dilation_slider, threshold_slider, compute_radio, inpaint_model_dropdown],
                        outputs=[output_image, mask_output, exec_time_box, stats_output, download_jpg_btn, download_png_btn],
                        fn=process_manga_auto,
                        cache_examples=False,
                        label="📚 Ví dụ Manga mẫu (Click để kiểm tra ngay lập tức)",
                    )

                clean_btn.click(
                    fn=process_manga_auto,
                    inputs=[input_image, clean_sfx_checkbox, dilation_slider, threshold_slider, compute_radio, inpaint_model_dropdown],
                    outputs=[output_image, mask_output, exec_time_box, stats_output, download_jpg_btn, download_png_btn],
                    api_name="predict",
                )

            # ================= TAB 2: CHỈNH SỬA THỦ CÔNG (KHOANH VÙNG & CỌ VẼ) =================
            with gr.TabItem("🎯 Chỉnh Sửa Thủ Công (Khoanh Vùng & Cọ Vẽ)"):
                with gr.Tabs():
                    # --- Sub-tab A: Khoanh vùng chữ nhật ---
                    with gr.TabItem("📦 Khoanh Vùng Chữ Nhật (Box Marquee - Siêu Tốc & Chuẩn Xác)"):
                        with gr.Row():
                            # Cột trái: Tải ảnh & Tùy chọn
                            with gr.Column(scale=5):
                                box_upload_image = gr.Image(
                                    type="pil",
                                    label="📥 Bước 1: Tải ảnh trang truyện lên trước",
                                    sources=["upload", "clipboard"],
                                )

                                with gr.Group():
                                    box_clean_mode = gr.Radio(
                                        choices=[
                                            ("🎯 AI chỉ bóc tách chữ trong vùng (Bảo vệ 100% viền bóng)", "ai_text"),
                                            ("⬜ Xóa trắng toàn bộ lòng vùng khoanh (Clear Entire Box)", "full_box"),
                                        ],
                                        value="ai_text",
                                        label="Chế độ xử lý bên trong vùng khoanh",
                                        info="AI bóc tách sẽ giữ nguyên nét vẽ/viền bóng thoại xung quanh.",
                                    )

                                    box_inpaint_model = gr.Dropdown(
                                        choices=INPAINT_MODEL_CHOICES,
                                        value="anime-lama",
                                        label="🎨 Mô hình xóa ảnh (Inpainting Model)",
                                    )

                                    box_dilation_slider = gr.Slider(
                                        minimum=0,
                                        maximum=50,
                                        step=1,
                                        value=4,
                                        label="Độ mở rộng viền nét (Dilation px)",
                                    )

                                btn_run_box_clean = gr.Button(
                                    "🚀 AI Làm Sạch Vùng Đã Khoanh",
                                    variant="primary",
                                    size="lg",
                                    elem_classes="action-btn",
                                )

                                hidden_box_json = gr.Textbox(
                                    value="[]",
                                    elem_id="hidden_box_json",
                                    visible=False,
                                )

                            # Cột phải: Khung Canvas Khoanh Vùng & Kết quả
                            with gr.Column(scale=7):
                                box_canvas_view = gr.HTML(
                                    value=render_box_canvas_html(None),
                                    label="Khung khoanh vùng chữ nhật",
                                )

                                with gr.Tabs():
                                    with gr.TabItem("✨ Kết quả ảnh đã làm sạch"):
                                        box_result_image = gr.Image(
                                            type="pil",
                                            label="Ảnh sau khi làm sạch",
                                            interactive=False,
                                            format="png",
                                        )
                                        with gr.Row():
                                            box_download_jpg_btn = gr.DownloadButton(
                                                label="⬇️ Tải ảnh JPG chất lượng cao (98%)",
                                                variant="primary",
                                                elem_classes="action-btn",
                                            )
                                            box_download_png_btn = gr.DownloadButton(
                                                label="⬇️ Tải ảnh PNG gốc (Lossless)",
                                                variant="secondary",
                                            )

                                    with gr.TabItem("🎯 Mặt nạ vùng đã xóa"):
                                        box_mask_output = gr.Image(
                                            type="pil",
                                            label="Mặt nạ vùng inpaint",
                                            interactive=False,
                                            format="png",
                                        )

                                    with gr.TabItem("📊 Thông số (Stats)"):
                                        box_stats_output = gr.JSON(label="Thông số xử lý box")

                        box_upload_image.change(
                            fn=render_box_canvas_html,
                            inputs=[box_upload_image],
                            outputs=[box_canvas_view],
                        )

                        btn_run_box_clean.click(
                            fn=process_manga_box_selection,
                            inputs=[box_upload_image, hidden_box_json, box_clean_mode, box_dilation_slider, box_inpaint_model],
                            outputs=[box_result_image, box_mask_output, box_stats_output, box_download_jpg_btn, box_download_png_btn],
                        )

                    # --- Sub-tab B: Quẹt cọ tự do ---
                    with gr.TabItem("🖌️ Quẹt Cọ Tự Do (Freehand Brush Editor)"):
                        with gr.Row():
                            with gr.Column(scale=6):
                                editor_input = gr.ImageEditor(
                                    type="numpy",
                                    label="Khung vẽ cọ (Dùng chuột/ngón tay quẹt đỏ vùng cần xóa)",
                                    brush=gr.Brush(colors=["#ff0000"], default_color="#ff0000", default_size=20),
                                    eraser=gr.Eraser(default_size=20),
                                )
                                brush_inpaint_model = gr.Dropdown(
                                    choices=INPAINT_MODEL_CHOICES,
                                    value="anime-lama",
                                    label="Mô hình Inpainting cho cọ vẽ",
                                )
                                brush_dilation_slider = gr.Slider(0, 50, value=4, step=1, label="Dilation viền cọ (px)")
                                btn_brush_clean = gr.Button("🚀 AI Xóa Vùng Đã Quẹt", variant="primary", elem_classes="action-btn")

                            with gr.Column(scale=6):
                                brush_output_image = gr.Image(label="Kết quả phục hồi", type="pil", interactive=False, format="png")
                                brush_download_btn = gr.DownloadButton(
                                    label="⬇️ Tải ảnh đã xóa (JPG chất lượng cao)",
                                    variant="primary",
                                    elem_classes="action-btn",
                                )

                        def on_brush_clean(edit_data, dilation_val, inpaint_model_val):
                            bg_pil, mask_pil = extract_editor_data(edit_data)
                            if bg_pil is None or mask_pil is None:
                                raise gr.Error("Vui lòng tải ảnh và quẹt cọ lên vùng cần xóa!")
                            cleaned_pil, _, stats = cleaner_pipeline.clean_image(
                                image_input=bg_pil,
                                clean_sfx=True,
                                dilation_px=int(dilation_val),
                                user_mask=mask_pil,
                                inpaint_model=inpaint_model_val,
                            )
                            pages_dir = OUTPUT_STORAGE_DIR / "pages"
                            pages_dir.mkdir(parents=True, exist_ok=True)
                            ts = int(time.time() * 1000)
                            brush_jpg = str(pages_dir / f"brush_cleaned_{ts}.jpg")
                            if cleaned_pil.mode in ("RGBA", "LA", "P"):
                                cleaned_pil.convert("RGB").save(brush_jpg, format="JPEG", quality=98, subsampling=0)
                            else:
                                cleaned_pil.save(brush_jpg, format="JPEG", quality=98, subsampling=0)
                            return cleaned_pil, brush_jpg

                        btn_brush_clean.click(
                            fn=on_brush_clean,
                            inputs=[editor_input, brush_dilation_slider, brush_inpaint_model],
                            outputs=[brush_output_image, brush_download_btn],
                        )

            # ================= TAB 3: NHẬN DIỆN & OCR CHỮ (COMIC TEXT OCR) =================
            with gr.TabItem("📖 Nhận Diện & Đọc Chữ OCR Manga (Comic Text OCR)"):
                with gr.Row():
                    with gr.Column(scale=5):
                        trans_img_input = gr.Image(label="1. Tải ảnh trang truyện cần OCR chữ", type="pil")
                        with gr.Row():
                            trans_order_radio = gr.Radio(
                                choices=[("Manga (Phải -> Trái, Trên -> Dưới)", "manga"), ("Webtoon (Trên -> Dưới)", "webtoon")],
                                value="manga",
                                label="Thứ tự đọc logic",
                            )
                        with gr.Row():
                            trans_engine_radio = gr.Radio(
                                choices=[("manga-ocr (Tiếng Nhật)", "ja_manga"), ("PaddleOCR (Đa ngôn ngữ)", "multilingual")],
                                value="ja_manga",
                                label="Bộ nhận diện OCR",
                            )
                        with gr.Row():
                            trans_chat_only_chk = gr.Checkbox(value=True, label="🎯 Chỉ lấy chữ trong Bong Bóng Thoại (Bỏ qua SFX)")
                            trans_source_lang_dd = gr.Dropdown(
                                choices=[("Tiếng Trung (ch)", "ch"), ("Tiếng Hàn (korean)", "korean"), ("Tiếng Anh (en)", "en"), ("Tiếng Nhật (japan)", "japan")],
                                value="ch",
                                label="Ngôn ngữ nguồn (khi dùng PaddleOCR)",
                            )

                        trans_enable_llm_chk = gr.Checkbox(
                            value=False,
                            label="Dịch sang tiếng Việt bằng LLM DeepSeek (Tùy chọn - Mặc định TẮT để OCR siêu tốc)",
                        )

                        with gr.Accordion("⚙️ Cấu hình Dịch thuật & API Key (Chỉ dùng khi bật Dịch)", open=False):
                            trans_target_lang_txt = gr.Textbox(value="Tiếng Việt", label="Dịch sang ngôn ngữ")
                            trans_api_key_txt = gr.Textbox(
                                label="API Key",
                                type="password",
                                placeholder="sk-... (để trống nếu đã cài DEEPSEEK_API_KEY trên server)",
                            )
                            trans_base_url_txt = gr.Textbox(
                                label="Base URL",
                                value="https://discovery-api.intern-ai.org.cn/v1",
                                placeholder="https://api.deepseek.com/v1",
                            )
                            trans_model_txt = gr.Textbox(
                                label="Model Name",
                                value="deepseek-v4-flash-0731",
                                placeholder="deepseek-chat",
                            )

                        btn_run_translate = gr.Button("⚡ Bắt Đầu OCR Chữ (Nhận Diện Siêu Tốc)", variant="primary", elem_classes="action-btn")

                    with gr.Column(scale=7):
                        trans_status_md = gr.Markdown("💡 *Tải ảnh lên và bấm nút để AI tự động nhận diện khung thoại, sắp xếp thứ tự đọc và trích xuất chữ OCR ngay lập tức.*")
                        trans_annotated_img = gr.Image(label="Bản đồ thứ tự đọc (#1, #2, #3...)", type="pil", interactive=False)
                        trans_dataframe = gr.Dataframe(
                            headers=["Thứ tự", "Văn bản nhận diện (OCR)", "Bản dịch (Nếu bật LLM)"],
                            datatype=["number", "str", "str"],
                            wrap=True,
                            label="Bảng đối chiếu câu thoại chi tiết",
                        )
                        with gr.Accordion("📝 Danh sách câu thoại OCR & Tải về", open=True):
                            trans_script_md = gr.Markdown()
                            trans_download_file = gr.File(label="⬇️ Tải tệp văn bản OCR (.txt)", interactive=False)

                async def on_translate_page_ui(
                    image_in,
                    order_in,
                    engine_in,
                    chat_only_in,
                    source_lang_in,
                    enable_llm_in,
                    target_lang_in,
                    api_key_in,
                    base_url_in,
                    model_in,
                ):
                    if image_in is None:
                        raise gr.Error("Vui lòng tải ảnh trang truyện lên!")

                    start_t = time.perf_counter()
                    total_boxes, ocr_items = await run_in_threadpool(
                        process_page_ocr,
                        image=image_in,
                        ocr_engine=engine_in,
                        reading_order=order_in,
                        source_lang=source_lang_in or "ch",
                        det_threshold=0.20,
                        chat_only=bool(chat_only_in),
                    )

                    if total_boxes == 0:
                        empty_md = "⚠️ Không tìm thấy khung thoại văn bản nào trên trang truyện này."
                        return None, [], empty_md, None, empty_md

                    if enable_llm_in:
                        translator = MangaTranslator(
                            api_key=api_key_in.strip() if api_key_in else None,
                            base_url=base_url_in.strip() if base_url_in else None,
                            model=model_in.strip() if model_in else None,
                        )
                        translated_items = await translator.translate_page(
                            items=ocr_items,
                            target_lang=target_lang_in or "Tiếng Việt",
                            api_key=api_key_in.strip() if api_key_in else None,
                        )
                    else:
                        for it in ocr_items:
                            it["translated_text"] = it.get("original_text", "")
                        translated_items = ocr_items

                    elapsed_s = round(time.perf_counter() - start_t, 2)
                    annotated_pil = draw_reading_order_boxes(image_in, translated_items)

                    table_rows = []
                    md_lines = [f"### 📖 Kết quả OCR ({total_boxes} bóng thoại - {elapsed_s}s)\n"]
                    for it in translated_items:
                        i_id = it.get("id")
                        orig = it.get("original_text", "")
                        trans = it.get("translated_text", "")
                        table_rows.append([i_id, orig, trans])
                        if enable_llm_in and trans != orig:
                            md_lines.append(f"**[#{i_id}]**\n* 🔤 Gốc: `{orig}`\n* 💬 Dịch: **{trans}**\n")
                        else:
                            md_lines.append(f"**[#{i_id}]** `{orig}`\n")

                    pages_dir = OUTPUT_STORAGE_DIR / "scripts"
                    pages_dir.mkdir(parents=True, exist_ok=True)
                    ts = int(time.time() * 1000)
                    script_path = str(pages_dir / f"ocr_script_{ts}.txt")
                    with open(script_path, "w", encoding="utf-8") as f:
                        f.write(f"=== KẾT QUẢ OCR ({total_boxes} CÂU THOẠI - {elapsed_s}s) ===\n\n")
                        for it in translated_items:
                            f.write(f"#{it.get('id')} | {it.get('original_text')}\n")

                    status_msg = f"⚡ **Hoàn thành xuất sắc:** Đã nhận diện & đọc xong {total_boxes} bóng thoại OCR trong **{elapsed_s}s**!"
                    return annotated_pil, table_rows, "\n".join(md_lines), script_path, status_msg

                btn_run_translate.click(
                    fn=on_translate_page_ui,
                    inputs=[
                        trans_img_input,
                        trans_order_radio,
                        trans_engine_radio,
                        trans_chat_only_chk,
                        trans_source_lang_dd,
                        trans_enable_llm_chk,
                        trans_target_lang_txt,
                        trans_api_key_txt,
                        trans_base_url_txt,
                        trans_model_txt,
                    ],
                    outputs=[
                        trans_annotated_img,
                        trans_dataframe,
                        trans_script_md,
                        trans_download_file,
                        trans_status_md,
                    ],
                )

            # ================= TAB 4: BATCH ZIP CLEANER =================
            with gr.TabItem("📦 Xử Lý Hàng Loạt Tệp ZIP (Batch ZIP)"):
                with gr.Row():
                    with gr.Column(scale=5):
                        zip_file_input = gr.File(label="Tải lên tệp .ZIP chứa nhiều trang truyện", file_types=[".zip"])
                        zip_inpaint_model = gr.Dropdown(
                            choices=INPAINT_MODEL_CHOICES,
                            value="anime-lama",
                            label="Mô hình Inpainting cho toàn bộ ZIP",
                        )
                        zip_sfx_chk = gr.Checkbox(value=False, label="Xóa cả SFX cho toàn bộ tệp ZIP")
                        zip_dilation_sl = gr.Slider(0, 50, value=4, step=1, label="Dilation (px)")
                        btn_run_zip = gr.Button("🚀 Bắt Đầu Xử Lý Toàn Bộ Tệp ZIP", variant="primary", elem_classes="action-btn")

                    with gr.Column(scale=7):
                        zip_file_output = gr.File(label="Tệp ZIP kết quả", interactive=False)
                        zip_stats_output = gr.JSON(label="Thống kê tệp ZIP")
                        with gr.Accordion("📂 Lịch sử tệp ZIP đã lưu trên Server", open=True):
                            saved_dropdown = gr.Dropdown(
                                choices=get_saved_zip_files(),
                                value=get_saved_zip_files()[0] if get_saved_zip_files() else None,
                                label="Danh sách ZIP trên server",
                            )
                            btn_download_saved = gr.Button("⬇️ Tải lại tệp đã chọn", variant="secondary")

                btn_run_zip.click(
                    fn=process_manga_zip,
                    inputs=[zip_file_input, zip_sfx_chk, zip_dilation_sl, gr.Number(value=0.20, visible=False), gr.Number(value=95, visible=False), gr.Textbox(value="auto", visible=False), zip_inpaint_model],
                    outputs=[zip_file_output, zip_stats_output, saved_dropdown],
                )

                def on_get_saved(fn):
                    if not fn:
                        raise gr.Error("Vui lòng chọn tệp ZIP!")
                    p = OUTPUT_STORAGE_DIR / fn
                    if not p.is_file():
                        raise gr.Error("Tệp không còn trên server!")
                    return str(p)

                btn_download_saved.click(
                    fn=on_get_saved,
                    inputs=[saved_dropdown],
                    outputs=[zip_file_output],
                )

            # ================= TAB 5: API GUIDE =================
            with gr.TabItem("📱 REST API Endpoints"):
                gr.Markdown(
                    """
                    ### 🔗 Hướng dẫn kết nối REST API & Swagger UI
                    Hệ thống cung cấp đầy đủ tài liệu tương tác Swagger UI tại: **`/docs`** (hoặc Redoc tại **`/redoc`**).

                    #### 1. Pipeline Dịch Thuật Toàn Trang (Mới)
                    * **`POST /api/v1/translate-page`** (Multipart/Form-data):
                      - Tự động nhận diện Bounding Box bằng Comic-Text-Detector (ONNX).
                      - Sắp xếp thứ tự đọc thông minh: `reading_order="manga"` (Phải qua Trái, Trên xuống Dưới) hoặc `"webtoon"` (Trên xuống Dưới).
                      - Lazy OCR A/B: `ocr_engine="ja_manga"` (manga-ocr chuyên Nhật) hoặc `"multilingual"` (PaddleOCR hỗ trợ Trung, Hàn, Anh).
                      - Dịch toàn bộ ngữ cảnh trang bằng DeepSeek LLM theo giao thức OpenAI.
                      - Trả về JSON chuẩn kèm danh sách tọa độ Box, text gốc và text dịch.

                    #### 2. Pipeline Làm Sạch & Inpainting Manga
                    * **`GET /health`** hoặc **`GET /api/v1/health`**: Kiểm tra trạng thái máy chủ & GPU.
                    * **`POST /api/clean_page`**: Gửi Base64 ảnh $\\rightarrow$ Nhận Base64 ảnh sạch và Color Mask phân loại Chat (Xanh) vs SFX (Đỏ).
                      ```json
                      {
                        "imageBase64": "data:image/jpeg;base64,...",
                        "cleanSFX": false,
                        "dilationPx": 4,
                        "detThreshold": 0.20,
                        "inpaintModel": "anime-lama"
                      }
                      ```
                    * `inpaintModel` hỗ trợ: `"anime-lama"`, `"big-lama"`, `"opencv-telea"`, `"opencv-ns"`.
                    * **`POST /api/clean_zip`**: Upload tệp ZIP nhiều trang $\\rightarrow$ Server tự động làm sạch và trả về tệp ZIP hoàn chỉnh.
                    """
                )

    demo.queue(max_size=32, default_concurrency_limit=2)
    return demo


demo = create_ui()

if __name__ == "__main__":
    logger.info("🚀 Ensuring models at boot...")
    try:
        ensure_models()
        logger.info("✅ Models verified successfully!")
    except Exception as e:
        logger.warning("Model download check warning: %s", e)

    port = int(os.environ.get("PORT", 7860))
    logger.info("🚀 Starting Manga Cleaner & Translation Server on port %d...", port)

    # Khởi chạy Gradio Server chuẩn theo cơ chế quản lý lifecycle của Hugging Face Gradio SDK
    app, local_url, share_url = demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        show_error=True,
    )

    # Gắn toàn bộ router REST API (/api/v1/translate-page, /clean_page, /health) và Swagger Docs (/docs)
    if hasattr(app, "include_router"):
        app.include_router(api_router)
    if hasattr(app, "router") and hasattr(app.router, "routes"):
        try:
            for route in reversed(api_router.routes):
                if route not in app.router.routes:
                    app.router.routes.insert(0, route)
            logger.info("✅ Custom REST API & Swagger /docs routes attached successfully.")
        except Exception as e:
            logger.warning("Router insertion notice: %s", e)

    logger.info("📖 Swagger UI Docs: http://0.0.0.0:%d/docs", port)
    logger.info("🎨 Gradio Web UI:  http://0.0.0.0:%d/", port)
    demo.block_thread()


