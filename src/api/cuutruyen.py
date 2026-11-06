"""
Connector cho Cứu Truyện (cuutruyen.net) - Nguồn truyện Tiếng Việt có bảo vệ Cloudflare/WAF.
Hỗ trợ tìm kiếm, bóc tách chi tiết truyện, danh sách chapter và link ảnh.
Tự động phát hiện lỗi HTTP 403 WAF để kích hoạt Smart Headless Browser Runner và nạp cookie mới.
"""

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx

from src.api.base import BaseMangaSource
from src.api.browser_runner import bypass_url
from src.core.models import Chapter, MangaInfo, MangaSearchResult
from src.core.session import load_cookies_into_httpx
from src.utils.dns import enable_smart_dns

logger = logging.getLogger(__name__)

# Pattern nhận diện ID manga hoặc chapter
MANGA_URL_PATTERN = re.compile(r"/mangas/(\d+)")
CHAPTER_URL_PATTERN = re.compile(r"/chapters/(\d+)")


class CuutruyenSource(BaseMangaSource):
    """
    Manga Source cho cuutruyen.net.
    Sử dụng REST API v2 kết hợp cơ chế tự động vượt WAF Cloudflare bằng Smart Headless nodriver.
    """

    source_id: str = "cuutruyen"
    source_name: str = "Cuutruyen"
    base_url: str = "https://cuutruyen.net"
    api_url: str = "https://cuutruyen.net/api/v2"
    needs_browser_bypass: bool = True

    def __init__(
        self,
        client: Optional[httpx.AsyncClient] = None,
        timeout: float = 20.0,
        max_waf_retries: int = 2,
    ):
        enable_smart_dns()
        self.timeout = timeout
        self.max_waf_retries = max_waf_retries
        self._owns_client = client is None

        # Khởi tạo httpx AsyncClient kèm headers chuẩn trình duyệt
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
                "Referer": "https://cuutruyen.net/",
            },
            follow_redirects=True,
        )
        # Nạp cookies từ file cf_cookies.dat nếu đã có từ trước
        self._reload_cookies()

    def _reload_cookies(self) -> None:
        """Đọc và nạp lại cookies từ cf_cookies.dat vào AsyncClient."""
        load_cookies_into_httpx(self._client)

    async def close(self) -> None:
        """Giải phóng tài nguyên kết nối HTTP."""
        if self._owns_client and self._client and not self._client.is_closed:
            await self._client.aclose()

    def _extract_manga_id(self, manga_id_or_url: str) -> str:
        """Trích xuất ID số của manga từ URL hoặc ID thuần."""
        clean = manga_id_or_url.strip()
        match = MANGA_URL_PATTERN.search(clean)
        if match:
            return match.group(1)
        digits = re.findall(r"\d+", clean)
        if digits:
            return digits[0]
        raise ValueError(f"Không thể tìm thấy ID Manga hợp lệ từ: {manga_id_or_url}")

    def _extract_chapter_id(self, chapter_id_or_url: str) -> str:
        """Trích xuất ID số của chapter từ URL hoặc ID thuần."""
        clean = chapter_id_or_url.strip()
        match = CHAPTER_URL_PATTERN.search(clean)
        if match:
            return match.group(1)
        digits = re.findall(r"\d+", clean)
        if digits:
            return digits[-1]
        raise ValueError(f"Không thể tìm thấy ID Chapter hợp lệ từ: {chapter_id_or_url}")

    async def _request(
        self, method: str, endpoint: str, **kwargs
    ) -> httpx.Response:
        """
        Thực hiện HTTP request tới Cuutruyen API.
        Nếu phát hiện mã lỗi 403 / 503 hoặc trang Cloudflare Challenge, tự động kích hoạt
        nodriver giải mã WAF, cập nhật cookie và thử lại.
        """
        url = endpoint if endpoint.startswith("http") else f"{self.api_url}{endpoint}"

        for attempt in range(1, self.max_waf_retries + 2):
            try:
                resp = await self._client.request(method, url, **kwargs)

                # Kiểm tra xem có bị Cloudflare WAF chặn không
                is_cf_blocked = (
                    resp.status_code in (403, 503)
                    or "cf-turnstile" in resp.text
                    or "Just a moment..." in resp.text
                    or "Attention Required!" in resp.text
                )

                if is_cf_blocked:
                    if attempt <= self.max_waf_retries:
                        logger.warning(
                            f"[Cuutruyen] Phát hiện Cloudflare WAF (HTTP {resp.status_code}) tại {url}. "
                            f"Đang kích hoạt Smart Headless Browser Bypass (lần {attempt}/{self.max_waf_retries})..."
                        )
                        # Vượt qua Cloudflare bằng nodriver
                        bypass_success = await bypass_url(self.base_url)
                        if bypass_success:
                            # Nạp cookie mới vào session và retry
                            self._reload_cookies()
                            await asyncio.sleep(1.0)
                            continue
                        else:
                            logger.error("[Cuutruyen] Bypass Cloudflare không thành công.")
                    else:
                        resp.raise_for_status()

                if resp.status_code == 200:
                    return resp

                resp.raise_for_status()

            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt > self.max_waf_retries:
                    logger.error(f"[Cuutruyen] Lỗi mạng khi kết nối tới {url}: {e}")
                    raise
                logger.info(f"[Cuutruyen] Lỗi mạng ({e}), thử lại lần {attempt}...")
                await asyncio.sleep(1.5)

        raise RuntimeError(f"[Cuutruyen] Không thể hoàn thành request tới {url} sau các lần thử.")

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm truyện trên Cuutruyen.
        Nếu query rỗng, trả về danh sách truyện mới cập nhật.
        """
        if query and query.strip():
            endpoint = "/mangas/search"
            params = {"q": query.strip(), "page": page}
        else:
            endpoint = "/mangas/recently_updated"
            params = {"page": page, "per_page": 24}

        resp = await self._request("GET", endpoint, params=params)
        body = resp.json()
        data = body.get("data", [])

        results: List[MangaSearchResult] = []
        for item in data:
            manga_id = str(item.get("id"))
            title = item.get("name") or f"Manga #{manga_id}"
            cover_url = item.get("cover_url") or item.get("cover_mobile_url")
            newest_ch = item.get("newest_chapter_number")
            author_name = item.get("author_name")
            authors = [author_name] if author_name else []

            results.append(
                MangaSearchResult(
                    id=manga_id,
                    title=title,
                    url=f"{self.base_url}/mangas/{manga_id}",
                    cover_url=cover_url,
                    latest_chapter=str(newest_ch) if newest_ch else None,
                    description=None,
                    authors=authors,
                    genres=[],
                )
            )

        return results

    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Lấy thông tin chi tiết manga và toàn bộ danh sách chapters.
        """
        manga_id = self._extract_manga_id(manga_id_or_url)

        # 1. Lấy thông tin cơ bản của bộ truyện
        resp = await self._request("GET", f"/mangas/{manga_id}")
        data = resp.json().get("data", {})

        title = data.get("name") or f"Manga #{manga_id}"
        cover_url = data.get("cover_url") or data.get("cover_mobile_url")
        description = data.get("full_description") or data.get("description")

        # Tác giả
        author_data = data.get("author")
        authors: List[str] = []
        if isinstance(author_data, dict):
            auth_name = author_data.get("name")
            if auth_name:
                authors.append(auth_name)
        elif isinstance(author_data, str) and author_data:
            authors.append(author_data)

        # Thể loại (tags)
        genres: List[str] = []
        for tag in data.get("tags", []):
            if isinstance(tag, dict) and tag.get("name"):
                genres.append(tag["name"])
            elif isinstance(tag, str):
                genres.append(tag)

        # 2. Lấy danh sách chapters của truyện
        chapters = await self._fetch_all_chapters(manga_id)

        return MangaInfo(
            id=manga_id,
            title=title,
            url=f"{self.base_url}/mangas/{manga_id}",
            cover_url=cover_url,
            description=description,
            authors=authors,
            genres=genres,
            chapters=chapters,
        )

    async def _fetch_all_chapters(self, manga_id: str) -> List[Chapter]:
        """Lấy danh sách tất cả chapters từ endpoint /api/v2/mangas/{manga_id}/chapters."""
        resp = await self._request("GET", f"/mangas/{manga_id}/chapters")
        data = resp.json().get("data", [])

        chapters: List[Chapter] = []
        for ch in data:
            ch_id = str(ch.get("id"))
            ch_num = str(ch.get("number") or "0")
            raw_title = ch.get("name")
            title = f"Chương {ch_num}" + (f": {raw_title}" if raw_title else "")

            chapters.append(
                Chapter(
                    id=ch_id,
                    title=title,
                    chapter_number=ch_num,
                    url=f"{self.base_url}/mangas/{manga_id}/chapters/{ch_id}",
                    scanlator=None,
                    pages=[],
                )
            )

        # Sắp xếp chapters tăng dần theo số thứ tự
        def parse_num(c: Chapter) -> float:
            try:
                nums = re.findall(r"\d+(?:\.\d+)?", c.chapter_number)
                return float(nums[0]) if nums else 999999.0
            except (IndexError, ValueError):
                return 999999.0

        chapters.sort(key=parse_num)
        return chapters

    async def get_chapter_pages(self, chapter_id_or_url: str) -> List[str]:
        """
        Trích xuất danh sách liên kết ảnh đầy đủ của một chapter.
        """
        chapter_id = self._extract_chapter_id(chapter_id_or_url)
        resp = await self._request("GET", f"/chapters/{chapter_id}")
        data = resp.json().get("data", {})
        pages_raw = data.get("pages", [])

        # Sắp xếp các trang theo thứ tự order
        pages_sorted = sorted(pages_raw, key=lambda p: p.get("order", 0))

        image_urls: List[str] = []
        for p in pages_sorted:
            url = p.get("image_url") or p.get("src")
            if url:
                image_urls.append(url)

        if not image_urls:
            logger.warning(f"[Cuutruyen] Không tìm thấy ảnh nào trong chapter {chapter_id}")

        return image_urls
