"""
Module Nhận diện & OCR (core/ocr_engine.py) - bản TỐI ƯU TỐC ĐỘ

Thay đổi chính so với bản cũ:
  1. chat_only=True: dùng thẳng box "text_bubble" của RT-DETR (bubble_detector) làm vùng OCR,
     KHÔNG chạy thêm Comic-Text-Detector (CTD) + lọc giao nhau => bỏ hẳn 1 lần suy luận nặng/trang.
  2. CTD chỉ còn là đường dự phòng / dùng khi chat_only=False; hậu xử lý (threshold, dilate,
     findContours) chạy ở độ phân giải model (<=1024px) thay vì độ phân giải ảnh gốc.
  3. manga-ocr chạy THEO LÔ (batch) thay vì từng crop một.
  4. PaddleOCR tắt bộ phân loại góc (cls) mỗi crop - bong bóng manga hầu như không bị xoay.
  5. Nạp model lazy + có hàm warmup_ocr() để request đầu tiên không phải chờ nạp model.
API công khai không đổi: process_page_ocr(...), sort_reading_order(...).
"""

from __future__ import annotations

import logging
import os
import threading
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

CPU_THREADS = max(1, min(os.cpu_count() or 4, 8))
OCR_BATCH_SIZE = int(os.getenv("OCR_BATCH_SIZE", "8"))

COMIC_ONNX_PATH = MODELS_DIR / "comictextdetector.pt.onnx"
if not COMIC_ONNX_PATH.is_file():
    for _alt in (WEIGHTS_DIR / "comictextdetector.pt.onnx", WEIGHTS_DIR / "comic-text-detector.onnx"):
        if _alt.is_file():
            COMIC_ONNX_PATH = _alt
            break

try:  # đồng bộ với mask_logic
    from mask_logic import CLS_TEXT_BUBBLE
except Exception:  # noqa: BLE001
    CLS_TEXT_BUBBLE = 1

try:
    import torch

    torch.set_num_threads(CPU_THREADS)
except Exception:  # noqa: BLE001
    torch = None  # type: ignore


# --------------------------------------------------------------------------------------
# 1. Comic-Text-Detector (đường dự phòng / chat_only=False)
# --------------------------------------------------------------------------------------
class ComicTextDetector:
    """Tìm bounding boxes văn bản bằng Comic-Text-Detector ONNX."""

    def __init__(self, model_path: Optional[Path] = None):
        self.model_path = Path(model_path) if model_path else COMIC_ONNX_PATH
        self.session = None
        self.net = None
        self.ready = False
        self._init_engine()

    def _init_engine(self):
        if not self.model_path.is_file():
            try:
                from download_models import ensure_models

                ensure_models()
            except Exception as e:  # noqa: BLE001
                logger.error("Không thể tự động tải model: %s", e)
        if not self.model_path.is_file():
            logger.error("Model file không tồn tại: %s", self.model_path)
            return

        try:
            import onnxruntime as ort

            so = ort.SessionOptions()
            so.intra_op_num_threads = CPU_THREADS
            so.inter_op_num_threads = 1
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.session = ort.InferenceSession(str(self.model_path), sess_options=so, providers=["CPUExecutionProvider"])
            self.ready = True
            logger.info("ComicTextDetector sẵn sàng (ONNX Runtime CPU, %d threads).", CPU_THREADS)
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("ONNX Runtime không khả dụng (%s), dùng OpenCV DNN.", exc)

        try:
            self.net = cv2.dnn.readNetFromONNX(str(self.model_path))
            self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            self.ready = True
        except Exception as exc:  # noqa: BLE001
            logger.error("Khởi tạo ComicTextDetector thất bại: %s", exc)

    def detect_boxes(
        self,
        image_bgr: np.ndarray,
        det_threshold: float = 0.20,
        input_size: int = 1024,
        min_size: int = 12,
    ) -> List[Tuple[int, int, int, int]]:
        """Trả về box dạng (ymin, xmin, ymax, xmax) theo tọa độ ảnh gốc."""
        h, w = image_bgr.shape[:2]
        if not self.ready:
            logger.warning("Detector chưa sẵn sàng, trả về rỗng.")
            return []

        scale = min(input_size / h, input_size / w)
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = cv2.resize(image_bgr, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(resized, 0, input_size - nh, 0, input_size - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))

        det_prob = seg_prob = None
        if self.session is not None:
            blob = (padded.astype(np.float32) / 255.0).transpose(2, 0, 1)[np.newaxis, ...]
            outputs = self.session.run(None, {self.session.get_inputs()[0].name: blob})
        else:
            self.net.setInput(cv2.dnn.blobFromImage(padded, 1.0 / 255.0, (input_size, input_size), swapRB=False, crop=False))
            outputs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        for out in outputs:
            if out.ndim == 4 and out.shape[1] == 1:
                seg_prob = out[0, 0]
            elif out.ndim == 4 and out.shape[1] == 2:
                det_prob = out[0, 0]

        if det_prob is not None and seg_prob is not None:
            comb = np.maximum(det_prob, seg_prob)
        else:
            comb = det_prob if det_prob is not None else seg_prob
        if comb is None:
            return []

        # --- Hậu xử lý ở độ phân giải model (nhanh hơn rất nhiều với ảnh webtoon dài) ---
        binary = (comb[:nh, :nw] > det_threshold).astype(np.uint8) * 255
        # Bản cũ: kernel 5x5 x2 lần ở độ phân giải gốc ~ bán kính 4px gốc => quy đổi theo scale
        r = max(1, int(round(4 * scale)))
        binary = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, (2 * r + 1, 2 * r + 1)))
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        inv = 1.0 / scale
        raw: List[Tuple[int, int, int, int]] = []
        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            xmin, ymin = max(0, int(x * inv)), max(0, int(y * inv))
            xmax, ymax = min(w, int(round((x + bw) * inv))), min(h, int(round((y + bh) * inv)))
            if (xmax - xmin) >= min_size and (ymax - ymin) >= min_size:
                raw.append((ymin, xmin, ymax, xmax))
        return self._merge_close_boxes(raw, dist_threshold=14)

    @staticmethod
    def _merge_close_boxes(boxes: List[Tuple[int, int, int, int]], dist_threshold: int = 14) -> List[Tuple[int, int, int, int]]:
        if not boxes:
            return []
        merged: List[Tuple[int, int, int, int]] = []
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
                    if used[j]:
                        continue
                    jy1, jx1, jy2, jx2 = boxes[j]
                    if not (x2 + dist_threshold < jx1 or jx2 + dist_threshold < x1 or
                            y2 + dist_threshold < jy1 or jy2 + dist_threshold < y1):
                        x1, y1, x2, y2 = min(x1, jx1), min(y1, jy1), max(x2, jx2), max(y2, jy2)
                        used[j] = True
                        changed = True
            merged.append((y1, x1, y2, x2))
        return merged


