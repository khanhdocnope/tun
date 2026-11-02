"""
FastAPI Server tối ưu cho GPU (Kaggle / Colab / Linux Server)
Không dùng Gradio hay ZeroGPU decorator -> Giữ model trực tiếp trên VRAM GPU T4/P100
Tốc độ: ~0.5s - 1.2s/trang Manga/Webtoon
"""

from __future__ import annotations

import base64
import io
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, ImageOps
from pydantic import BaseModel

from job_engine import job_engine
from manga_cleaner import cleaner_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("kaggle_backend")

app = FastAPI(
    title="Manga Text Cleaner - Kaggle GPU Backend",
    version="1.0.0",
    description="High performance Manga & Webtoon cleaner on Nvidia GPU",
)

# Cho phép CORS toàn phần để frontend Vercel hoặc localhost gọi thẳng
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_PIXELS = int(os.getenv("MAX_PIXELS", str(40_000_000)))
MAX_B64_BYTES = int(os.getenv("MAX_B64_BYTES", str(30 * 1024 * 1024)))
VALID_INPAINT_MODELS = {"anime-lama", "big-lama", "opencv-telea", "opencv-ns"}


def pil_to_b64(pil_img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    if fmt.upper() in ("JPG", "JPEG"):
        if pil_img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", pil_img.size, (255, 255, 255))
            if pil_img.mode == "RGBA":
                bg.paste(pil_img, mask=pil_img.split()[-1])
            else:
                bg.paste(pil_img.convert("RGB"))
            save_img = bg
        else:
            save_img = pil_img.convert("RGB")
        save_img.save(buf, format="JPEG", quality=95, subsampling=0)
    else:
        pil_img.save(buf, format="PNG", compress_level=1)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def b64_to_pil(b64_str: str) -> Image.Image:
    if not b64_str:
        raise ValueError("Empty image data.")
    clean = b64_str.strip()
    if "," in clean:
        clean = clean.split(",", 1)[1]
    raw = base64.b64decode(clean)
    img = Image.open(io.BytesIO(raw))
    return ImageOps.exif_transpose(img).convert("RGB")


class CleanPagePayload(BaseModel):
    imageBase64: str
    cleanSFX: Optional[bool] = False
    dilationPx: Optional[int] = 4
    detThreshold: Optional[float] = 0.20
    inpaintModel: Optional[str] = "anime-lama"
    minBoxSize: Optional[int] = 0
    readingDirection: Optional[str] = "rtl"


@app.get("/")
@app.get("/health")
@app.get("/api/v1/health")
def health():
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "None (CPU)"
    vram_free_gb = 0.0
    if torch.cuda.is_available():
        free_bytes, total_bytes = torch.cuda.mem_get_info()
        vram_free_gb = round(free_bytes / (1024**3), 2)

    return {
        "status": "online",
        "backend": "Kaggle Dedicated GPU",
        "device": f"CUDA ({gpu_name})" if torch.cuda.is_available() else "CPU",
        "vram_free_gb": vram_free_gb,
        "detector_ready": bool(cleaner_pipeline.bubbles.ready),
        "text_backend": getattr(cleaner_pipeline, "text_backend", "manga_det"),
        "available_models": sorted(VALID_INPAINT_MODELS),
        "limits": {"max_pixels": MAX_PIXELS, "max_base64_bytes": MAX_B64_BYTES},
    }


@app.post("/clean_page")
@app.post("/api/clean_page")
@app.post("/api/v2/clean")
@app.post("/api/v2/manga/process")
async def clean_page(req: CleanPagePayload):
    t_api = time.perf_counter()
    raw = (req.imageBase64 or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Thiếu dữ liệu ảnh (imageBase64).")
    if len(raw) > MAX_B64_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Ảnh quá lớn: {len(raw) // 1024} KB base64, tối đa {MAX_B64_BYTES // 1024} KB.",
        )

    inpaint_model = str(req.inpaintModel or "anime-lama").strip().lower()
    if inpaint_model not in VALID_INPAINT_MODELS:
        inpaint_model = "anime-lama"

    t_dec = time.perf_counter()
    try:
        img_pil = b64_to_pil(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Không giải mã được ảnh base64: {exc}") from exc

    if img_pil.width * img_pil.height > MAX_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=f"Ảnh vượt pixel tối đa: {img_pil.width}x{img_pil.height} > {MAX_PIXELS}",
        )
    decode_ms = (time.perf_counter() - t_dec) * 1000.0

    try:
        cleaned_pil, color_mask_pil, stats = await run_in_threadpool(
            cleaner_pipeline.clean_image,
            image_input=img_pil,
            clean_sfx=bool(req.cleanSFX),
            dilation_px=int(req.dilationPx if req.dilationPx is not None else 4),
            det_threshold=float(req.detThreshold if req.detThreshold is not None else 0.20),
            inpaint_model=inpaint_model,
            min_box_size=int(req.minBoxSize or 0),
            reading_direction=str(req.readingDirection or "rtl"),
        )
    except Exception as exc:
        logger.exception("clean_page error")
        raise HTTPException(status_code=500, detail=f"Lỗi pipeline: {type(exc).__name__}: {exc}") from exc

    t_enc = time.perf_counter()
    cleaned_b64 = await run_in_threadpool(pil_to_b64, cleaned_pil)
    mask_b64 = await run_in_threadpool(pil_to_b64, color_mask_pil)
    encode_ms = (time.perf_counter() - t_enc) * 1000.0

    total_api_ms = (time.perf_counter() - t_api) * 1000.0
    stats["api_timings_ms"] = {
        "decode": round(decode_ms, 2),
        "encode": round(encode_ms, 2),
        "total_http": round(total_api_ms, 2),
    }

    layers = stats.get("layers", [])

    return {
        "version": "2.0.0",
        "status": "success",
        "success": True,
        "cleanedImageBase64": f"data:image/png;base64,{cleaned_b64}",
        "colorMaskBase64": f"data:image/png;base64,{mask_b64}",
        "layers": layers,
        "stats": stats,
    }


# ==============================================================================
# ASYNC JOB ENGINE & SSE REALTIME STREAMING (V2.0)
# ==============================================================================

@app.on_event("startup")
async def on_startup():
    job_engine.start()


@app.on_event("shutdown")
async def on_shutdown():
    await job_engine.stop()


class CreateJobPayload(BaseModel):
    pages: List[Dict[str, Any]]
    defaultOptions: Optional[Dict[str, Any]] = None


@app.post("/api/v2/jobs/create")
async def create_job(payload: CreateJobPayload):
    """Tạo tác vụ xử lý Batch hàng chục trang mà không làm nghẽn HTTP."""
    if not payload.pages:
        raise HTTPException(status_code=400, detail="Danh sách pages không được rỗng.")
    job = job_engine.create_job(payload.pages, payload.defaultOptions)
    return {"success": True, "job": job.to_summary_dict()}


@app.get("/api/v2/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Lấy trạng thái và kết quả chi tiết của Job (Polling fallback)."""
    job = job_engine.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy job: {job_id}")
    return {"success": True, "job": job.to_full_dict()}


@app.get("/api/v2/jobs/{job_id}/stream")
async def stream_job_events(job_id: str):
    """Mở luồng SSE (Server-Sent Events) đẩy tiến trình theo thời gian thực."""
    job = job_engine.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy job: {job_id}")
    return StreamingResponse(
        job_engine.subscribe_stream(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/v2/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Hủy tác vụ đang chạy."""
    success = job_engine.cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Không thể hủy job: {job_id}")
    return {"success": True, "message": f"Đã hủy job {job_id}"}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
