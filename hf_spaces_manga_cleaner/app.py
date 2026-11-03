"""
FastAPI Server chuyên biệt để deploy lên Hugging Face Spaces (CPU Free Tier).
Cung cấp REST API xử lý xóa chữ manga cho Client Local hoặc Web App.
"""

import io
import time
import gc
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, JSONResponse
from PIL import Image
import numpy as np
import cv2

from detector import MangaTextDetector
from mask_utils import polygons_to_mask
from lama_onnx import LamaONNXInpainter

app = FastAPI(
    title="Manga Cleaner AI API (HF CPU Optimized)",
    description="Engine bóc text RapidOCR Polygon + Xóa chữ LaMa ONNX phục hồi nền Manga"
)

# Khởi tạo singleton detector và inpainter khi container khởi động
print("[Init] Khởi tạo RapidOCR Text Detector...")
detector = MangaTextDetector()

print("[Init] Khởi tạo LaMa ONNX Inpainter...")
inpainter = LamaONNXInpainter()


@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "Manga Cleaner AI Engine",
        "device": "CPU (HF Optimized)",
        "features": ["RapidOCR Polygon", "LaMa ONNX Inpainting", "Smart Downscale"]
    }


@app.post("/clean")
async def clean_manga_page(
    file: UploadFile = File(...),
    dilation_kernel: int = Form(7),
    max_dim: int = Form(512),
    return_mask: bool = Form(false)
):
    """
    Xóa chữ trên 1 trang manga:
    - Nhận file ảnh tải lên.
    - Chạy RapidOCR bóc tách Polygons.
    - Tạo binary mask có dilation.
    - Chạy LaMa ONNX inpainting tối ưu hóa CPU.
    - Trả về file ảnh kết quả đã làm sạch.
    """
    start_time = time.time()
    contents = await file.read()
    
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        image_np = np.array(pil_image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Không thể đọc file ảnh: {str(e)}")

    # 1. Phát hiện chữ (RapidOCR Polygons)
    polygons, text_items = detector.detect(image_np)
    
    # Nếu không có chữ nào trên trang
    if not polygons:
        # Trả lại ảnh gốc dạng WebP
        out_buf = io.BytesIO()
        pil_image.save(out_buf, format="WEBP", quality=95)
        return Response(content=out_buf.getvalue(), media_type="image/webp")

    # 2. Tạo Mask nhị phân
    mask = polygons_to_mask(image_np.shape, polygons, dilation_kernel_size=dilation_kernel)

    if return_mask:
        out_buf = io.BytesIO()
        Image.fromarray(mask).save(out_buf, format="PNG")
        return Response(content=out_buf.getvalue(), media_type="image/png")

    # 3. Inpainting phục hồi nền (Smart Downscale 512px)
    cleaned_np = inpainter.inpaint_smart_downscale(image_np, mask, max_dim=max_dim)
    
    elapsed = time.time() - start_time
    print(f"[Done] Đã xóa {len(polygons)} cụm chữ trong {elapsed:.2f} giây.")

    # 4. Xuất kết quả WebP nén chất lượng cao
    out_buf = io.BytesIO()
    cleaned_pil = Image.fromarray(cleaned_np)
    cleaned_pil.save(out_buf, format="WEBP", quality=95)
    
    # Thu dọn bộ nhớ
    del pil_image, image_np, mask, cleaned_np, cleaned_pil
    gc.collect()

    return Response(
        content=out_buf.getvalue(), 
        media_type="image/webp",
        headers={"X-Process-Time": f"{elapsed:.2f}s", "X-Text-Count": str(len(polygons))}
    )


@app.post("/detect")
async def detect_text_only(file: UploadFile = File(...)):
    """
    Chỉ trích xuất text và tọa độ polygons (dùng cho tính năng dịch thuật / typesetting).
    """
    contents = await file.read()
    pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    image_np = np.array(pil_image)

    polygons, text_items = detector.detect(image_np)
    return JSONResponse(content={"count": len(text_items), "items": text_items})
