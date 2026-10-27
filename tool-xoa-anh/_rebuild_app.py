"""Rebuild app.py from the pristine HEAD version: drop OCR/translate code, keep everything else byte-identical."""

import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
HEAD_SRC = subprocess.run(
    ["git", "show", "HEAD:tool-xoa-anh/app.py"], capture_output=True, check=True
).stdout.decode("utf-8")
pathlib.Path("_app_head_backup.py").write_text(HEAD_SRC, encoding="utf-8")


def cut(text: str, start_marker: str, end_marker: str) -> str:
    """Remove text from the line starting with `start_marker` up to (not incl.) `end_marker`."""
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    return text[:i] + text[j:]


def replace_exact(text: str, old: str, new: str) -> str:
    assert text.count(old) == 1, f"marker not unique: {old[:60]!r} -> {text.count(old)}"
    return text.replace(old, new)


s = HEAD_SRC.replace("\r\n", "\n")  # the git blob is CRLF; normalise so markers match

# ---------------------------------------------------------------- 1. header / imports
replace_exact(
    s,
    '''"""
Autonomous Manga Cleaner (ZeroGPU A100 Edition).
Features:
- Smart Chat vs SFX classification (Green: Chat, Red: SFX).
- Sub-second Big-LaMa Inpainting on Hugging Face ZeroGPU.
- 2-Column Responsive UI (Input, Output, Color Mask, Stats).
- Brush Editor (ImageEditor with Proxy Canvas for RAM savings).
- Batch ZIP Archive Processing with history & download.
- Full FastAPI REST Endpoints (/health, /api/clean_page, /api/inpaint, /api/clean_zip).
"""''',
    '''"""
Autonomous Manga Cleaner - text removal only (Hugging Face Space, Gradio SDK + ZeroGPU).

Backend API (what the external studio UI calls):
- GET  /health            service + model readiness.
- POST /clean_page        {"imageBase64", "cleanSFX", "dilationPx", "detThreshold", "inpaintModel"}
                          -> {"success", "cleanedImageBase64", "colorMaskBase64", "stats"}.
- GET  /api/benchmark     timing suite (CPU by default).
The Gradio UI is kept for manual checks, the box marquee, the brush and the ZIP batch tool.
"""''',
)

replace_exact(
    s,
    """import os
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
from fastapi.responses import FileResponse, Response, HTMLResponse
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from core.ocr_engine import process_page_ocr, detect_page_boxes
from core.translator import MangaTranslator
from download_models import ensure_models
from manga_cleaner import cleaner_pipeline""",
    """import os
import re
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import gradio as gr
import numpy as np
import torch
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.openapi.utils import get_openapi
from PIL import Image, ImageOps
from pydantic import BaseModel

from manga_cleaner import cleaner_pipeline""",
)

replace_exact(
    s,
    """OUTPUT_STORAGE_DIR = Path("/data/outputs") if Path("/data").is_dir() else BASE_DIR / "outputs"
OUTPUT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)""",
    """OUTPUT_STORAGE_DIR = Path("/data/outputs") if Path("/data").is_dir() else BASE_DIR / "outputs"
OUTPUT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# Hard limits: a single request must not be able to exhaust the Space container.
MAX_PIXELS = int(os.getenv("MAX_PIXELS", str(40_000_000)))
MAX_B64_BYTES = int(os.getenv("MAX_B64_BYTES", str(24 * 1024 * 1024)))
VALID_INPAINT_MODELS = {"anime-lama", "big-lama", "opencv-telea", "opencv-ns"}""",
)

# ---------------------------------------------------------------- 2. dead OCR helper
s = cut(s, "def draw_reading_order_boxes(", "INPAINT_MODEL_CHOICES = [")

# ---------------------------------------------------------------- 3. payloads / health / docs / benchmark page
s = cut(s, "class DetectBoxesPayload(BaseModel):", '@api_router.get("/health")')
replace_exact(
    s,
    """def health():
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
    )""",
    """def health():
    pipeline = cleaner_pipeline
    return {
        "status": "online",
        "device": "ZeroGPU (Nvidia A10G)" if torch.cuda.is_available() else "CPU",
        "detector_ready": bool(pipeline.bubbles.ready),
        "seg_ready": bool(pipeline.ctd.ready),
        "inpaint_ready": True,
        "available_models": sorted(VALID_INPAINT_MODELS),
        "limits": {"max_pixels": MAX_PIXELS, "max_base64_bytes": MAX_B64_BYTES},
    }


@api_router.get("/openapi.json", include_in_schema=False)
async def get_open_api_endpoint():
    return get_openapi(
        title="Manga Text Cleaner API",
        version="3.0.0",
        description="Xóa chữ / bóng thoại trên trang Manga & Manhwa: RT-DETR vùng Chat/SFX, ComicTextDetector seg, flat-fill + LaMa inpaint.",
        routes=api_router.routes,
    )""",
)

