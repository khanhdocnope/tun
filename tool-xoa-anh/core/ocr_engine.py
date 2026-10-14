"""
Module Nhận diện & OCR (core/ocr_engine.py)
- Sử dụng Comic-Text-Detector (ONNX Runtime / OpenCV DNN) tìm Bounding Boxes văn bản trên toàn trang.
- Sắp xếp thứ tự đọc thông minh:
  * mode="manga": Phải -> Trái, Trên -> Dưới (RTL)
  * mode="webtoon": Trên -> Dưới (TTB)
- Cơ chế nạp Lazy A/B OCR:
  * Option A (ja_manga): manga-ocr (chuyên tiếng Nhật, chữ dọc/ngang)
  * Option B (multilingual): PaddleOCR (chạy CPU, hỗ trợ Hàn, Trung, Anh, v.v.)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

import cv2
import numpy as np
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ocr_engine")

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
WEIGHTS_DIR = BASE_DIR / "weights"

COMIC_ONNX_PATH = MODELS_DIR / "comictextdetector.pt.onnx"
if not COMIC_ONNX_PATH.is_file():
    alt = WEIGHTS_DIR / "comictextdetector.pt.onnx"
    if alt.is_file():
        COMIC_ONNX_PATH = alt
    else:
        alt2 = WEIGHTS_DIR / "comic-text-detector.onnx"
        if alt2.is_file():
            COMIC_ONNX_PATH = alt2

# --------------------------------------------------------------------------------------
# 1. Comic-Text-Detector: Text Box Detection (ONNX Runtime / OpenCV DNN)
# --------------------------------------------------------------------------------------
class ComicTextDetector:
    """Detector tìm bounding boxes văn bản truyện tranh bằng Comic-Text-Detector ONNX."""

    def __init__(self, model_path: Optional[Path] = None):
        self.model_path = Path(model_path) if model_path else COMIC_ONNX_PATH
        self.session = None
        self.net = None
        self.ready = False
        self._init_engine()

    def _init_engine(self):
        if not self.model_path.is_file():
            logger.warning("ComicTextDetector ONNX không tìm thấy tại: %s. Sẽ tải khi cần.", self.model_path)
            try:
                from download_models import ensure_models
                ensure_models()
            except Exception as e:
                logger.error("Không thể tự động tải model: %s", e)

        if not self.model_path.is_file():
            logger.error("Model file vẫn không tồn tại: %s", self.model_path)
            return

        # 1. Thử ONNX Runtime trước (CPU Execution Provider)
        try:
            import onnxruntime as ort
            sess_opts = ort.SessionOptions()
            sess_opts.intra_op_num_threads = 4
            sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.session = ort.InferenceSession(
                str(self.model_path),
                sess_options=sess_opts,
                providers=["CPUExecutionProvider"],
            )
            self.ready = True
            logger.info("ComicTextDetector đã sẵn sàng (ONNX Runtime CPU).")
            return
        except Exception as exc:
            logger.warning("ONNX Runtime không khả dụng (%s), chuyển sang OpenCV DNN fallback.", exc)

        # 2. Fallback OpenCV DNN
        try:
            self.net = cv2.dnn.readNetFromONNX(str(self.model_path))
            self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            self.ready = True
            logger.info("ComicTextDetector đã sẵn sàng (OpenCV DNN CPU).")
        except Exception as exc:
            logger.error("Khởi tạo ComicTextDetector thất bại: %s", exc)

    def detect_boxes(
        self,
        image_bgr: np.ndarray,
        det_threshold: float = 0.20,
        input_size: int = 1024,
        min_size: int = 12,
    ) -> List[Tuple[int, int, int, int]]:
        """
        Tìm các text bounding boxes trên trang truyện.
        Trả về danh sách box dạng [ymin, xmin, ymax, xmax].
        """
        h, w = image_bgr.shape[:2]
        if not self.ready:
            logger.warning("Detector chưa sẵn sàng, trả về rỗng.")
            return []

        scale = min(input_size / h, input_size / w)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(image_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(resized, 0, input_size - nh, 0, input_size - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))

        blob = (padded.astype(np.float32) / 255.0).transpose(2, 0, 1)[np.newaxis, ...]

        det_prob = None
        seg_prob = None

        if self.session is not None:
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: blob})
            for out in outputs:
                if out.ndim == 4 and out.shape[1] == 1:
                    seg_prob = out[0, 0]
                elif out.ndim == 4 and out.shape[1] == 2:
                    det_prob = out[0, 0]
        elif self.net is not None:
            self.net.setInput(cv2.dnn.blobFromImage(padded, 1.0 / 255.0, (input_size, input_size), swapRB=False, crop=False))
            outputs = self.net.forward(self.net.getUnconnectedOutLayersNames())
            for out in outputs:
                if out.ndim == 4 and out.shape[1] == 1:
                    seg_prob = out[0, 0]
                elif out.ndim == 4 and out.shape[1] == 2:
                    det_prob = out[0, 0]

        if det_prob is not None and seg_prob is not None:
            comb = np.maximum(det_prob, seg_prob)
        elif det_prob is not None:
            comb = det_prob
        elif seg_prob is not None:
            comb = seg_prob
        else:
            return []

        # Resize lại kích thước gốc (bỏ phần padding)
        prob_valid = comb[:nh, :nw]
        prob_orig = cv2.resize(prob_valid, (w, h), interpolation=cv2.INTER_LINEAR)

        # Ngưỡng nhị phân
        binary = (prob_orig > det_threshold).astype(np.uint8) * 255

        # Dilation nhẹ để kết nối các nét ký tự trong cùng một bóng thoại/dòng thoại
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        binary = cv2.dilate(binary, kernel, iterations=2)

        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        raw_boxes = []
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            if bw >= min_size and bh >= min_size:
                xmin = max(0, x)
                ymin = max(0, y)
                xmax = min(w, x + bw)
                ymax = min(h, y + bh)
                # Format yêu cầu: [ymin, xmin, ymax, xmax]
                raw_boxes.append((ymin, xmin, ymax, xmax))

        # Hợp nhất các box con bị chia tách quá gần nhau
        merged = self._merge_close_boxes(raw_boxes, dist_threshold=14)
        return merged

    @staticmethod
    def _merge_close_boxes(boxes: List[Tuple[int, int, int, int]], dist_threshold: int = 14) -> List[Tuple[int, int, int, int]]:
        if not boxes:
            return []
        
        merged = []
        used = [False] * len(boxes)

        for i in range(len(boxes)):
            if used[i]:
                continue
            y1, x1, y2, x2 = boxes[i]
            used[i] = True

            changed = True
            while changed:
                changed = False
                for j in range(len(boxes)):
                    if not used[j]:
                        jy1, jx1, jy2, jx2 = boxes[j]
                        # Kiểm tra khoảng cách
                        if not (x2 + dist_threshold < jx1 or jx2 + dist_threshold < x1 or
                                y2 + dist_threshold < jy1 or jy2 + dist_threshold < y1):
                            # Hợp nhất
                            x1 = min(x1, jx1)
                            y1 = min(y1, jy1)
                            x2 = max(x2, jx2)
                            y2 = max(y2, jy2)
                            used[j] = True
                            changed = True

            merged.append((y1, x1, y2, x2))
        return merged


# --------------------------------------------------------------------------------------
# 2. Reading Order Sorter: Manga (RTL) vs Webtoon (TTB)
# --------------------------------------------------------------------------------------
def sort_reading_order(
    boxes: List[Dict[str, Any]],
    mode: Literal["manga", "webtoon"] = "manga",
    y_band_tolerance: int = 40,
) -> List[Dict[str, Any]]:
    """
    Sắp xếp danh sách box theo thứ tự đọc:
    - mode="manga": Manga truyền thống đọc từ Phải sang Trái, Trên xuống Dưới.
    - mode="webtoon": Webtoon dọc đọc từ Trên xuống Dưới.
    boxes: List các dict, mỗi dict chứa key "bbox": [ymin, xmin, ymax, xmax]
    """
    if not boxes:
        return []

    if mode == "webtoon":
        # Webtoon: sắp xếp ưu tiên theo ymin tăng dần, sau đó đến xmin
        return sorted(boxes, key=lambda b: (b["bbox"][0], b["bbox"][1]))

    # Manga (RTL): Nhóm theo dải panel (Band) từ trên xuống dưới, trong cùng band xếp từ phải qua trái
    # Tính tâm y và tâm x của mỗi box
    augmented = []
    for idx, b in enumerate(boxes):
        ymin, xmin, ymax, xmax = b["bbox"]
        cy = (ymin + ymax) / 2.0
        cx = (xmin + xmax) / 2.0
        augmented.append({"data": b, "cy": cy, "cx": cx, "ymin": ymin, "xmin": xmin})

    # Sắp xếp sơ bộ theo cy
    augmented.sort(key=lambda item: item["cy"])

    # Phân cụm thành các dải ngang (horizontal bands)
    bands: List[List[Dict[str, Any]]] = []
    current_band: List[Dict[str, Any]] = []

    for item in augmented:
        if not current_band:
            current_band.append(item)
        else:
            band_avg_y = sum(x["cy"] for x in current_band) / len(current_band)
            if abs(item["cy"] - band_avg_y) <= y_band_tolerance:
                current_band.append(item)
            else:
                bands.append(current_band)
                current_band = [item]
    if current_band:
        bands.append(current_band)

    # Trong mỗi dải, sắp xếp từ PHẢI sang TRÁI (cx giảm dần)
    sorted_boxes = []
    for band in bands:
        band.sort(key=lambda item: item["cx"], reverse=True)
        for item in band:
            sorted_boxes.append(item["data"])

    return sorted_boxes


# --------------------------------------------------------------------------------------
# 3. Lazy A/B OCR Engines (manga-ocr & PaddleOCR)
# --------------------------------------------------------------------------------------
_MANGA_OCR_INSTANCE = None
_PADDLE_OCR_INSTANCES: Dict[str, Any] = {}


def get_manga_ocr():
    """Nạp lazy manga-ocr (chuyên xử lý tiếng Nhật)."""
    global _MANGA_OCR_INSTANCE
    if _MANGA_OCR_INSTANCE is None:
        logger.info("📦 Đang nạp manga-ocr vào CPU RAM...")
        try:
            from manga_ocr import MangaOcr
            _MANGA_OCR_INSTANCE = MangaOcr()
            logger.info("✅ manga-ocr đã nạp thành công.")
        except Exception as exc:
            logger.error("Không thể nạp manga-ocr: %s", exc)
            raise RuntimeError(f"Lỗi nạp manga-ocr: {exc}")
    return _MANGA_OCR_INSTANCE


def get_paddle_ocr(lang: str = "ch"):
    """Nạp lazy PaddleOCR (hỗ trợ tiếng Hàn, Trung, Anh, v.v.)."""
    global _PADDLE_OCR_INSTANCES
    lang = lang.lower().strip()
    if lang not in _PADDLE_OCR_INSTANCES:
        logger.info("📦 Đang nạp PaddleOCR (lang=%s) vào CPU RAM...", lang)
        try:
            from paddleocr import PaddleOCR
            # Tối ưu chạy trên CPU
            _PADDLE_OCR_INSTANCES[lang] = PaddleOCR(
                use_angle_cls=True,
                lang=lang,
                use_gpu=False,
                show_log=False,
                enable_mkldnn=True,
            )
            logger.info("✅ PaddleOCR (lang=%s) đã nạp thành công.", lang)
        except Exception as exc:
            logger.error("Không thể nạp PaddleOCR (lang=%s): %s", lang, exc)
            raise RuntimeError(f"Lỗi nạp PaddleOCR ({lang}): {exc}")
    return _PADDLE_OCR_INSTANCES[lang]


def run_ocr_on_crop(
    crop_pil: Image.Image,
    engine_type: Literal["ja_manga", "multilingual"] = "ja_manga",
    source_lang: str = "ch",
) -> str:
    """Chạy OCR trên một vùng ảnh crop."""
    if crop_pil.width < 4 or crop_pil.height < 4:
        return ""

    if engine_type == "ja_manga":
        mocr = get_manga_ocr()
        import torch
        with torch.inference_mode():
            text = mocr(crop_pil)
        return text.strip() if text else ""

    # Multilingual: PaddleOCR
    pocr = get_paddle_ocr(lang=source_lang)
    crop_np = np.array(crop_pil.convert("RGB"))
    try:
        result = pocr.ocr(crop_np, cls=True)
        if not result or not result[0]:
            return ""
        lines = [line[1][0] for line in result[0] if line and len(line) > 1 and line[1]]
        return " ".join(lines).strip()
    except Exception as exc:
        logger.warning("PaddleOCR crop error: %s", exc)
        return ""


# --------------------------------------------------------------------------------------
# 4. Pipeline tích hợp hoàn chỉnh (Detect -> Sort -> OCR)
# --------------------------------------------------------------------------------------
_DETECTOR = ComicTextDetector()


def process_page_ocr(
    image: Union[Image.Image, np.ndarray],
    ocr_engine: Literal["ja_manga", "multilingual"] = "ja_manga",
    reading_order: Literal["manga", "webtoon"] = "manga",
    source_lang: str = "ch",
    det_threshold: float = 0.20,
    chat_only: bool = True,
) -> Tuple[int, List[Dict[str, Any]]]:
    """
    Quy trình nhận diện và OCR toàn bộ trang truyện:
    1. BBox Detection (ComicTextDetector)
    2. Lọc chỉ lấy chữ trong bong bóng chat (chat_only=True), loại bỏ SFX vẽ tay
    3. Sắp xếp thứ tự đọc (Manga RTL hoặc Webtoon TTB)
    4. Cắt từng box và chạy OCR (manga-ocr hoặc PaddleOCR)
    Trả về: (total_boxes, list_of_objects)
    """
    if isinstance(image, np.ndarray):
        img_bgr = image if image.ndim == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
        img_pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    else:
        img_pil = image.convert("RGB")
        img_bgr = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)

    # 1. Phát hiện BBoxes
    raw_boxes = _DETECTOR.detect_boxes(img_bgr, det_threshold=det_threshold)
    if not raw_boxes:
        return 0, []

    # 2. Lọc chỉ lấy chữ trong Bong Bóng Thoại (Chat Bubble Only) nếu bật tùy chọn
    if chat_only:
        try:
            from manga_cleaner import cleaner_pipeline
            if cleaner_pipeline.ready:
                img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
                regions = cleaner_pipeline._detect_regions(img_rgb, thr=0.15, force_cpu=True)
                chat_boxes = [d.box for d in regions if d.cls == 1]  # CLS_TEXT_BUBBLE
                if chat_boxes:
                    filtered_boxes = []
                    for b in raw_boxes:
                        ymin, xmin, ymax, xmax = b
                        b_area = max(1, (xmax - xmin) * (ymax - ymin))
                        inside_bubble = False
                        for (cx1, cy1, cx2, cy2) in chat_boxes:
                            ix1 = max(xmin, cx1)
                            iy1 = max(ymin, cy1)
                            ix2 = min(xmax, cx2)
                            iy2 = min(ymax, cy2)
                            iw = max(0, ix2 - ix1)
                            ih = max(0, iy2 - iy1)
                            if (iw * ih) / b_area >= 0.20:
                                inside_bubble = True
                                break
                        if inside_bubble:
                            filtered_boxes.append(b)
                    if filtered_boxes:
                        raw_boxes = filtered_boxes
        except Exception as exc:
            logger.warning("Không thể lọc bong bóng chat (dùng toàn bộ box): %s", exc)

    # Định dạng thành list dicts để chuẩn bị sort
    box_items = [{"bbox": list(b)} for b in raw_boxes]

    # 3. Sắp xếp thứ tự đọc
    sorted_items = sort_reading_order(box_items, mode=reading_order)

    # 3. Chạy OCR từng box theo đúng thứ tự
    results = []
    w, h = img_pil.size

    for idx, item in enumerate(sorted_items, start=1):
        ymin, xmin, ymax, xmax = item["bbox"]
        # Đảm bảo biên hợp lệ và thêm margin nhỏ 2px
        pad = 2
        cy1 = max(0, ymin - pad)
        cx1 = max(0, xmin - pad)
        cy2 = min(h, ymax + pad)
        cx2 = min(w, xmax + pad)

        crop = img_pil.crop((cx1, cy1, cx2, cy2))
        text = run_ocr_on_crop(crop, engine_type=ocr_engine, source_lang=source_lang)

        results.append({
            "id": idx,
            "bbox": [ymin, xmin, ymax, xmax],
            "original_text": text,
            "translated_text": "",  # Sẽ được điền ở module translator
        })

    return len(results), results