_DETECTOR: Optional[ComicTextDetector] = None
_DETECTOR_LOCK = threading.Lock()


def _get_detector() -> ComicTextDetector:
    """Lazy singleton: chỉ nạp CTD khi thật sự cần (không nạp lúc import)."""
    global _DETECTOR
    if _DETECTOR is None:
        with _DETECTOR_LOCK:
            if _DETECTOR is None:
                _DETECTOR = ComicTextDetector()
    return _DETECTOR


# --------------------------------------------------------------------------------------
# 2. Thứ tự đọc
# --------------------------------------------------------------------------------------
def sort_reading_order(
    boxes: List[Dict[str, Any]],
    mode: Literal["manga", "webtoon"] = "manga",
    y_band_tolerance: int = 40,
) -> List[Dict[str, Any]]:
    """manga: dải ngang trên->dưới, trong dải phải->trái | webtoon: trên->dưới rồi trái->phải."""
    if not boxes:
        return []
    if mode == "webtoon":
        return sorted(boxes, key=lambda b: (b["bbox"][0], b["bbox"][1]))

    aug = []
    for b in boxes:
        ymin, xmin, ymax, xmax = b["bbox"]
        aug.append({"data": b, "cy": (ymin + ymax) / 2.0, "cx": (xmin + xmax) / 2.0})
    aug.sort(key=lambda it: it["cy"])

    bands: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    cur_sum = 0.0
    for it in aug:
        if cur and abs(it["cy"] - cur_sum / len(cur)) > y_band_tolerance:
            bands.append(cur)
            cur, cur_sum = [], 0.0
        cur.append(it)
        cur_sum += it["cy"]
    if cur:
        bands.append(cur)

    out: List[Dict[str, Any]] = []
    for band in bands:
        band.sort(key=lambda it: it["cx"], reverse=True)
        out.extend(it["data"] for it in band)
    return out


# --------------------------------------------------------------------------------------
# 3. OCR engines (lazy)
# --------------------------------------------------------------------------------------
_MANGA_OCR_INSTANCE = None
_PADDLE_OCR_INSTANCES: Dict[str, Any] = {}
_LOAD_LOCK = threading.Lock()


def get_manga_ocr():
    global _MANGA_OCR_INSTANCE
    if _MANGA_OCR_INSTANCE is None:
        with _LOAD_LOCK:
            if _MANGA_OCR_INSTANCE is None:
                use_cuda = torch.cuda.is_available() if torch else False
                logger.info("📦 Đang nạp manga-ocr (Device: %s)...", "CUDA" if use_cuda else "CPU")
                try:
                    from manga_ocr import MangaOcr

                    try:
                        inst = MangaOcr(force_cpu=not use_cuda)
                    except TypeError:
                        inst = MangaOcr()
                    inst.model.eval()
                    if use_cuda and hasattr(inst.model, "cuda"):
                        inst.model.cuda()
                    _MANGA_OCR_INSTANCE = inst
                except Exception as exc:  # noqa: BLE001
                    logger.error("Không thể nạp manga-ocr: %s", exc)
                    raise RuntimeError(f"Lỗi nạp manga-ocr: {exc}")
    return _MANGA_OCR_INSTANCE