# benchmark HTML page lived only behind /benchmark; drop it, keep /api/benchmark
s = cut(s, 'BENCHMARK_PAGE_HTML = """<!DOCTYPE html>', '@api_router.get("/api/benchmark")')

# ---------------------------------------------------------------- 4. /clean_page hardening
replace_exact(
    s,
    """async def api_clean_page(req: CleanPagePayload):
    try:
        _t_api = time.perf_counter()

        # Decode incoming base64
        _t_dec = time.perf_counter()
        img_pil = b64_to_pil(req.imageBase64)
        _decode_ms = (time.perf_counter() - _t_dec) * 1000.0

        payload_in_bytes = len(req.imageBase64)

        cleaned_pil, color_mask_pil, stats = await run_in_threadpool(
            cleaner_pipeline.clean_image,
            image_input=img_pil,
            clean_sfx=bool(req.cleanSFX),
            dilation_px=int(req.dilationPx or 4),
            det_threshold=float(req.detThreshold or 0.20),
            inpaint_model=str(req.inpaintModel or "anime-lama"),
        )

        # Encode results to base64
        _t_enc1 = time.perf_counter()
        cleaned_b64 = await run_in_threadpool(pil_to_b64, cleaned_pil)
        _encode1_ms = (time.perf_counter() - _t_enc1) * 1000.0

        _t_enc2 = time.perf_counter()
        mask_b64 = await run_in_threadpool(pil_to_b64, color_mask_pil)
        _encode2_ms = (time.perf_counter() - _t_enc2) * 1000.0

        _total_api_ms = (time.perf_counter() - _t_api) * 1000.0

        response_bytes = len(cleaned_b64) + len(mask_b64)

        # Merge API-level timings into stats
        api_timings = {
            "decode_ms": round(_decode_ms, 2),
            "encode_cleaned_ms": round(_encode1_ms, 2),
            "encode_mask_ms": round(_encode2_ms, 2),
            "payload_in_bytes": payload_in_bytes,
            "response_bytes": response_bytes,
            "total_ms": round(_total_api_ms, 2),
        }
        if "timings_ms" not in stats:
            stats["timings_ms"] = {}
        stats["timings_ms"].update(api_timings)

        return {
            "success": True,
            "cleanedImageBase64": cleaned_b64,
            "colorMaskBase64": mask_b64,
            "stats": stats,
        }
    except Exception as exc:
        logger.error("API error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))""",
    '''async def api_clean_page(req: CleanPagePayload):
    _t_api = time.perf_counter()

    raw = (req.imageBase64 or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Thiếu dữ liệu ảnh (imageBase64).")
    if len(raw) > MAX_B64_BYTES:
        raise HTTPException(status_code=413, detail=f"Ảnh quá lớn: {len(raw) // 1024} KB base64, giới hạn {MAX_B64_BYTES // 1024} KB.")
    inpaint_model = str(req.inpaintModel or "anime-lama").strip().lower()
    if inpaint_model not in VALID_INPAINT_MODELS:
        raise HTTPException(status_code=422, detail=f"inpaintModel không hợp lệ: {inpaint_model}. Chọn một trong {sorted(VALID_INPAINT_MODELS)}.")

    # Decode incoming base64
    _t_dec = time.perf_counter()
    try:
        img_pil = b64_to_pil(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Không giải mã được ảnh base64: {exc}") from exc
    if img_pil.width * img_pil.height > MAX_PIXELS:
        raise HTTPException(status_code=413, detail=f"Ảnh quá lớn: {img_pil.width}x{img_pil.height}, giới hạn {MAX_PIXELS} pixel.")
    _decode_ms = (time.perf_counter() - _t_dec) * 1000.0

    payload_in_bytes = len(raw)

    try:
        cleaned_pil, color_mask_pil, stats = await run_in_threadpool(
            cleaner_pipeline.clean_image,
            image_input=img_pil,
            clean_sfx=bool(req.cleanSFX),
            dilation_px=int(req.dilationPx or 4),
            det_threshold=float(req.detThreshold or 0.20),
            inpaint_model=inpaint_model,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("clean_page failed")
        raise HTTPException(status_code=500, detail=f"Làm sạch ảnh thất bại: {type(exc).__name__}: {exc}") from exc

    # Encode results to base64
    _t_enc1 = time.perf_counter()
    cleaned_b64 = await run_in_threadpool(pil_to_b64, cleaned_pil)
    _encode1_ms = (time.perf_counter() - _t_enc1) * 1000.0

    _t_enc2 = time.perf_counter()
    mask_b64 = await run_in_threadpool(pil_to_b64, color_mask_pil)
    _encode2_ms = (time.perf_counter() - _t_enc2) * 1000.0

    _total_api_ms = (time.perf_counter() - _t_api) * 1000.0
    response_bytes = len(cleaned_b64) + len(mask_b64)

    # API-level timings live in their own key: the pipeline reports its own `timings_ms`,
    # and mixing the two made `inpaint` look slower than it really is.
    stats["api_timings_ms"] = {
        "decode": round(_decode_ms, 2),
        "encode_cleaned": round(_encode1_ms, 2),
        "encode_mask": round(_encode2_ms, 2),
        "payload_in_bytes": payload_in_bytes,
        "response_bytes": response_bytes,
        "total": round(_total_api_ms, 2),
    }

    return {
        "success": True,
        "cleanedImageBase64": cleaned_b64,
        "colorMaskBase64": mask_b64,
        "stats": stats,
    }''',
)

