import asyncio
import base64
import io
import json
import os
import re
import sys
import tempfile
import time
import zipfile
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("manga_translator")

import cv2
import gradio as gr
try:
    import gradio_client.utils as client_utils
    _orig_json_schema = client_utils._json_schema_to_python_type
    def _safe_json_schema_to_python_type(schema, defs=None):
        if not isinstance(schema, dict):
            return "Any"
        return _orig_json_schema(schema, defs)
    client_utils._json_schema_to_python_type = _safe_json_schema_to_python_type
except Exception as e:
    pass

import numpy as np
from PIL import Image
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    import spaces  # ZeroGPU support on Hugging Face Spaces
    HAS_ZEROGPU = True
except ImportError:
    HAS_ZEROGPU = False
    class spaces:
        @staticmethod
        def GPU(duration=30):
            def decorator(func):
                return func
            return decorator

import torch

# Ensure local module can be imported
sys.path.insert(0, str(Path(__file__).parent))

from manga_translator.config import Inpainter, Detector, InpainterConfig
from manga_translator.detection import dispatch as dispatch_detection, prepare as prepare_detection
from manga_translator.textline_merge import dispatch as dispatch_textline_merge
from manga_translator.mask_refinement import dispatch as dispatch_mask_refinement
from manga_translator.inpainting import dispatch as dispatch_inpainting, prepare as prepare_inpainting
from manga_translator.utils.sort import sort_regions


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def get_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def natural_sort_key(s: str):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r"(\d+)", str(s))]


# ------------------------------------------------------------- Base64 & Format Helpers
def decode_base64_image(b64_str: str) -> Image.Image:
    if not b64_str:
        raise ValueError("Chuỗi base64 ảnh rỗng")
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_str)
    pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return pil_img


def encode_image_base64(pil_img: Image.Image, format: str = "JPEG", quality: int = 95) -> str:
    buf = io.BytesIO()
    if format.upper() in ["JPEG", "JPG"]:
        pil_img.save(buf, format="JPEG", quality=quality)
        mime = "image/jpeg"
    elif format.upper() == "WEBP":
        pil_img.save(buf, format="WEBP", quality=quality)
        mime = "image/webp"
    else:
        pil_img.save(buf, format="PNG")
        mime = "image/png"
    encoded = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


def encode_array_base64(img_rgb: np.ndarray, format: str = "JPEG", quality: int = 95) -> str:
    pil_img = Image.fromarray(img_rgb)
    return encode_image_base64(pil_img, format=format, quality=quality)


def sort_boxes_regions(
    text_regions: List[Any],
    reading_order: str = "manga",
    img_rgb: Optional[np.ndarray] = None,
) -> List[Any]:
    if not text_regions:
        return []
    rtl = str(reading_order).strip().lower() not in ["webtoon", "ltr", "left_to_right"]
    try:
        return sort_regions(text_regions, right_to_left=rtl, img=img_rgb)
    except Exception as e:
        print(f"Warning: sort_regions gặp lỗi ({e}), chuyển sang sắp xếp tọa độ đơn giản")
        return sorted(text_regions, key=lambda r: (r.center[1], -r.center[0] if rtl else r.center[0]))