def get_paddle_ocr(lang: str = "ch"):
    lang = lang.lower().strip()
    if lang not in _PADDLE_OCR_INSTANCES:
        with _LOAD_LOCK:
            if lang not in _PADDLE_OCR_INSTANCES:
                logger.info("📦 Đang nạp PaddleOCR (lang=%s)...", lang)
                try:
                    from paddleocr import PaddleOCR

                    # PaddleOCR phiên bản mới (>=2.7 / 3.x) không còn tham số use_gpu / enable_mkldnn
                    ocr_params = {
                        "use_angle_cls": False,
                        "lang": lang,
                        "show_log": False,
                    }
                    try:
                        _PADDLE_OCR_INSTANCES[lang] = PaddleOCR(
                            **ocr_params,
                            cpu_threads=CPU_THREADS,
                            rec_batch_num=OCR_BATCH_SIZE,
                        )
                    except (TypeError, ValueError):
                        _PADDLE_OCR_INSTANCES[lang] = PaddleOCR(**ocr_params)
                except Exception as exc:  # noqa: BLE001
                    logger.error("Không thể nạp PaddleOCR (lang=%s): %s", lang, exc)
                    raise RuntimeError(f"Lỗi nạp PaddleOCR ({lang}): {exc}")
    return _PADDLE_OCR_INSTANCES[lang]


def warmup_ocr(engine_type: str = "ja_manga", source_lang: str = "ch") -> None:
    """Gọi 1 lần khi khởi động app (vd. threading.Thread(target=warmup_ocr).start())."""
    try:
        if engine_type == "ja_manga":
            _ocr_manga_batch([Image.new("RGB", (64, 64), "white")])
        else:
            get_paddle_ocr(source_lang)
        _get_detector()
    except Exception as exc:  # noqa: BLE001
        logger.warning("warmup_ocr lỗi (bỏ qua): %s", exc)


def _ocr_manga_batch(crops: List[Image.Image], batch_size: int = OCR_BATCH_SIZE) -> List[str]:
    """manga-ocr theo lô tối ưu tốc độ. Giới hạn max_new_tokens và bật cache giải mã."""
    mocr = get_manga_ocr()
    results = [""] * len(crops)
    if not crops:
        return results

    try:
        from manga_ocr.ocr import post_process
    except Exception:  # noqa: BLE001
        def post_process(t: str) -> str:  # type: ignore
            return "".join(t.split())

    order = sorted(range(len(crops)), key=lambda i: crops[i].width * crops[i].height)
    device = mocr.model.device
    with torch.inference_mode():
        for s in range(0, len(order), batch_size):
            idxs = order[s:s + batch_size]
            try:
                imgs = [crops[i].convert("L").convert("RGB") for i in idxs]
                pix = mocr.processor(imgs, return_tensors="pt").pixel_values.to(device)
                # Tối ưu: max_new_tokens=64 (manga thoại ngắn, tránh lãng phí 300 bước lặp), use_cache=True
                ids = mocr.model.generate(
                    pix,
                    max_new_tokens=64,
                    num_beams=1,
                    do_sample=False,
                    use_cache=True,
                )
                texts = mocr.tokenizer.batch_decode(ids, skip_special_tokens=True)
                for i, t in zip(idxs, texts):
                    results[i] = post_process(t).strip()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Batch manga-ocr lỗi (%s), chạy từng crop.", exc)
                for i in idxs:
                    try:
                        results[i] = (mocr(crops[i]) or "").strip()
                    except Exception:  # noqa: BLE001
                        results[i] = ""
    return results


def _ocr_paddle_batch(crops: List[Image.Image], lang: str) -> List[str]:
    """PaddleOCR tối ưu: Chạy trực tiếp recognition (det=False) trên toàn bộ danh sách crop."""
    pocr = get_paddle_ocr(lang)
    out: List[str] = []
    if not crops:
        return out

    arrs = [np.array(c.convert("RGB")) for c in crops]
    try:
        # det=False: Vùng ảnh đã là crop bóng thoại, không cần chạy lại mạng phát hiện text (DBNet)
        res_list = pocr.ocr(arrs, det=False, cls=False)
        for res in res_list:
            if not res:
                out.append("")
                continue
            line_txt = " ".join(item[0] for item in res if item and len(item) > 0 and item[0]).strip()
            out.append(line_txt)
    except Exception as exc:
        logger.warning("PaddleOCR batch det=False lỗi (%s), fallback từng crop:", exc)
        for arr in arrs:
            try:
                res = pocr.ocr(arr, det=False, cls=False)
                txt = " ".join(item[0] for item in res if item and len(item) > 0 and item[0]).strip() if res else ""
                out.append(txt)
            except Exception:
                out.append("")
    return out


