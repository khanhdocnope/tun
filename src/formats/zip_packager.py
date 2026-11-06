"""
Module đóng gói chương truyện tranh sang định dạng nén ZIP chuẩn.
Hỗ trợ cả chế độ đóng gói hàng loạt (batch) và ghi đệm luồng trực tiếp (streaming)
để tối ưu hóa bộ nhớ RAM (< 80MB) cho toàn bộ hệ thống MoeJect.
"""

from pathlib import Path
import threading
from typing import List, Tuple, Union, Optional
import zipfile


class ZipStreamPackager:
    """
    Bộ đóng gói Streaming cho định dạng ZIP.
    Ghi từng trang ảnh trực tiếp vào file .zip đệm (.tmp) trên đĩa ngay khi tải xong.
    Giải phóng dữ liệu trang khỏi RAM tức thì, bảo đảm cam kết RAM < 80MB.
    """
    def __init__(
        self,
        output_path: Union[str, Path],
        total_pages: int = 0,
        extension: str = "webp"
    ):
        self.output_path = Path(output_path)
        self.temp_path = self.output_path.with_suffix(self.output_path.suffix + ".tmp")
        self.total_pages = total_pages
        self.extension = extension.lstrip(".")
        self.pad_width = max(3, len(str(total_pages))) if total_pages > 0 else 3
        self._lock = threading.Lock()
        self._zip: Optional[zipfile.ZipFile] = None
        self._written_pages = 0
        self._is_closed = False

    def open(self) -> None:
        """Khởi tạo file zip đệm nếu chưa mở."""
        if self._zip is None:
            self.temp_path.parent.mkdir(parents=True, exist_ok=True)
            self._zip = zipfile.ZipFile(self.temp_path, "w", compression=zipfile.ZIP_DEFLATED)

    def __enter__(self) -> "ZipStreamPackager":
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None:
            self.abort()
        else:
            self.close()

    def format_page_name(self, index: int, custom_ext: Optional[str] = None) -> str:
        """Định dạng tên trang tuần tự chuẩn (001.webp, 002.webp,...)."""
        ext = (custom_ext or self.extension).lstrip(".")
        page_num = index + 1 if index >= 0 else abs(index)
        return f"{page_num:0{self.pad_width}d}.{ext}"

    def add_page(self, index: int, data: bytes, custom_ext: Optional[str] = None) -> str:
        """
        Ghi trực tiếp byte của 1 trang ảnh vào file zip đệm và giải phóng RAM.

        Args:
            index: Thứ tự trang (0-based hoặc 1-based).
            data: Dữ liệu nhị phân của ảnh.
            custom_ext: Định dạng đuôi mở rộng riêng (nếu khác với đuôi mặc định).

        Returns:
            Tên file đã được lưu trong file zip (ví dụ '001.webp').
        """
        filename = self.format_page_name(index, custom_ext=custom_ext)
        with self._lock:
            if self._zip is None:
                self.open()
            self._zip.writestr(filename, data)
            self._written_pages += 1
        return filename

    def close(self) -> Path:
        """Đóng file zip và đổi tên từ .tmp sang file đích chính thức."""
        with self._lock:
            if self._zip is not None and not self._is_closed:
                self._zip.close()
                self._is_closed = True

                if self.temp_path.exists():
                    if self.output_path.exists():
                        self.output_path.unlink()
                    self.temp_path.rename(self.output_path)

        return self.output_path

    def abort(self) -> None:
        """Hủy đóng gói khi có lỗi, dọn dẹp file tạm để tránh file rác."""
        with self._lock:
            if self._zip is not None and not self._is_closed:
                try:
                    self._zip.close()
                except Exception:
                    pass
                self._is_closed = True

            if self.temp_path.exists():
                try:
                    self.temp_path.unlink()
                except Exception:
                    pass


def create_chapter_zip(
    output_path: Path,
    pages: List[Tuple[int, bytes]],
    extension: str = "webp"
) -> Path:
    """
    Đóng gói danh sách byte ảnh vào file .zip theo tên chuẩn tuần tự 001.webp, 002.webp,...
    Sử dụng zipfile.ZipFile(..., compression=zipfile.ZIP_DEFLATED).

    Args:
        output_path: Đường dẫn file .zip đầu ra.
        pages: Danh sách tuple (index, image_bytes).
        extension: Đuôi file ảnh trong zip (webp, jpg, png).

    Returns:
        Path dẫn tới file zip đã tạo.
    """
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    sorted_pages = sorted(pages, key=lambda x: x[0])
    total_pages = len(sorted_pages)
    pad_width = max(3, len(str(total_pages)))

    min_idx = min((p[0] for p in sorted_pages), default=0)
    shift = 1 if min_idx == 0 else 0

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
        for idx, img_bytes in sorted_pages:
            page_num = idx + shift
            filename = f"{page_num:0{pad_width}d}.{extension.lstrip('.')}"
            zipf.writestr(filename, img_bytes)

    return out_path
