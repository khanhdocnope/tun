"""
Manga Text Detector sử dụng RapidOCR với chế độ bóc tách đa giác (Polygons).
Tối ưu cho văn bản tiếng Nhật/Anh/Hàn/Việt trong Manga và Webtoon.
"""

from typing import List, Tuple, Dict, Any, Optional
import numpy as np
from rapidocr_onnxruntime import RapidOCR


class MangaTextDetector:
    def __init__(self, det_use_cuda: bool = False, cls_use_cuda: bool = False, rec_use_cuda: bool = False):
        """
        Khởi tạo RapidOCR instance.
        """
        # RapidOCR tự động cấu hình các mô hình ONNX siêu nhẹ
        self.engine = RapidOCR()

    def detect(self, image_rgb: np.ndarray) -> Tuple[List[np.ndarray], List[Dict[str, Any]]]:
        """
        Phát hiện chữ và trích xuất tọa độ polygon cùng nội dung text.
        
        Args:
            image_rgb: Ảnh numpy array (H, W, 3).
            
        Returns:
            Tuple:
                - polygons: Danh sách các polygon numpy array [[x1, y1], [x2, y2], ...]
                - text_items: Danh sách chi tiết gồm {text, score, polygon}
        """
        # RapidOCR mặc định nhận ảnh BGR hoặc RGB (tốt nhất là BGR hoặc ndarray chuẩn)
        result, elapse_list = self.engine(image_rgb)
        
        polygons = []
        text_items = []

        if not result:
            return polygons, text_items

        for item in result:
            # item format: [polygon_box, text, confidence_score]
            poly_box, text, score = item
            poly_np = np.array(poly_box, dtype=np.int32)
            
            polygons.append(poly_np)
            text_items.append({
                "text": text,
                "score": float(score),
                "polygon": poly_np.tolist()
            })

        return polygons, text_items
