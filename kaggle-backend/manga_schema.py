"""
manga_schema.py - Chuẩn hóa API Contract & Data Pipeline (V2.0 Specification).
Tương thích hoàn toàn giữa Python AI Engine (GPU) và Vercel/Node.js Edge.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


class PixelBounds(BaseModel):
    x: int = Field(..., description="Tọa độ X góc trên-trái tính bằng pixel")
    y: int = Field(..., description="Tọa độ Y góc trên-trái tính bằng pixel")
    width: int = Field(..., description="Chiều rộng vùng bao tính bằng pixel")
    height: int = Field(..., description="Chiều cao vùng bao tính bằng pixel")


class LayerGeometry(BaseModel):
    is_pure_white_bg: bool = Field(
        False,
        description="True nếu nền bóng thoại là màu trắng phẳng (Flat paper bypass)",
    )
    confidence: float = Field(1.0, description="Độ tin cậy nhận diện hình học (0.0 - 1.0)")
    polygon: Optional[List[List[int]]] = Field(
        None,
        description="Đa giác viền chính xác [[x, y], ...]",
    )


class LayerTypography(BaseModel):
    orientation: str = Field("vertical", description="'vertical' | 'horizontal' | 'slanted'")
    suggested_font_size_pt: int = Field(18, description="Kích thước font đề xuất")
    text_align: str = Field("center", description="'center' | 'left' | 'right'")
    font_color: str = Field("#000000", description="Màu chữ hex")


class LayerContent(BaseModel):
    original_text: str = Field("", description="Văn bản gốc trích xuất từ OCR")
    translated_text: str = Field("", description="Văn bản đã dịch theo ngữ cảnh")
    confidence: float = Field(1.0, description="Độ tin cậy OCR / dịch")


class MangaLayer(BaseModel):
    id: str = Field(..., description="Định danh duy nhất của layer, ví dụ 'bubble_01'")
    order_index: int = Field(..., description="Thứ tự đọc tự nhiên trong trang (1, 2, 3...)")
    type: str = Field(
        "speech_bubble",
        description="'speech_bubble' | 'sfx' | 'narrative_box' | 'free_text'",
    )
    box_2d: List[int] = Field(
        ...,
        description="Tọa độ chuẩn hóa [ymin, xmin, ymax, xmax] theo thang 0..1000",
    )
    pixel_bounds: PixelBounds = Field(..., description="Tọa độ pixel gốc trên trang ảnh")
    geometry: LayerGeometry = Field(default_factory=LayerGeometry)
    typography: LayerTypography = Field(default_factory=LayerTypography)
    content: LayerContent = Field(default_factory=LayerContent)


class ImageDimensions(BaseModel):
    width: int
    height: int
    aspect_ratio: float


class MangaPageMeta(BaseModel):
    page_id: str = "page_001"
    sha256: str = ""
    dimensions: ImageDimensions
    reading_direction: str = "rtl"  # "rtl" (Manga) | "ltr" (Comic) | "ttb" (Webtoon)
    timings_ms: Dict[str, float] = Field(default_factory=dict)
    stats: Dict[str, Any] = Field(default_factory=dict)


class MangaPageAssets(BaseModel):
    cleanedImageBase64: Optional[str] = None
    colorMaskBase64: Optional[str] = None
    clean_image_url: Optional[str] = None
    mask_image_url: Optional[str] = None
    original_image_url: Optional[str] = None


class MangaPageResponse(BaseModel):
    version: str = "2.0.0"
    status: str = "success"
    meta: MangaPageMeta
    assets: MangaPageAssets
    layers: List[MangaLayer] = Field(default_factory=list)


def to_normalized_box(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> List[int]:
    """Chuyển đổi tọa độ pixel [x1, y1, x2, y2] sang [ymin, xmin, ymax, xmax] trên thang [0..1000]."""
    w_safe = max(1, w)
    h_safe = max(1, h)

    ymin = int(round(max(0.0, min(1000.0, (y1 / h_safe) * 1000.0))))
    xmin = int(round(max(0.0, min(1000.0, (x1 / w_safe) * 1000.0))))
    ymax = int(round(max(0.0, min(1000.0, (y2 / h_safe) * 1000.0))))
    xmax = int(round(max(0.0, min(1000.0, (x2 / w_safe) * 1000.0))))

    # Đảm bảo box hợp lệ
    if ymax <= ymin:
        ymax = min(1000, ymin + 1)
    if xmax <= xmin:
        xmax = min(1000, xmin + 1)

    return [ymin, xmin, ymax, xmax]


def to_pixel_bounds(box_2d: List[int], w: int, h: int) -> PixelBounds:
    """Chuyển đổi [ymin, xmin, ymax, xmax] thang 0..1000 về PixelBounds {x, y, width, height}."""
    ymin, xmin, ymax, xmax = box_2d
    x = int(round((xmin / 1000.0) * w))
    y = int(round((ymin / 1000.0) * h))
    width = max(1, int(round(((xmax - xmin) / 1000.0) * w)))
    height = max(1, int(round(((ymax - ymin) / 1000.0) * h)))
    return PixelBounds(x=x, y=y, width=width, height=height)


def sort_reading_order(
    layers: List[MangaLayer],
    reading_direction: str = "rtl",
    height: int = 1000,
) -> List[MangaLayer]:
    """
    Sắp xếp các layer thoại theo thứ tự đọc tự nhiên chuẩn công nghiệp:
    - 'rtl' (Manga Nhật): Trên xuống Dưới, Phải qua Trái.
    - 'ltr' (Comic / Manhua ngang): Trên xuống Dưới, Trái qua Phải.
    - 'ttb' (Webtoon dọc): Ưu tiên tuyệt đối trục Y từ Trên xuống Dưới.
    """
    if not layers:
        return []

    # Nhóm các box theo dải hàng ngang (Panel Band) dựa trên ngưỡng chồng lấn chiều cao
    # Ngưỡng phân tách dải thường là 8-12% chiều cao trang
    band_height = max(50, int(height * 0.10))

    def get_sort_key(item: MangaLayer):
        ymin, xmin, ymax, xmax = item.box_2d
        y_center = (ymin + ymax) / 2.0
        x_center = (xmin + xmax) / 2.0

        if reading_direction == "rtl":
            # Manga: Cùng một dải hàng (band), box bên phải (x_center lớn) đọc trước (-x_center)
            band_idx = int(y_center // band_height)
            return (band_idx, -x_center, y_center)
        elif reading_direction == "ltr":
            # Comic: Cùng một dải hàng, box bên trái (x_center nhỏ) đọc trước
            band_idx = int(y_center // band_height)
            return (band_idx, x_center, y_center)
        else:
            # Webtoon (ttb): Tuyệt đối theo trục dọc y_center
            return (y_center, x_center)

    sorted_layers = sorted(layers, key=get_sort_key)

    # Đánh lại order_index tuần tự
    for idx, layer in enumerate(sorted_layers, start=1):
        layer.order_index = idx

    return sorted_layers


def compute_sha256(raw_bytes: bytes) -> str:
    """Tính chuỗi băm bảo mật SHA-256 cho ảnh nhị phân."""
    hasher = hashlib.sha256()
    hasher.update(raw_bytes)
    return hasher.hexdigest()