def classify_text_region(region: Any, img_rgb: np.ndarray) -> str:
    """
    Phân loại vùng chữ:
    - 'bubble': Lời thoại trong bóng thoại hoặc ô thoại dẫn truyện (nền trắng/đen trung tính, đồng nhất).
    - 'sfx': Chữ hiệu ứng âm thanh, chữ vẽ trên tóc, áo, người nhân vật, phong cảnh (có màu sắc, saturation hoặc color variance cao).
    """
    try:
        x, y, w, h = [int(v) for v in region.xywh]
        h_img, w_img = img_rgb.shape[:2]
        x = max(0, min(x, w_img - 1))
        y = max(0, min(y, h_img - 1))
        w = max(1, min(w, w_img - x))
        h = max(1, min(h, h_img - y))

        crop = img_rgb[y:y+h, x:x+w]
        if crop.size == 0:
            return "bubble"

        # 1. KIỂM TRA MÀU SẮC (Tranh màu):
        # Mọi bóng thoại / ô thoại chuẩn trong manga đều là giấy trung tính (trắng, xám, đen, R ~ G ~ B).
        # Chữ nghệ thuật / SFX / chữ vẽ trên tóc, áo, da, phong cảnh luôn có màu sắc (saturation cao, hoặc color_variance cao).
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        sat_mean = float(np.mean(hsv[..., 1]))
        sat_p85 = float(np.percentile(hsv[..., 1], 85))
        color_var = float(np.mean(np.var(crop, axis=2)))

        # Nếu vùng chữ có độ bão hòa màu cao hoặc độ lệch màu giữa các kênh RGB lớn -> CHẮC CHẮN LÀ SFX / CHỮ NGHỆ THUẬT!
        if sat_p85 > 45 or sat_mean > 18 or color_var > 45:
            return "sfx"

        # 2. KIỂM TRA ĐỘ TRẮNG / ĐEN CỦA BÓNG THOẠI (Áp dụng cho cả tranh đen trắng và tranh màu):
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        border_pixels = np.concatenate([
            gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]
        ])

        # Bóng thoại trắng chuẩn hoặc có đổ bóng nhẹ / screentone
        border_white_pct = float(np.mean(border_pixels > 210) * 100)
        pct_white = float(np.mean(gray > 215) * 100)
        if border_white_pct >= 50 and pct_white >= 35:
            return "bubble"

        # Bóng thoại đen (chữ trắng trên nền đen bóng thoại)
        border_black_pct = float(np.mean(border_pixels < 40) * 100)
        pct_black = float(np.mean(gray < 40) * 100)
        if border_black_pct > 65 and pct_black > 40:
            return "bubble"

        return "sfx"
    except Exception:
        return "bubble"


def format_boxes(
    sorted_regions: List[Any],
    img_rgb: Optional[np.ndarray] = None,
) -> List[Dict[str, Any]]:
    boxes = []
    for idx, r in enumerate(sorted_regions):
        x, y, w, h = [int(v) for v in r.xywh]
        raw_dir = getattr(r, "direction", "h")
        dir_val = "v" if str(raw_dir).lower().startswith("v") else "h"

        try:
            frgb, brgb = r.get_font_colors()
            fg_color = [max(0, min(255, int(c))) for c in frgb]
            bg_color = [max(0, min(255, int(c))) for c in brgb]
        except Exception:
            fg_color = [0, 0, 0]
            bg_color = [255, 255, 255]

        raw_font_size = getattr(r, "font_size", 24)
        font_size_est = int(round(raw_font_size)) if raw_font_size and raw_font_size > 0 else 24

        raw_angle = getattr(r, "angle", 0)
        try:
            angle = round(float(raw_angle), 2)
            if abs(angle) < 0.01:
                angle = 0
        except Exception:
            angle = 0

        box_type = getattr(r, "box_type", None)
        if box_type is None and img_rgb is not None:
            box_type = classify_text_region(r, img_rgb)
        elif box_type is None:
            box_type = "bubble"

        boxes.append({
            "id": f"box_{idx + 1}",
            "order": idx + 1,
            "box": [max(0, x), max(0, y), max(1, w), max(1, h)],
            "direction": dir_val,
            "angle": angle,
            "font_size_est": font_size_est,
            "fg_color": fg_color,
            "bg_color": bg_color,
            "type": box_type,
        })
    return boxes



# ------------------------------------------------------------- Core GPU Implementations
def _detect_boxes_impl(
    img_rgb: np.ndarray,
    detector_name: str = "default",
    reading_order: str = "manga",
    detect_size: int = 1024,
) -> Tuple[List[Any], Dict[str, float]]:
    dev = get_device()
    timings = {}

    # 1. Detection
    t0 = time.perf_counter()
    det_key = Detector.ctd if detector_name == "ctd" else Detector.default
    textlines, raw_mask, _ = asyncio.run(
        dispatch_detection(
            det_key,
            img_rgb,
            detect_size=detect_size,
            text_threshold=0.25,
            box_threshold=0.35,
            unclip_ratio=1.7,
            device=dev,
            verbose=False,
        )
    )
    timings["detect_s"] = round(time.perf_counter() - t0, 3)

    if not textlines:
        timings["total_s"] = timings["detect_s"]
        return [], timings

    # 2. Textline Merge
    t1 = time.perf_counter()
    h, w = img_rgb.shape[:2]
    text_regions = asyncio.run(dispatch_textline_merge(textlines, w, h, verbose=False))
    timings["merge_s"] = round(time.perf_counter() - t1, 3)

    # 3. Sort Text Regions
    t2 = time.perf_counter()
    sorted_regions = sort_boxes_regions(text_regions, reading_order=reading_order, img_rgb=img_rgb)
    timings["sort_s"] = round(time.perf_counter() - t2, 3)
    timings["total_s"] = round(sum(timings.values()), 3)

    return sorted_regions, timings


