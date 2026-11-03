"""
Pipeline nhị phân hóa và xử lý Mask cho Manga.
Tập trung vào tính chính xác của Polygon và tạo padding/dilation để bảo vệ nét vẽ gốc.
"""

from typing import List, Tuple, Union
import numpy as np
import cv2


def polygons_to_mask(
    image_shape: Tuple[int, ...],
    polygons: List[Union[np.ndarray, List[List[int]]]],
    dilation_kernel_size: int = 7,
    iterations: int = 1
) -> np.ndarray:
    """
    Chuyển đổi danh sách các polygons chữ thành Binary Mask (0: Nền, 255: Vùng chữ).
    
    Args:
        image_shape: Kích thước ảnh gốc (H, W) hoặc (H, W, C).
        polygons: Danh sách các mảng tọa độ polygon [[x1, y1], [x2, y2], ...].
        dilation_kernel_size: Bán kính mở rộng mask (phủ lề và bóng đổ mờ). Mặc định 7px.
        iterations: Số lần chạy dilation.
        
    Returns:
        np.ndarray: Mask nhị phân uint8 kích thước (H, W).
    """
    h, w = image_shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    if not polygons:
        return mask

    for poly in polygons:
        pts = np.array(poly, dtype=np.int32)
        if pts.ndim == 2 and len(pts) >= 3:
            cv2.fillPoly(mask, [pts], color=255)

    # Phủ padding/dilation để bao trọn nét viền mỏng và bóng chữ
    if dilation_kernel_size > 0:
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (dilation_kernel_size, dilation_kernel_size)
        )
        mask = cv2.dilate(mask, kernel, iterations=iterations)

    return mask


def extract_mask_bounding_boxes(
    mask: np.ndarray,
    padding: int = 32,
    min_area: int = 50
) -> List[Tuple[int, int, int, int]]:
    """
    Trích xuất các bounding boxes của các vùng chữ riêng biệt từ mask.
    Dùng cho kỹ thuật "Smart Patch Inpainting" (chỉ crop vùng có chữ đưa vào LaMa thay vì cả trang).
    
    Args:
        mask: Binary mask (H, W).
        padding: Số pixel đệm xung quanh để LaMa học ngữ cảnh nền.
        min_area: Bỏ qua các chấm nhiễu quá nhỏ.
        
    Returns:
        List[Tuple[x1, y1, x2, y2]]: Tọa độ hộp cắt an toàn.
    """
    h, w = mask.shape[:2]
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []

    for cnt in contours:
        if cv2.contourArea(cnt) < min_area:
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(w, x + bw + padding)
        y2 = min(h, y + bh + padding)
        boxes.append((x1, y1, x2, y2))

    return boxes
