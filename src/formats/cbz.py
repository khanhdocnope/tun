"""
Xử lý đóng gói truyện tranh sang định dạng CBZ (Comic Book Zip) và PDF.
Chuẩn hóa tương thích 100% với các app đọc truyện (Mihon, Tachiyomi, Kuro Reader, v.v.).
"""

from pathlib import Path
from typing import List, Tuple
import zipfile
from PIL import Image


def export_to_cbz(
    output_path: Path,
    pages: List[Tuple[int, bytes]],
    extension: str = "webp"
) -> Path:
    """
    Đóng gói danh sách ảnh trang truyện vào 1 file .cbz duy nhất.
    
    Args:
        output_path: Đường dẫn file cbz đầu ra.
        pages: List tuple (index, image_bytes).
        extension: Đuôi file ảnh trong zip (webp, jpg, png).
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_STORED) as cbz:
        for idx, img_bytes in sorted(pages, key=lambda x: x[0]):
            filename = f"page_{idx + 1:04d}.{extension}"
            cbz.writestr(filename, img_bytes)

    return output_path