def _process_page_impl(
    img_rgb: np.ndarray,
    detector_name: str = "default",
    inpainter_name: str = "lama_large",
    dilation_offset: int = 2,
    clean_mode: str = "all",
    detect_size: int = 1024,
    reading_order: str = "manga",
) -> Tuple[np.ndarray, np.ndarray, List[Any], Dict[str, float]]:
    dev = get_device()
    timings = {}

    # 1. Detection
    t0 = time.perf_counter()
    det_key = Detector.ctd if detector_name == "ctd" else Detector.default
    textlines, raw_mask, _ = asyncio.run(
        dispatch_detection(
            det_key,
            img_rgb,
            detect_size=detect_size,
            text_threshold=0.25,
            box_threshold=0.35,
            unclip_ratio=1.7,
            device=dev,
            verbose=False,
        )
    )
    timings["detect_s"] = round(time.perf_counter() - t0, 3)

    if not textlines:
        timings["total_s"] = timings["detect_s"]
        return img_rgb, np.zeros(img_rgb.shape[:2], dtype=np.uint8), [], timings

    # 2. Textline Merge
    t1 = time.perf_counter()
    h, w = img_rgb.shape[:2]
    text_regions = asyncio.run(dispatch_textline_merge(textlines, w, h, verbose=False))
    timings["merge_s"] = round(time.perf_counter() - t1, 3)

    # Gán nhãn phân loại 'bubble' vs 'sfx' cho từng region
    for r in text_regions:
        r.box_type = classify_text_region(r, img_rgb)

    # Lọc vùng text nếu người dùng chọn chỉ xóa bóng thoại
    if clean_mode == "bubble_only":
        active_regions = [r for r in text_regions if r.box_type == "bubble"]
    else:
        active_regions = text_regions

    # 3. Mask Refinement
    t2 = time.perf_counter()
    if active_regions:
        refined_mask = asyncio.run(
            dispatch_mask_refinement(
                active_regions,
                img_rgb,
                raw_mask,
                method="fit_text",
                dilation_offset=dilation_offset,
                verbose=False,
            )
        )
    else:
        refined_mask = np.zeros(img_rgb.shape[:2], dtype=np.uint8)
    timings["mask_refine_s"] = round(time.perf_counter() - t2, 3)

    # 4. Inpainting
    t3 = time.perf_counter()
    if np.any(refined_mask > 0):
        inpaint_key_map = {
            "lama_large": Inpainter.lama_large,
            "lama_mpe": Inpainter.lama_mpe,
            "aot": Inpainter.default,
        }
        inp_key = inpaint_key_map.get(inpainter_name, Inpainter.lama_large)
        cleaned_rgb = asyncio.run(
            dispatch_inpainting(
                inp_key,
                img_rgb,
                refined_mask,
                config=InpainterConfig(),
                inpainting_size=1024,
                device=dev,
                verbose=False,
            )
        )
    else:
        cleaned_rgb = img_rgb.copy()
    timings["inpaint_s"] = round(time.perf_counter() - t3, 3)

    # 5. Sort Text Regions
    t4 = time.perf_counter()
    sorted_regions = sort_boxes_regions(text_regions, reading_order=reading_order, img_rgb=img_rgb)
    timings["sort_s"] = round(time.perf_counter() - t4, 3)
    timings["total_s"] = round(sum(timings.values()), 3)

    return cleaned_rgb, refined_mask, sorted_regions, timings