# ---------------------------------------------------------------- 5. OCR + translate routes
s = cut(s, '@api_router.post(\n    "/detect_boxes",', "# --------------------------------------------------------------------------------------\n# Gradio UI Layout")

# ---------------------------------------------------------------- 6. OCR Gradio tab
s = cut(s, "            # ================= TAB 3:", "            # ================= TAB 4:")

# ---------------------------------------------------------------- 7. API guide tab text
i = s.index('            with gr.TabItem("📱 REST API Endpoints"):')
j = s.index("    demo.queue(max_size=32", i)
s = s[:i] + '''            with gr.TabItem("📱 REST API Endpoints"):
                gr.Markdown(
                    """
                    ### 🔗 REST API (Swagger UI tại **`/docs`**, schema tại **`/openapi.json`**)

                    Backend này chỉ làm **một việc: xóa chữ**. OCR / dịch nằm ở phía studio (Vercel).

                    * **`GET /health`** (hoặc **`GET /api/v1/health`**): trạng thái dịch vụ, model sẵn sàng, giới hạn ảnh.
                    * **`POST /clean_page`** (hoặc **`POST /api/clean_page`**): gửi Base64 ảnh, nhận ảnh đã xóa chữ + Color Mask (Xanh = Chat, Đỏ = SFX).
                      ```json
                      {
                        "imageBase64": "data:image/jpeg;base64,...",
                        "cleanSFX": false,
                        "dilationPx": 4,
                        "detThreshold": 0.20,
                        "inpaintModel": "anime-lama"
                      }
                      ```
                      Phản hồi: `success`, `cleanedImageBase64`, `colorMaskBase64`, `stats` (kèm `timings_ms`, `api_timings_ms`, `device`).
                    * `inpaintModel` hỗ trợ: `"anime-lama"`, `"big-lama"`, `"opencv-telea"`, `"opencv-ns"`.
                    * **`GET /api/benchmark?runs=3&force_cpu=true`**: đo thời gian từng giai đoạn trên 2 ảnh mẫu.
                    * Lỗi luôn trả `{"detail": "..."}`: 400 (base64 hỏng), 413 (ảnh quá lớn), 422 (tham số sai), 500 (lỗi pipeline).
                    """
                )

''' + s[j:]

# ---------------------------------------------------------------- 8. __main__ block
replace_exact(
    s,
    '''    logger.info("🚀 Ensuring models at boot...")
    try:
        ensure_models()
        logger.info("✅ Models verified successfully!")
    except Exception as e:
        logger.warning("Model download check warning: %s", e)

    port = int(os.environ.get("PORT", 7860))
    logger.info("🚀 Starting Manga Cleaner & Translation Server on port %d...", port)''',
    '''    port = int(os.environ.get("PORT", 7860))
    logger.info("🚀 Starting Manga Cleaner (text removal) on port %d ...", port)''',
)
replace_exact(
    s,
    "    # Gắn toàn bộ router REST API (/api/v1/translate-page, /clean_page, /health) và Swagger Docs (/docs)",
    "    # Gắn router REST API (/health, /clean_page, /api/benchmark)",
)
replace_exact(
    s,
    '            logger.info("✅ Custom REST API & Swagger /docs routes attached successfully.")',
    '            logger.info("✅ REST API routes attached.")',
)
replace_exact(
    s,
    '''    logger.info("📖 Swagger UI Docs: http://0.0.0.0:%d/docs", port)
    logger.info("🎨 Gradio Web UI:  http://0.0.0.0:%d/", port)''',
    '''    logger.info("📖 Swagger UI: http://0.0.0.0:%d/docs", port)
    logger.info("🎨 Gradio UI :  http://0.0.0.0:%d/", port)''',
)

out = ROOT / "app.py"
out.write_text(s, encoding="utf-8")
print("written", out, "chars:", len(s))
for marker in ("Tự Động Xóa", "Quẹt Cọ Tự Do", "REST API Endpoints", "process_page_ocr", "MangaTranslator",
               "upload_to_hf", "BENCHMARK_PAGE_HTML", "draw_reading_order_boxes"):
    print(f"  {marker!r}: {s.count(marker)}")
