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
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps
from pydantic import BaseModel

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
    save_img.save(buf, format="JPEG", quality=quality, subsampling=0, optimize=True)
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
    cleaned_pil.save(jpg_path, format="JPEG", quality=98, subsampling=0, optimize=True)
    cleaned_pil.save(png_path, format="PNG")

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
        cleaned_pil.convert("RGB").save(jpg_path, format="JPEG", quality=98, subsampling=0, optimize=True)
    else:
        cleaned_pil.save(jpg_path, format="JPEG", quality=98, subsampling=0, optimize=True)
    cleaned_pil.save(png_path, format="PNG")

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
            "cleanedImageBase64": pil_to_b64(cleaned_pil),
            "colorMaskBase64": pil_to_b64(color_mask_pil),
            "stats": stats,
        }
    except Exception as exc:
        logger.error("API error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


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
                                cleaned_pil.convert("RGB").save(brush_jpg, format="JPEG", quality=98, subsampling=0, optimize=True)
                            else:
                                cleaned_pil.save(brush_jpg, format="JPEG", quality=98, subsampling=0, optimize=True)
                            return cleaned_pil, brush_jpg

                        btn_brush_clean.click(
                            fn=on_brush_clean,
                            inputs=[editor_input, brush_dilation_slider, brush_inpaint_model],
                            outputs=[brush_output_image, brush_download_btn],
                        )

            # ================= TAB 3: BATCH ZIP CLEANER =================
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

            # ================= TAB 4: API GUIDE =================
            with gr.TabItem("📱 REST API Endpoints"):
                gr.Markdown(
                    """
                    ### 🔗 Hướng dẫn kết nối REST API
                    Space hỗ trợ API trực tiếp cho các công cụ dịch truyện tự động, Extension hoặc Mobile Apps:
                    * `GET /health` : Kiểm tra trạng thái máy chủ & GPU.
                    * `POST /api/clean_page` : Gửi Base64 ảnh $\\rightarrow$ Nhận Base64 ảnh sạch và Color Mask phân loại.
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
                    * `POST /api/clean_zip` : Upload file ZIP trực tiếp và nhận về file ZIP kết quả.
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
    app, local_url, share_url = demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        show_error=True,
    )

    # Attach REST API router
    if hasattr(app, "router") and hasattr(app.router, "routes"):
        try:
            for route in reversed(api_router.routes):
                app.router.routes.insert(0, route)
            logger.info("✅ Custom REST API routes attached at front of Starlette router.")
        except Exception as e:
            logger.warning("Router insertion notice: %s", e)
    elif hasattr(app, "include_router"):
        app.include_router(api_router)

    demo.block_thread()