# ZeroGPU Wrappers
@spaces.GPU(duration=60)
def _detect_boxes_gpu(
    img_rgb: np.ndarray,
    detector_name: str = "default",
    reading_order: str = "manga",
    detect_size: int = 1024,
) -> Tuple[List[Any], Dict[str, float]]:
    return _detect_boxes_impl(
        img_rgb=img_rgb,
        detector_name=detector_name,
        reading_order=reading_order,
        detect_size=detect_size,
    )


@spaces.GPU(duration=60)
def _process_page_gpu(
    img_rgb: np.ndarray,
    detector_name: str = "default",
    inpainter_name: str = "lama_large",
    dilation_offset: int = 2,
    clean_mode: str = "all",
    detect_size: int = 1024,
    reading_order: str = "manga",
) -> Tuple[np.ndarray, np.ndarray, List[Any], Dict[str, float]]:
    return _process_page_impl(
        img_rgb=img_rgb,
        detector_name=detector_name,
        inpainter_name=inpainter_name,
        dilation_offset=dilation_offset,
        clean_mode=clean_mode,
        detect_size=detect_size,
        reading_order=reading_order,
    )


@spaces.GPU(duration=60)
def _process_inpaint_gpu(
    img_rgb: np.ndarray,
    detector_name: str = "default",
    inpainter_name: str = "lama_large",
    dilation_offset: int = 2,
    clean_mode: str = "all",
    detect_size: int = 1024,
) -> Tuple[np.ndarray, np.ndarray, Dict[str, float]]:
    cleaned_rgb, refined_mask, _, timings = _process_page_impl(
        img_rgb=img_rgb,
        detector_name=detector_name,
        inpainter_name=inpainter_name,
        dilation_offset=dilation_offset,
        clean_mode=clean_mode,
        detect_size=detect_size,
        reading_order="manga",
    )
    return cleaned_rgb, refined_mask, timings


@spaces.GPU(duration=60)
def _process_mask_inpaint_gpu(
    img_rgb: np.ndarray,
    mask: np.ndarray,
    inpainter_name: str = "lama_large",
    dilation_offset: int = 0,
) -> Tuple[np.ndarray, Dict[str, float]]:
    dev = get_device()
    timings = {}
    t0 = time.perf_counter()

    if mask.ndim == 3:
        if mask.shape[2] == 4:
            mask = mask[:, :, 3] if mask[:, :, 3].any() else cv2.cvtColor(mask, cv2.COLOR_RGBA2GRAY)
        else:
            mask = cv2.cvtColor(mask, cv2.COLOR_RGB2GRAY)

    _, mask_bin = cv2.threshold(mask, 10, 255, cv2.THRESH_BINARY)
    if mask_bin.shape[:2] != img_rgb.shape[:2]:
        mask_bin = cv2.resize(mask_bin, (img_rgb.shape[1], img_rgb.shape[0]), interpolation=cv2.INTER_NEAREST)

    if dilation_offset != 0:
        k_size = abs(dilation_offset) * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
        if dilation_offset > 0:
            mask_bin = cv2.dilate(mask_bin, kernel, iterations=1)
        else:
            mask_bin = cv2.erode(mask_bin, kernel, iterations=1)

    inpaint_key_map = {
        "lama_large": Inpainter.lama_large,
        "lama_mpe": Inpainter.lama_mpe,
        "aot": Inpainter.default,
    }
    inp_key = inpaint_key_map.get(inpainter_name, Inpainter.default)
    cleaned_rgb = asyncio.run(
        dispatch_inpainting(
            inp_key,
            img_rgb,
            mask_bin,
            config=InpainterConfig(),
            inpainting_size=1024,
            device=dev,
            verbose=False,
        )
    )
    timings["inpaint_s"] = round(time.perf_counter() - t0, 3)
    return cleaned_rgb, timings


