"""
Bộ tải ảnh đa luồng tối ưu (Multi-threaded Gated Downloader).
Kế thừa tinh hoa từ comix-downloader:
- BoundedSemaphore giới hạn kết nối theo từng Host để chống bị ban IP.
- Retry logic với Exponential Backoff.
- Kiểm tra Magic Bytes chống tải nhầm trang HTML lỗi.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import io
from pathlib import Path
import random
import threading
import time
from typing import List, Tuple, Optional
from urllib.parse import urlparse
from PIL import Image

from .models import ImageFailure, DownloadReport
from .session import get_http_session


class HostConnectionGate:
    """Giới hạn số kết nối đồng thời trên mỗi CDN Domain."""
    def __init__(self, per_host_limit: int = 4):
        self.per_host_limit = per_host_limit
        self._lock = threading.Lock()
        self._gates = {}

    def get_gate(self, url: str) -> threading.BoundedSemaphore:
        host = urlparse(url).netloc.lower() or "unknown_host"
        with self._lock:
            if host not in self._gates:
                self._gates[host] = threading.BoundedSemaphore(self.per_host_limit)
            return self._gates[host]


def validate_image_bytes(data: bytes) -> bool:
    """Xác thực byte đầu vào có phải là định dạng ảnh hợp lệ không."""
    if not data or len(data) < 16:
        return False
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        return True
    except Exception:
        return False


class ConcurrentMangaDownloader:
    def __init__(self, max_image_workers: int = 5, per_host_limit: int = 4, max_retries: int = 3):
        self.max_workers = max_image_workers
        self.max_retries = max_retries
        self.gate_manager = HostConnectionGate(per_host_limit=per_host_limit)
        self.session = get_http_session()

    def download_single_page(self, index: int, url: str) -> Tuple[int, Optional[bytes], Optional[ImageFailure]]:
        """Tải 1 trang ảnh với Exponential Backoff và Gate Limiter."""
        gate = self.gate_manager.get_gate(url)
        host = urlparse(url).netloc

        for attempt in range(1, self.max_retries + 1):
            try:
                with gate:
                    resp = self.session.get(url, timeout=15.0)
                
                if resp.status_code == 200:
                    data = resp.content
                    if validate_image_bytes(data):
                        return index, data, None
                    else:
                        raise ValueError("Dữ liệu trả về không phải là file ảnh hợp lệ (có thể là HTML WAF)")
                elif resp.status_code == 403:
                    # Cloudflare hoặc WAF chặn
                    return index, None, ImageFailure(index, "HTTP_403_WAF", attempt, "Bị Cloudflare/WAF chặn", host)
                else:
                    resp.raise_for_status()

            except Exception as e:
                if attempt == self.max_retries:
                    return index, None, ImageFailure(index, "EXCEPTION", attempt, str(e), host)
                # Exponential backoff + Jitter ngẫu nhiên
                sleep_time = (2 ** attempt) + random.uniform(0.1, 0.5)
                time.sleep(sleep_time)

        return index, None, ImageFailure(index, "MAX_RETRIES", self.max_retries, "Hết lượt retry", host)

    def download_chapter(self, chapter_id: str, image_urls: List[str]) -> DownloadReport:
        """Tải song song toàn bộ các trang trong một chapter."""
        total = len(image_urls)
        report = DownloadReport(chapter_id=chapter_id, total_pages=total)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_idx = {
                executor.submit(self.download_single_page, idx, url): idx
                for idx, url in enumerate(image_urls)
            }

            for future in as_completed(future_to_idx):
                idx, data, failure = future.result()
                if data is not None:
                    report.downloaded_pages.append((idx, data))
                elif failure is not None:
                    report.failures.append(failure)

        # Sắp xếp lại thứ tự các trang theo index tăng dần
        report.downloaded_pages.sort(key=lambda x: x[0])
        return report
