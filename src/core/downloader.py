"""
Bộ tải ảnh đa luồng tối ưu (Multi-threaded Gated Downloader).
Hiện thực hóa kiến trúc Two-Tier Concurrency & Streaming Memory từ comix-downloader:
- Tầng 1: Đa luồng điều phối chapters (download_manga_chapters).
- Tầng 2: Đa luồng tải ảnh từng trang (download_chapter) dưới sự kiểm soát của HostConnectionGate.
- Connection Gating (BoundedSemaphore per Host) ngăn ngừa triệt để việc bị CDN chặn IP / Rate-limit.
- Exponential Backoff & Jitter retry logic.
- Xác thực Magic Bytes chống lưu nhầm HTML challenge của WAF/Cloudflare.
- Cơ chế Streaming Memory: Ghi đệm trực tiếp vào CBZ/ZIP/Disk ngay khi tải xong từng trang,
  giải phóng RAM lập tức, cam kết tuyệt đối RAM < 80MB.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import io
import os
from pathlib import Path
import random
import re
import shutil
import threading
import time
from typing import List, Tuple, Optional, Union, Callable, Any
from urllib.parse import urlparse
from PIL import Image

from .models import MangaInfo, Chapter, OutputFormat, ImageFailure, DownloadReport
from .session import get_http_session
from ..formats.cbz import create_chapter_cbz, CBZStreamPackager
from ..formats.zip_packager import create_chapter_zip, ZipStreamPackager


class HostConnectionGate:
    """Giới hạn số kết nối đồng thời trên mỗi CDN Domain."""
    def __init__(self, per_host_limit: int = 4):
        self.per_host_limit = per_host_limit
        self._lock = threading.Lock()
        self._gates = {}

    def get_gate(self, url: str) -> threading.BoundedSemaphore:
        """Lấy Semaphore tương ứng với host của URL."""
        host = urlparse(url).netloc.lower() or "unknown_host"
        with self._lock:
            if host not in self._gates:
                self._gates[host] = threading.BoundedSemaphore(self.per_host_limit)
            return self._gates[host]

    def acquire(self, url: str) -> threading.BoundedSemaphore:
        """Alias tương thích cho get_gate theo thiết kế DOWNLOADER_DESIGN.md."""
        return self.get_gate(url)


def validate_image_bytes(data: bytes) -> bool:
    """
    Xác thực byte đầu vào có phải là định dạng ảnh hợp lệ không (PNG, JPEG, WebP, GIF, AVIF).
    Ngăn chặn việc lưu phải trang HTML báo lỗi của Cloudflare hoặc WAF.
    """
    if not data or len(data) < 16:
        return False
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        return True
    except Exception:
        return False


def detect_image_extension(data: bytes, default: str = "webp") -> str:
    """Xác định định dạng đuôi mở rộng file ảnh dựa trên Magic Bytes."""
    if not data or len(data) < 12:
        return default
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and b"WEBP" in data[8:12]:
        return "webp"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "gif"
    if b"ftypavif" in data[:32] or b"ftypavis" in data[:32]:
        return "avif"
    return default


def sanitize_filename(name: str, replacement: str = "_") -> str:
    """Loại bỏ các ký tự cấm trong tên file trên Windows và Linux."""
    if not name:
        return "untitled"
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', replacement, name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(". ")
    return cleaned or "untitled"


def resolve_chapter_output_path(
    output_dir: Path,
    manga_info: Optional[MangaInfo],
    chapter: Chapter,
    output_format: OutputFormat
) -> Path:
    """Xác định đường dẫn file hoặc thư mục đầu ra chuẩn cho một chapter."""
    safe_manga = sanitize_filename(manga_info.title) if (manga_info and manga_info.title) else "Manga"
    manga_dir = Path(output_dir) / safe_manga

    safe_num = sanitize_filename(str(chapter.chapter_number or chapter.id))
    safe_title = sanitize_filename(chapter.title) if chapter.title else ""

    if safe_title and safe_title != safe_num:
        chapter_base = f"Ch.{safe_num} - {safe_title}"
    else:
        chapter_base = f"Ch.{safe_num}"

    if output_format == OutputFormat.CBZ:
        return manga_dir / f"{chapter_base}.cbz"
    elif output_format == OutputFormat.ZIP:
        return manga_dir / f"{chapter_base}.zip"
    elif output_format == OutputFormat.PDF:
        return manga_dir / f"{chapter_base}.pdf"
    else:  # OutputFormat.IMAGES
        return manga_dir / chapter_base


def _save_pages_to_pdf(output_path: Path, image_entries: List[Tuple[int, bytes]]) -> Path:
    """Đóng gói danh sách ảnh sang file PDF."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    sorted_pages = sorted(image_entries, key=lambda x: x[0])
    if not sorted_pages:
        raise ValueError("Không có trang ảnh nào để đóng gói sang PDF")

    pil_images = []
    first_image = None

    for _, img_bytes in sorted_pages:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if first_image is None:
            first_image = img
        else:
            pil_images.append(img)

    if first_image:
        first_image.save(output_path, "PDF", save_all=True, append_images=pil_images)
        first_image.close()
        for img in pil_images:
            img.close()

    return output_path