# ------------------------------------------------------------- Gradio Processing
def process_image(
    image: Optional[Image.Image],
    detector_name: str = "default",
    inpainter_name: str = "lama_large",
    dilation_offset: int = 2,
    clean_mode: str = "all",
) -> Tuple[Optional[Image.Image], Optional[Image.Image], str, str]:
    if image is None:
        return None, None, "Vui lòng tải ảnh lên", "{}"

    img_rgb = np.array(image.convert("RGB"))
    cleaned_rgb, mask, timings = _process_inpaint_gpu(
        img_rgb,
        detector_name=detector_name,
        inpainter_name=inpainter_name,
        dilation_offset=int(dilation_offset),
        clean_mode=clean_mode,
    )

    dev = get_device()
    mode_text = "Chỉ xóa bóng thoại (Giữ SFX)" if clean_mode == "bubble_only" else "Xóa tất cả"
    time_badge = f"Chế độ: {mode_text} | Tổng: {timings.get('total_s', 0)}s (Inpaint: {timings.get('inpaint_s', 0)}s) | {dev.upper()}"
    json_str = json.dumps(timings, indent=2, ensure_ascii=False)
    return Image.fromarray(cleaned_rgb), Image.fromarray(mask), time_badge, json_str


def process_zip(
    zip_file,
    detector_name: str = "default",
    inpainter_name: str = "lama_large",
    dilation_offset: int = 2,
    clean_mode: str = "all",
    progress=gr.Progress(track_tqdm=True),
) -> Tuple[Optional[str], str, List[Tuple[Image.Image, str]]]:
    if zip_file is None:
        return None, "⚠️ Vui lòng tải lên file .zip chứa các trang manga.", []

    zip_path = zip_file if isinstance(zip_file, str) else getattr(zip_file, "name", str(zip_file))
    if not zipfile.is_zipfile(zip_path):
        return None, "❌ File tải lên không phải là định dạng ZIP hợp lệ.", []

    t_start = time.perf_counter()
    preview_items: List[Tuple[Image.Image, str]] = []

    with zipfile.ZipFile(zip_path, "r") as in_zip:
        all_names = in_zip.namelist()
        valid_img_names = [
            n for n in all_names
            if not n.startswith("__MACOSX/")
            and not Path(n).name.startswith(".")
            and Path(n).suffix.lower() in IMAGE_EXTENSIONS
        ]
        valid_img_names.sort(key=natural_sort_key)

        total_pages = len(valid_img_names)
        if total_pages == 0:
            return None, "❌ Không tìm thấy file ảnh hợp lệ (.png, .jpg, .webp, .bmp) bên trong file ZIP.", []

        temp_dir = tempfile.mkdtemp()
        orig_stem = Path(zip_path).stem
        out_zip_path = os.path.join(temp_dir, f"{orig_stem}_cleaned.zip")

        total_timings = {"detect_s": 0.0, "merge_s": 0.0, "mask_refine_s": 0.0, "inpaint_s": 0.0}

        with zipfile.ZipFile(out_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as out_zip:
            for idx, entry_name in enumerate(valid_img_names):
                page_label = f"Trang {idx + 1}/{total_pages}: {Path(entry_name).name}"
                progress((idx) / total_pages, desc=f"Đang xử lý {page_label}")

                try:
                    raw_bytes = in_zip.read(entry_name)
                    with Image.open(io.BytesIO(raw_bytes)) as pil_img:
                        img_rgb = np.array(pil_img.convert("RGB"))
                except Exception as e:
                    print(f"Lỗi đọc file {entry_name}: {e}")
                    continue

                cleaned_rgb, _, timings = _process_inpaint_gpu(
                    img_rgb,
                    detector_name=detector_name,
                    inpainter_name=inpainter_name,
                    dilation_offset=int(dilation_offset),
                    clean_mode=clean_mode,
                )

                for k in total_timings:
                    total_timings[k] += timings.get(k, 0.0)

                ext = Path(entry_name).suffix.lower()
                cleaned_pil = Image.fromarray(cleaned_rgb)

                buf = io.BytesIO()
                if ext in [".jpg", ".jpeg"]:
                    cleaned_pil.save(buf, format="JPEG", quality=95)
                elif ext == ".webp":
                    cleaned_pil.save(buf, format="WEBP", quality=95)
                else:
                    cleaned_pil.save(buf, format="PNG")

                out_zip.writestr(entry_name, buf.getvalue())

                if len(preview_items) < 8:
                    preview_items.append((cleaned_pil, f"Trang {idx + 1} ({Path(entry_name).name})"))

    total_time = round(time.perf_counter() - t_start, 2)
    avg_page_time = round(total_time / max(total_pages, 1), 2)
    dev = get_device()

    summary_text = (
        f"✅ Hoàn tất xử lý file ZIP!\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📄 Số trang đã xử lý: {total_pages}\n"
        f"⚡ Thiết bị sử dụng: {dev.upper()}\n"
        f"⏱️ Tổng thời gian: {total_time}s (Trung bình: {avg_page_time}s / trang)\n"
        f"  ├─ Nhận diện chữ (Detect): {round(total_timings['detect_s'], 2)}s\n"
        f"  ├─ Gộp dòng text (Merge): {round(total_timings['merge_s'], 2)}s\n"
        f"  ├─ Tinh chỉnh mask: {round(total_timings['mask_refine_s'], 2)}s\n"
        f"  └─ Xóa chữ (Inpaint): {round(total_timings['inpaint_s'], 2)}s\n"
        f"📦 File tải về: {Path(out_zip_path).name}"
    )

    progress(1.0, desc="Hoàn thành!")
    return out_zip_path, summary_text, preview_items


# ------------------------------------------------------------- Gradio Interface
def create_ui():
    theme = gr.themes.Soft(
        primary_hue="indigo",
        secondary_hue="slate",
        font=[gr.themes.GoogleFont("Inter"), "sans-serif"],
    )

    with gr.Blocks(theme=theme, title="Manga-Image-Translator (Inpaint Test)") as demo:
        gr.Markdown(
            """
            # 🎨 Manga-Image-Translator — Inpainting & Clean Test
            Bản tinh gọn (Lightweight Inpaint Only) từ **zyddnys/manga-image-translator** để kiểm tra tốc độ & độ sạch với cả **Ảnh đơn** và **File .ZIP**.
            """
        )

        with gr.Tabs():
            # TAB 1: ẢNH ĐƠN
            with gr.TabItem("🖼️ Xử lý 1 ảnh"):
                with gr.Row():
                    with gr.Column(scale=5):
                        input_img = gr.Image(type="pil", label="📥 Tải lên trang Manga")

                        with gr.Group():
                            clean_mode_choice = gr.Radio(
                                choices=[
                                    ("🧹 Xóa tất cả (Cả bóng thoại & SFX/tranh)", "all"),
                                    ("🛡️ Chỉ xóa bóng thoại (Giữ nguyên SFX, chữ trên tóc/áo)", "bubble_only"),
                                ],
                                value="all",
                                label="🎯 Chế độ xóa chữ",
                                info="Chọn 'Chỉ xóa bóng thoại' nếu muốn bảo toàn 100% chữ nghệ thuật/SFX trên tóc, áo và tranh vẽ.",
                            )
                            detector_choice = gr.Dropdown(
                                choices=["default", "ctd"],
                                value="default",
                                label="🔍 Detector (Nhận diện chữ)",
                                info="Default (DBNet) hoặc CTD (ComicTextDetector)",
                            )
                            inpainter_choice = gr.Dropdown(
                                choices=["lama_large", "aot", "lama_mpe"],
                                value="lama_large",
                                label="🎨 Inpainter (Xóa chữ)",
                                info="LaMa Large (Khuyên dùng - Nét nhất, không nhòe), AOT hoặc LaMa MPE",
                            )
                            dilation_slider = gr.Slider(
                                minimum=-5,
                                maximum=15,
                                step=1,
                                value=2,
                                label="Dilation Offset",
                                info="Độ bù dilation cho mask chữ (Mặc định +2 giúp xóa sạch viền/furigana mờ)",
                            )

                        clean_btn = gr.Button("🚀 Xóa chữ (Inpaint)", variant="primary", size="lg")
                        time_box = gr.Textbox(label="⏱️ Thời gian xử lý", interactive=False)

                    with gr.Column(scale=7):
                        with gr.Tabs():
                            with gr.TabItem("✨ Kết quả sạch"):
                                output_img = gr.Image(type="pil", label="Ảnh đã xóa chữ")
                            with gr.TabItem("🎯 Mask"):
                                mask_img = gr.Image(type="pil", label="Mask chữ đã tinh chỉnh")
                            with gr.TabItem("📊 Chi tiết thời gian"):
                                stats_box = gr.Textbox(label="Timings Breakdown (JSON)", lines=6, interactive=False)

                clean_btn.click(
                    fn=process_image,
                    inputs=[input_img, detector_choice, inpainter_choice, dilation_slider, clean_mode_choice],
                    outputs=[output_img, mask_img, time_box, stats_box],
                    api_name=False,
                )

            # TAB 2: FILE .ZIP
            with gr.TabItem("📦 Xử lý cả file .ZIP"):
                with gr.Row():
                    with gr.Column(scale=5):
                        zip_input = gr.File(
                            label="📥 Tải lên file .zip chứa các trang manga",
                            file_types=[".zip"],
                            type="filepath",
                        )

                        with gr.Group():
                            zip_clean_mode_choice = gr.Radio(
                                choices=[
                                    ("🧹 Xóa tất cả (Cả bóng thoại & SFX/tranh)", "all"),
                                    ("🛡️ Chỉ xóa bóng thoại (Giữ nguyên SFX, chữ trên tóc/áo)", "bubble_only"),
                                ],
                                value="all",
                                label="🎯 Chế độ xóa chữ",
                                info="Chọn 'Chỉ xóa bóng thoại' nếu muốn bảo toàn 100% chữ nghệ thuật/SFX trên tóc, áo và tranh vẽ.",
                            )
                            zip_detector_choice = gr.Dropdown(
                                choices=["default", "ctd"],
                                value="default",
                                label="🔍 Detector (Nhận diện chữ)",
                                info="Default (DBNet) hoặc CTD (ComicTextDetector)",
                            )
                            zip_inpainter_choice = gr.Dropdown(
                                choices=["lama_large", "aot", "lama_mpe"],
                                value="lama_large",
                                label="🎨 Inpainter (Xóa chữ)",
                                info="LaMa Large (Khuyên dùng - Nét nhất, không nhòe), AOT hoặc LaMa MPE",
                            )
                            zip_dilation_slider = gr.Slider(
                                minimum=-5,
                                maximum=15,
                                step=1,
                                value=2,
                                label="Dilation Offset",
                                info="Độ bù dilation cho mask chữ (Mặc định +2 giúp xóa sạch viền/furigana mờ)",
                            )

                        zip_clean_btn = gr.Button("🚀 Xóa chữ toàn bộ ZIP", variant="primary", size="lg")

                    with gr.Column(scale=7):
                        zip_output_file = gr.File(label="📥 Tải về file ZIP kết quả")
                        zip_stats_box = gr.Textbox(label="📊 Thống kê xử lý", lines=8, interactive=False)
                        zip_gallery = gr.Gallery(
                            label="👀 Xem trước các trang đã xóa (Tối đa 8 trang đầu)",
                            columns=4,
                            height="auto",
                        )

                zip_clean_btn.click(
                    fn=process_zip,
                    inputs=[zip_input, zip_detector_choice, zip_inpainter_choice, zip_dilation_slider, zip_clean_mode_choice],
                    outputs=[zip_output_file, zip_stats_box, zip_gallery],
                    api_name=False,
                )

    return demo


# ------------------------------------------------------------- FastAPI REST API
fastapi_app = FastAPI(
    title="Manga Image Translator API",
    description="FastAPI Backend for Manga Image Cleaning & Text Box Detection",
    version="1.0.0",
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DetectBoxesRequest(BaseModel):
    imageBase64: str
    readingOrder: Optional[str] = "manga"
    detector: Optional[str] = "default"


class CleanRequest(BaseModel):
    imageBase64: str
    detector: Optional[str] = "default"
    inpainter: Optional[str] = "lama_large"
    dilation_offset: Optional[int] = 2
    dilationOffset: Optional[int] = None
    clean_mode: Optional[str] = "all"
    cleanMode: Optional[str] = None
    maskBase64: Optional[str] = None

    def get_dilation_offset(self) -> int:
        if self.dilationOffset is not None:
            return self.dilationOffset
        return self.dilation_offset if self.dilation_offset is not None else 2

    def get_clean_mode(self) -> str:
        if self.cleanMode is not None:
            return self.cleanMode
        return self.clean_mode if self.clean_mode else "all"


class ProcessPageRequest(BaseModel):
    imageBase64: str
    readingOrder: Optional[str] = "manga"
    detector: Optional[str] = "default"
    inpainter: Optional[str] = "lama_large"
    dilation_offset: Optional[int] = 2
    dilationOffset: Optional[int] = None
    clean_mode: Optional[str] = "all"
    cleanMode: Optional[str] = None

    def get_dilation_offset(self) -> int:
        if self.dilationOffset is not None:
            return self.dilationOffset
        return self.dilation_offset if self.dilation_offset is not None else 2

    def get_clean_mode(self) -> str:
        if self.cleanMode is not None:
            return self.cleanMode
        return self.clean_mode if self.clean_mode else "all"


@fastapi_app.middleware("http")
async def root_json_handler(request: Request, call_next):
    if request.url.path == "/" and request.method == "GET":
        accept = request.headers.get("accept", "")
        if "application/json" in accept or request.query_params.get("format") == "json":
            return JSONResponse({"status": "ok", "device": get_device()})
    return await call_next(request)


@fastapi_app.get("/api/health")
@fastapi_app.get("/health")
def health_endpoint():
    return {"status": "ok", "device": get_device()}


@fastapi_app.post("/api/detect-boxes")
def detect_boxes_api(payload: DetectBoxesRequest):
    try:
        pil_img = decode_base64_image(payload.imageBase64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid imageBase64: {e}")

    try:
        img_rgb = np.array(pil_img)
        sorted_regions, _ = _detect_boxes_gpu(
            img_rgb,
            detector_name=payload.detector or "default",
            reading_order=payload.readingOrder or "manga",
        )
        boxes = format_boxes(sorted_regions, img_rgb=img_rgb)
        return {"boxes": boxes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection error: {e}")


@fastapi_app.post("/api/clean")
def clean_api(payload: CleanRequest):
    try:
        pil_img = decode_base64_image(payload.imageBase64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid imageBase64: {e}")

    try:
        img_rgb = np.array(pil_img)
        if payload.maskBase64:
            pil_mask = decode_base64_image(payload.maskBase64)
            mask_arr = np.array(pil_mask)
            cleaned_rgb, _ = _process_mask_inpaint_gpu(
                img_rgb,
                mask_arr,
                inpainter_name=payload.inpainter or "lama_large",
                dilation_offset=payload.get_dilation_offset(),
            )
        else:
            cleaned_rgb, _, _ = _process_inpaint_gpu(
                img_rgb,
                detector_name=payload.detector or "default",
                inpainter_name=payload.inpainter or "lama_large",
                dilation_offset=payload.get_dilation_offset(),
                clean_mode=payload.get_clean_mode(),
            )
        cleaned_b64 = encode_array_base64(cleaned_rgb, format="JPEG", quality=95)
        return {"cleanedImageBase64": cleaned_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inpainting error: {e}")


@fastapi_app.post("/api/process-page")
def process_page_api(payload: ProcessPageRequest):
    try:
        pil_img = decode_base64_image(payload.imageBase64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid imageBase64: {e}")

    try:
        img_rgb = np.array(pil_img)
        cleaned_rgb, _, sorted_regions, _ = _process_page_gpu(
            img_rgb,
            detector_name=payload.detector or "default",
            inpainter_name=payload.inpainter or "lama_large",
            dilation_offset=payload.get_dilation_offset(),
            clean_mode=payload.get_clean_mode(),
            reading_order=payload.readingOrder or "manga",
        )
        cleaned_b64 = encode_array_base64(cleaned_rgb, format="JPEG", quality=95)
        boxes = format_boxes(sorted_regions, img_rgb=img_rgb)
        return {
            "cleanedImageBase64": cleaned_b64,
            "boxes": boxes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Process page error: {e}")


# Create Gradio UI and attach REST API routes
demo = create_ui()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    logger.info("Starting Manga Image Translator server on port %d ...", port)

    app, local_url, share_url = demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        show_error=True,
    )

    if hasattr(app, "include_router"):
        try:
            app.include_router(fastapi_app.router)
        except Exception as e:
            logger.warning("include_router notice: %s", e)

    if hasattr(app, "router") and hasattr(app.router, "routes"):
        try:
            for route in reversed(fastapi_app.routes):
                if route not in app.router.routes:
                    app.router.routes.insert(0, route)
            logger.info("REST API routes attached successfully.")
        except Exception as e:
            logger.warning("Router insertion notice: %s", e)

    demo.block_thread()