def run_ocr_on_crop(
    crop_pil: Image.Image,
    engine_type: Literal["ja_manga", "multilingual"] = "ja_manga",
    source_lang: str = "ch",
) -> str:
    """Giữ lại cho tương thích ngược (OCR 1 crop)."""
    if crop_pil.width < 4 or crop_pil.height < 4:
        return ""
    fn = _ocr_manga_batch if engine_type == "ja_manga" else (lambda c: _ocr_paddle_batch(c, source_lang))
    return fn([crop_pil])[0]


# --------------------------------------------------------------------------------------
# 4. Pipeline: Detect -> Sort -> OCR
# --------------------------------------------------------------------------------------
def _bubble_text_boxes(img_rgb: np.ndarray, min_size: int = 12) -> Optional[List[Tuple[int, int, int, int]]]:
    """Box chữ trong bong bóng thoại từ RT-DETR. None = detector chưa sẵn sàng/lỗi."""
    try:
        from manga_cleaner import cleaner_pipeline

        if not cleaner_pipeline.ready:
            return None
        h, w = img_rgb.shape[:2]
        use_cuda = torch.cuda.is_available() if torch else False
        regions = cleaner_pipeline._detect_regions(img_rgb, thr=0.15, force_cpu=not use_cuda)
        boxes = []
        for d in regions:
            if d.cls != CLS_TEXT_BUBBLE:
                continue
            x1, y1, x2, y2 = d.box
            x1, y1, x2, y2 = max(0, int(x1)), max(0, int(y1)), min(w, int(round(x2))), min(h, int(round(y2)))
            if (x2 - x1) >= min_size and (y2 - y1) >= min_size:
                boxes.append((y1, x1, y2, x2))
        return boxes
    except Exception as exc:  # noqa: BLE001
        logger.warning("Bubble detector lỗi, dùng CTD dự phòng: %s", exc)
        return None


def process_page_ocr(
    image: Union[Image.Image, np.ndarray],
    ocr_engine: Literal["ja_manga", "multilingual"] = "ja_manga",
    reading_order: Literal["manga", "webtoon"] = "manga",
    source_lang: str = "ch",
    det_threshold: float = 0.20,
    chat_only: bool = True,
) -> Tuple[int, List[Dict[str, Any]]]:
    """Trả về (total_boxes, [{id, bbox:[ymin,xmin,ymax,xmax], original_text, translated_text}])."""
    if isinstance(image, np.ndarray):
        img_bgr = image if image.ndim == 3 and image.shape[2] == 3 else cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        img_pil = Image.fromarray(img_rgb)
    else:
        img_pil = image.convert("RGB")
        img_rgb = np.array(img_pil)
        img_bgr = None  # chỉ tạo khi cần cho CTD

    # 1. Tìm box: chat_only -> RT-DETR text_bubble (nhanh, bỏ qua CTD); ngược lại / dự phòng -> CTD
    raw_boxes: Optional[List[Tuple[int, int, int, int]]] = None
    if chat_only:
        raw_boxes = _bubble_text_boxes(img_rgb)
    if not raw_boxes:
        det = _get_detector()
        if img_bgr is None:
            img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        raw_boxes = det.detect_boxes(img_bgr, det_threshold=det_threshold)
    if not raw_boxes:
        return 0, []

    # 2. Thứ tự đọc
    items = sort_reading_order([{"bbox": list(b)} for b in raw_boxes], mode=reading_order)

    # 3. Cắt crop rồi OCR theo lô
    w, h = img_pil.size
    pad = 2
    crops: List[Image.Image] = []
    for it in items:
        ymin, xmin, ymax, xmax = it["bbox"]
        crops.append(img_pil.crop((max(0, xmin - pad), max(0, ymin - pad), min(w, xmax + pad), min(h, ymax + pad))))

    valid = [i for i, c in enumerate(crops) if c.width >= 4 and c.height >= 4]
    texts = [""] * len(crops)
    if valid:
        sub = [crops[i] for i in valid]
        sub_txt = _ocr_manga_batch(sub) if ocr_engine == "ja_manga" else _ocr_paddle_batch(sub, source_lang)
        for i, t in zip(valid, sub_txt):
            texts[i] = t

    results = [
        {"id": n, "bbox": list(it["bbox"]), "original_text": texts[n - 1], "translated_text": ""}
        for n, it in enumerate(items, start=1)
    ]
    return len(results), results