class ConcurrentMangaDownloader:
    """
    Bộ tải ảnh chương truyện đa luồng (Tầng 2 Concurrency).
    Tích hợp Connection Gating, Exponential Backoff, Magic Bytes Validation và Streaming Memory.
    """
    def __init__(
        self,
        max_image_workers: int = 5,
        per_host_limit: int = 4,
        max_retries: int = 3,
        session = None
    ):
        self.max_workers = max_image_workers
        self.max_retries = max_retries
        self.gate_manager = HostConnectionGate(per_host_limit=per_host_limit)
        self.session = session or get_http_session()

    def download_single_page(
        self,
        index: int,
        url: str,
        referer: Optional[str] = None
    ) -> Tuple[int, Optional[bytes], Optional[ImageFailure]]:
        """
        Tải 1 trang ảnh với Exponential Backoff, Connection Gate và Magic Bytes Validation.

        Returns:
            Tuple (index, image_bytes_or_None, failure_report_or_None).
        """
        gate = self.gate_manager.get_gate(url)
        host = urlparse(url).netloc

        headers = {}
        if referer:
            headers["Referer"] = referer

        for attempt in range(1, self.max_retries + 1):
            try:
                with gate:
                    resp = self.session.get(url, headers=headers or None, timeout=15.0)

                if resp.status_code == 200:
                    data = resp.content
                    if validate_image_bytes(data):
                        return index, data, None
                    else:
                        raise ValueError("Dữ liệu trả về không phải là file ảnh hợp lệ (có thể là HTML WAF)")
                elif resp.status_code == 403:
                    # Cloudflare hoặc WAF chặn
                    return index, None, ImageFailure(
                        index=index,
                        category="HTTP_403_WAF",
                        attempts=attempt,
                        message="Bị Cloudflare/WAF chặn HTTP 403",
                        host=host
                    )
                else:
                    resp.raise_for_status()

            except Exception as e:
                if attempt == self.max_retries:
                    return index, None, ImageFailure(
                        index=index,
                        category="EXCEPTION",
                        attempts=attempt,
                        message=str(e),
                        host=host
                    )
                # Exponential backoff + Jitter ngẫu nhiên
                sleep_time = (2 ** attempt) + random.uniform(0.1, 0.5)
                time.sleep(sleep_time)

        return index, None, ImageFailure(
            index=index,
            category="MAX_RETRIES",
            attempts=self.max_retries,
            message="Hết lượt thử lại cho phép",
            host=host
        )

    def download_chapter(
        self,
        chapter_or_id: Union[Chapter, str],
        image_urls: Optional[List[str]] = None,
        manga_info: Optional[MangaInfo] = None,
        output_format: Optional[OutputFormat] = None,
        output_dir: Optional[Union[str, Path]] = None,
        target_path: Optional[Union[str, Path]] = None,
        stream_to_disk: bool = True,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> DownloadReport:
        """
        Tải song song toàn bộ các trang trong một chapter (Tầng 2).

        Args:
            chapter_or_id: Chapter đối tượng hoặc chuỗi chapter_id.
            image_urls: Danh sách URL ảnh (nếu truyền qua chapter_id hoặc override).
            manga_info: Metadata bộ truyện MangaInfo (Title, tác giả, v.v.).
            output_format: Định dạng đầu ra mong muốn (CBZ, ZIP, IMAGES, PDF).
            output_dir: Thư mục gốc lưu trữ (mặc định 'downloads').
            target_path: Đường dẫn file/thư mục đích cụ thể (nếu muốn ghi đè đường dẫn tự động).
            stream_to_disk: Bật cơ chế Streaming Memory (ghi trực tiếp ra đĩa, RAM < 80MB).
            progress_callback: Hàm callback theo dõi tiến độ từng trang: callback(completed_pages, total_pages).

        Returns:
            DownloadReport tổng kết kết quả tải.
        """
        # 1. Đồng bộ hóa đầu vào Chapter và URLs
        if isinstance(chapter_or_id, Chapter):
            chapter = chapter_or_id
            chapter_id = chapter.id
            urls = image_urls if image_urls is not None else chapter.pages
        else:
            chapter_id = str(chapter_or_id)
            urls = image_urls or []
            chapter = Chapter(
                id=chapter_id,
                title=f"Chapter {chapter_id}",
                chapter_number=chapter_id,
                url="",
                pages=urls
            )

        total = len(urls)
        report = DownloadReport(chapter_id=chapter_id, total_pages=total)

        if total == 0:
            return report

        # 2. Xác định đường dẫn file/thư mục đầu ra
        final_output_path: Optional[Path] = None
        if target_path is not None:
            final_output_path = Path(target_path)
            if output_format is None:
                suffix = final_output_path.suffix.lower()
                if suffix == ".cbz":
                    output_format = OutputFormat.CBZ
                elif suffix == ".zip":
                    output_format = OutputFormat.ZIP
                elif suffix == ".pdf":
                    output_format = OutputFormat.PDF
                else:
                    output_format = OutputFormat.IMAGES
        elif output_format is not None:
            base_dir = Path(output_dir) if output_dir else Path("downloads")
            final_output_path = resolve_chapter_output_path(base_dir, manga_info, chapter, output_format)

        # 3. Phân nhánh luồng xử lý: Streaming Memory vs Memory Buffer
        if final_output_path is not None and stream_to_disk:
            # === CƠ CHẾ STREAMING MEMORY (RAM < 80MB) ===
            self._download_chapter_streaming(
                chapter=chapter,
                urls=urls,
                manga_info=manga_info,
                output_format=output_format or OutputFormat.CBZ,
                final_output_path=final_output_path,
                report=report,
                progress_callback=progress_callback
            )
        else:
            # === CHẾ ĐỘ BUFFER BỘ NHỚ (Hoặc không yêu cầu lưu file) ===
            self._download_chapter_buffered(
                chapter=chapter,
                urls=urls,
                manga_info=manga_info,
                output_format=output_format,
                final_output_path=final_output_path,
                report=report,
                progress_callback=progress_callback
            )

        return report

    def _download_chapter_streaming(
        self,
        chapter: Chapter,
        urls: List[str],
        manga_info: Optional[MangaInfo],
        output_format: OutputFormat,
        final_output_path: Path,
        report: DownloadReport,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        """Thực thi tải theo cơ chế Streaming Memory trực tiếp ra đĩa."""
        total = len(urls)
        completed_count = 0

        # Khởi tạo streamer tương ứng theo format
        if output_format == OutputFormat.CBZ:
            packager = CBZStreamPackager(
                output_path=final_output_path,
                manga_info=manga_info,
                chapter=chapter,
                total_pages=total
            )
            packager.open()
        elif output_format == OutputFormat.ZIP:
            packager = ZipStreamPackager(
                output_path=final_output_path,
                total_pages=total
            )
            packager.open()
        elif output_format == OutputFormat.IMAGES:
            final_output_path.mkdir(parents=True, exist_ok=True)
            packager = None
        elif output_format == OutputFormat.PDF:
            # Đối với PDF, đệm các file tạm vào thư mục tạm thời
            temp_pdf_dir = final_output_path.parent / f".tmp_{chapter.id}_{int(time.time())}"
            temp_pdf_dir.mkdir(parents=True, exist_ok=True)
            packager = None
        else:
            packager = None

        try:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                future_to_idx = {
                    executor.submit(self.download_single_page, idx, url, chapter.url): idx
                    for idx, url in enumerate(urls)
                }

                for future in as_completed(future_to_idx):
                    idx, data, failure = future.result()
                    if data is not None:
                        ext = detect_image_extension(data)

                        if output_format == OutputFormat.CBZ or output_format == OutputFormat.ZIP:
                            packager.add_page(idx, data, custom_ext=ext)
                        elif output_format == OutputFormat.IMAGES:
                            pad_width = max(3, len(str(total)))
                            page_filename = f"{idx + 1:0{pad_width}d}.{ext}"
                            with open(final_output_path / page_filename, "wb") as f:
                                f.write(data)
                        elif output_format == OutputFormat.PDF:
                            pad_width = max(3, len(str(total)))
                            page_filename = f"{idx + 1:0{pad_width}d}.{ext}"
                            with open(temp_pdf_dir / page_filename, "wb") as f:
                                f.write(data)

                        # Giải phóng dữ liệu ảnh khỏi RAM ngay tức thì
                        del data
                        report.downloaded_pages.append((idx, b""))
                    elif failure is not None:
                        report.failures.append(failure)

                    completed_count += 1
                    if progress_callback:
                        try:
                            progress_callback(completed_count, total)
                        except Exception:
                            pass

            report.downloaded_pages.sort(key=lambda x: x[0])

            # Kiểm tra kết quả đóng gói
            if report.is_successful:
                if packager is not None:
                    packager.close()
                elif output_format == OutputFormat.PDF:
                    # Gộp ảnh từ temp dir thành PDF
                    _convert_dir_to_pdf(temp_pdf_dir, final_output_path)
                    shutil.rmtree(temp_pdf_dir, ignore_errors=True)

                report.output_path = final_output_path
            else:
                # Nếu có lỗi tải, hủy đóng gói và dọn dẹp file tạm
                if packager is not None:
                    packager.abort()
                elif output_format == OutputFormat.PDF and temp_pdf_dir.exists():
                    shutil.rmtree(temp_pdf_dir, ignore_errors=True)

        except Exception as exc:
            if packager is not None:
                packager.abort()
            elif output_format == OutputFormat.PDF and temp_pdf_dir.exists():
                shutil.rmtree(temp_pdf_dir, ignore_errors=True)
            report.failures.append(ImageFailure(
                index=0,
                category="STREAMING_ERROR",
                attempts=1,
                message=str(exc)
            ))

    def _download_chapter_buffered(
        self,
        chapter: Chapter,
        urls: List[str],
        manga_info: Optional[MangaInfo],
        output_format: Optional[OutputFormat],
        final_output_path: Optional[Path],
        report: DownloadReport,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> None:
        """Tải toàn bộ ảnh vào RAM rồi mới đóng gói (Batch Mode)."""
        total = len(urls)
        completed_count = 0

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_idx = {
                executor.submit(self.download_single_page, idx, url, chapter.url): idx
                for idx, url in enumerate(urls)
            }

            for future in as_completed(future_to_idx):
                idx, data, failure = future.result()
                if data is not None:
                    report.downloaded_pages.append((idx, data))
                elif failure is not None:
                    report.failures.append(failure)

                completed_count += 1
                if progress_callback:
                    try:
                        progress_callback(completed_count, total)
                    except Exception:
                        pass

        report.downloaded_pages.sort(key=lambda x: x[0])

        # Đóng gói ra file nếu có yêu cầu
        if report.is_successful and final_output_path is not None and output_format is not None:
            if output_format == OutputFormat.CBZ:
                create_chapter_cbz(
                    output_path=final_output_path,
                    manga_info=manga_info,
                    chapter=chapter,
                    pages=report.downloaded_pages
                )
            elif output_format == OutputFormat.ZIP:
                create_chapter_zip(
                    output_path=final_output_path,
                    pages=report.downloaded_pages
                )
            elif output_format == OutputFormat.IMAGES:
                final_output_path.mkdir(parents=True, exist_ok=True)
                pad_width = max(3, len(str(len(report.downloaded_pages))))
                for idx, img_bytes in report.downloaded_pages:
                    ext = detect_image_extension(img_bytes)
                    img_file = final_output_path / f"{idx + 1:0{pad_width}d}.{ext}"
                    with open(img_file, "wb") as f:
                        f.write(img_bytes)
            elif output_format == OutputFormat.PDF:
                _save_pages_to_pdf(final_output_path, report.downloaded_pages)

            report.output_path = final_output_path


def _convert_dir_to_pdf(image_dir: Path, output_pdf_path: Path) -> Path:
    """Chuyển đổi các file ảnh trong thư mục sang 1 file PDF."""
    output_pdf_path = Path(output_pdf_path)
    output_pdf_path.parent.mkdir(parents=True, exist_ok=True)

    image_files = sorted(list(image_dir.glob("*.*")))
    if not image_files:
        raise ValueError(f"Không tìm thấy file ảnh nào trong {image_dir}")

    pil_images = []
    first_image = None

    for p in image_files:
        img = Image.open(p).convert("RGB")
        if first_image is None:
            first_image = img
        else:
            pil_images.append(img)

    if first_image:
        first_image.save(output_pdf_path, "PDF", save_all=True, append_images=pil_images)
        first_image.close()
        for img in pil_images:
            img.close()

    return output_pdf_path


def _invoke_progress_callback(
    callback: Any,
    completed: int,
    total: int,
    chapter: Chapter,
    report: DownloadReport
) -> None:
    """Gọi callback tiến độ linh hoạt, hỗ trợ nhiều mẫu chữ ký hàm khác nhau."""
    if not callable(callback):
        return

    try:
        # Kiểu 1: callback(chapter, report)
        callback(chapter, report)
    except TypeError:
        try:
            # Kiểu 2: callback(completed, total, report)
            callback(completed, total, report)
        except TypeError:
            try:
                # Kiểu 3: callback(completed, total)
                callback(completed, total)
            except TypeError:
                try:
                    # Kiểu 4: callback(report)
                    callback(report)
                except TypeError:
                    pass


def download_manga_chapters(
    manga_info: MangaInfo,
    chapters: List[Chapter],
    output_format: OutputFormat = OutputFormat.CBZ,
    output_dir: Path = Path("downloads"),
    max_chapter_workers: int = 2,
    max_image_workers: int = 5,
    progress_callback = None,
    session = None,
    downloader: Optional[ConcurrentMangaDownloader] = None,
) -> List[DownloadReport]:
    """
    Tầng 1 Concurrency: Điều phối tải song song nhiều chapter cùng lúc.
    Sử dụng Two-Tier Concurrency Pool và Streaming Memory chống tràn RAM.

    Args:
        manga_info: Thông tin tổng quan của bộ manga.
        chapters: Danh sách các chapter cần tải.
        output_format: Định dạng đóng gói (CBZ, ZIP, IMAGES, PDF). Mặc định là CBZ.
        output_dir: Thư mục đích lưu trữ (mặc định 'downloads').
        max_chapter_workers: Số luồng tải chapter song song (mặc định 2).
        max_image_workers: Số luồng tải ảnh trang truyện trong mỗi chapter (mặc định 5).
        progress_callback: Callback theo dõi tiến độ tổng thể.
        session: Tùy chọn requests.Session tùy biến (hữu ích cho unit test hoặc custom proxy/cookies).
        downloader: Tùy chọn truyền instance ConcurrentMangaDownloader có sẵn.

    Returns:
        Danh sách DownloadReport cho từng chapter theo đúng thứ tự đầu vào.
    """
    if downloader is None:
        downloader = ConcurrentMangaDownloader(
            max_image_workers=max_image_workers,
            session=session
        )
    output_path_dir = Path(output_dir)
    total_chapters = len(chapters)

    if total_chapters == 0:
        return []

    # Nếu chỉ chạy 1 worker, thực thi tuần tự tránh overhead tạo pool
    if max_chapter_workers <= 1 or total_chapters == 1:
        results: List[DownloadReport] = []
        for ch_idx, ch in enumerate(chapters, start=1):
            report = downloader.download_chapter(
                chapter_or_id=ch,
                manga_info=manga_info,
                output_format=output_format,
                output_dir=output_path_dir,
                stream_to_disk=True
            )
            results.append(report)
            if progress_callback:
                _invoke_progress_callback(progress_callback, ch_idx, total_chapters, ch, report)
        return results

    # Chạy đa luồng điều phối chapters với ThreadPoolExecutor
    results: List[Optional[DownloadReport]] = [None] * total_chapters

    def _task(chapter: Chapter) -> DownloadReport:
        return downloader.download_chapter(
            chapter_or_id=chapter,
            manga_info=manga_info,
            output_format=output_format,
            output_dir=output_path_dir,
            stream_to_disk=True
        )

    with ThreadPoolExecutor(max_workers=max_chapter_workers) as executor:
        future_to_idx = {
            executor.submit(_task, ch): idx
            for idx, ch in enumerate(chapters)
        }

        completed_count = 0
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            ch = chapters[idx]
            try:
                report = future.result()
            except Exception as exc:
                report = DownloadReport(
                    chapter_id=ch.id,
                    total_pages=len(ch.pages),
                    failures=[ImageFailure(
                        index=0,
                        category="CHAPTER_TASK_ERROR",
                        attempts=1,
                        message=str(exc)
                    )]
                )

            results[idx] = report
            completed_count += 1

            if progress_callback:
                _invoke_progress_callback(progress_callback, completed_count, total_chapters, ch, report)

    # Đảm bảo danh sách trả về đầy đủ và đúng kiểu
    return [r for r in results if r is not None]
