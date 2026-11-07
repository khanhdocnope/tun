"""
Connector MangaDex sử dụng trực tiếp MangaDex REST API v5 (https://api.mangadex.org).
Hỗ trợ tìm kiếm, bóc tách chi tiết truyện, danh sách chapter ưu tiên Tiếng Việt ('vi')
hoặc Tiếng Anh ('en'), và trích xuất URL ảnh chất lượng cao qua MangaDex@Home.
Xử lý tự động HTTP 429 Rate Limit và Exponential Backoff.
"""

import asyncio
import logging
import random
import re
from typing import Any, Dict, List, Optional

import httpx

from src.api.base import BaseMangaSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult

logger = logging.getLogger(__name__)

UUID_REGEX = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class MangaDexSource(BaseMangaSource):
    """
    Source connector cho MangaDex qua REST API v5.
    Không yêu cầu trình duyệt để vượt qua WAF vì MangaDex cung cấp Public API chính thức.
    """

    source_id: str = "mangadex"
    source_name: str = "MangaDex"
    base_url: str = "https://mangadex.org"
    api_url: str = "https://api.mangadex.org"
    uploads_url: str = "https://uploads.mangadex.org"
    needs_browser_bypass: bool = False

    def __init__(
        self,
        client: Optional[httpx.AsyncClient] = None,
        timeout: float = 25.0,
        max_retries: int = 4,
    ):
        self.timeout = timeout
        self.max_retries = max_retries
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={
                "User-Agent": "MoeJect/1.0.0 (Manga Ingestion & AI Reader)",
                "Accept": "application/json",
            },
            follow_redirects=True,
        )

    async def close(self) -> None:
        """Đóng httpx client nếu được tạo nội bộ."""
        if self._owns_client and self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(
        self, method: str, endpoint: str, **kwargs
    ) -> httpx.Response:
        """
        Thực hiện HTTP request tới MangaDex API với cơ chế Exponential Backoff & 429 handling.
        """
        url = endpoint if endpoint.startswith("http") else f"{self.api_url}{endpoint}"

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = await self._client.request(method, url, **kwargs)

                if resp.status_code == 200:
                    return resp

                if resp.status_code == 429:
                    # Rate limit từ MangaDex API (~5 requests/second)
                    retry_after_header = resp.headers.get("Retry-After")
                    if retry_after_header:
                        try:
                            delay = float(retry_after_header)
                        except ValueError:
                            delay = 2.0
                    else:
                        delay = (1.5 * (2 ** (attempt - 1))) + random.uniform(0.2, 0.6)

                    logger.warning(
                        f"[MangaDex] 429 Too Many Requests tại {url}. Chờ {delay:.2f}s trước khi thử lại (lần {attempt}/{self.max_retries})"
                    )
                    await asyncio.sleep(delay)
                    continue

                if resp.status_code >= 500:
                    # Lỗi máy chủ MangaDex tạm thời
                    delay = (1.0 * (2 ** (attempt - 1))) + random.uniform(0.1, 0.5)
                    logger.warning(
                        f"[MangaDex] Server error {resp.status_code} tại {url}. Đang retry sau {delay:.2f}s"
                    )
                    await asyncio.sleep(delay)
                    continue

                resp.raise_for_status()

            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt == self.max_retries:
                    logger.error(f"[MangaDex] Mất kết nối tới {url}: {e}")
                    raise
                delay = (1.0 * (2 ** (attempt - 1))) + random.uniform(0.1, 0.5)
                logger.info(f"[MangaDex] Lỗi mạng ({e}), thử lại lần {attempt + 1} sau {delay:.2f}s...")
                await asyncio.sleep(delay)

        raise RuntimeError(f"[MangaDex] Vượt quá số lần thử lại ({self.max_retries}) cho {url}")

    def _extract_uuid(self, identifier_or_url: str) -> str:
        """Trích xuất UUID từ chuỗi ID thuần hoặc URL MangaDex."""
        match = UUID_REGEX.search(identifier_or_url)
        if match:
            return match.group(0).lower()
        raise ValueError(f"Không thể trích xuất MangaDex UUID hợp lệ từ: {identifier_or_url}")

    @staticmethod
    def _pick_localized_string(
        mapping: Optional[Dict[str, str]],
        priorities: Optional[List[str]] = None,
        default: str = "",
    ) -> str:
        """Chọn chuỗi đa ngôn ngữ theo độ ưu tiên (mặc định: vi -> en -> ja-ro -> đầu tiên)."""
        if not mapping or not isinstance(mapping, dict):
            return default

        langs = priorities or ["vi", "en", "ja-ro"]
        for lang in langs:
            if lang in mapping and mapping[lang]:
                return mapping[lang]

        # Lấy giá trị đầu tiên có sẵn
        for val in mapping.values():
            if val:
                return val
        return default

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm manga trên MangaDex.
        """
        limit = 20
        offset = max(0, (page - 1) * limit)

        params: Dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "includes[]": ["cover_art", "author", "artist"],
            "contentRating[]": ["safe", "suggestive", "erotica"],
        }
        if query and query.strip():
            params["title"] = query.strip()
            params["order[relevance]"] = "desc"
        else:
            # Khi không tìm kiếm: Trả về danh sách truyện vừa cập nhật chương mới nhất (Mới -> Cũ)
            params["order[latestUploadedChapter]"] = "desc"

        resp = await self._request("GET", "/manga", params=params)
        data = resp.json().get("data", [])

        results: List[MangaSearchResult] = []
        for item in data:
            manga_id = item.get("id")
            attrs = item.get("attributes", {})
            relationships = item.get("relationships", [])

            # Tiêu đề
            title = self._pick_localized_string(
                attrs.get("title"), priorities=["vi", "en", "ja-ro"]
            )
            if not title:
                # Tìm trong altTitles
                alt_titles = attrs.get("altTitles", [])
                for alt in alt_titles:
                    title = self._pick_localized_string(alt)
                    if title:
                        break
            if not title:
                title = f"MangaDex #{manga_id}"

            # Mô tả
            description = self._pick_localized_string(
                attrs.get("description"), priorities=["vi", "en"]
            )

            # Bìa truyện (Cover Art)
            cover_url = None
            for rel in relationships:
                if rel.get("type") == "cover_art":
                    file_name = rel.get("attributes", {}).get("fileName")
                    if file_name:
                        cover_url = f"{self.uploads_url}/covers/{manga_id}/{file_name}.512.jpg"
                        break

            # Tác giả
            authors: List[str] = []
            for rel in relationships:
                if rel.get("type") in ("author", "artist"):
                    name = rel.get("attributes", {}).get("name")
                    if name and name not in authors:
                        authors.append(name)

            # Thể loại (Tags)
            genres: List[str] = []
            for tag in attrs.get("tags", []):
                tag_attrs = tag.get("attributes", {})
                if tag_attrs.get("group") == "genre":
                    tag_name = self._pick_localized_string(tag_attrs.get("name"), ["en"])
                    if tag_name:
                        genres.append(tag_name)

            # Last chapter
            latest_chapter = attrs.get("lastChapter")

            results.append(
                MangaSearchResult(
                    id=manga_id,
                    title=title,
                    url=f"{self.base_url}/title/{manga_id}",
                    cover_url=cover_url,
                    latest_chapter=str(latest_chapter) if latest_chapter else None,
                    description=description or None,
                    authors=authors,
                    genres=genres,
                )
            )

        return results

    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Lấy thông tin chi tiết của manga và toàn bộ danh sách chapter.
        Ưu tiên chapter tiếng Việt ('vi'), sau đó đến tiếng Anh ('en').
        """
        manga_id = self._extract_uuid(manga_id_or_url)

        # 1. Lấy thông tin manga
        resp = await self._request(
            "GET",
            f"/manga/{manga_id}",
            params={"includes[]": ["cover_art", "author", "artist"]},
        )
        item = resp.json().get("data", {})
        attrs = item.get("attributes", {})
        relationships = item.get("relationships", [])

        title = self._pick_localized_string(
            attrs.get("title"), priorities=["vi", "en", "ja-ro"]
        ) or f"MangaDex #{manga_id}"

        description = self._pick_localized_string(
            attrs.get("description"), priorities=["vi", "en"]
        )

        cover_url = None
        for rel in relationships:
            if rel.get("type") == "cover_art":
                file_name = rel.get("attributes", {}).get("fileName")
                if file_name:
                    cover_url = f"{self.uploads_url}/covers/{manga_id}/{file_name}.512.jpg"
                    break

        authors: List[str] = []
        for rel in relationships:
            if rel.get("type") in ("author", "artist"):
                name = rel.get("attributes", {}).get("name")
                if name and name not in authors:
                    authors.append(name)

        genres: List[str] = []
        for tag in attrs.get("tags", []):
            tag_attrs = tag.get("attributes", {})
            if tag_attrs.get("group") == "genre":
                tag_name = self._pick_localized_string(tag_attrs.get("name"), ["en"])
                if tag_name:
                    genres.append(tag_name)

        # 2. Lấy danh sách chapter: Ưu tiên tiếng Việt ('vi'), sau đó tiếng Anh ('en')
        raw_chapters = await self._fetch_all_chapters(manga_id, languages=["vi", "en"])

        # Lọc và nhóm chapter:
        # Nếu có bản dịch Tiếng Việt, ưu tiên Tiếng Việt. Với các chapter không có bản 'vi', dùng bản 'en'.
        chapters = self._process_chapters(raw_chapters)

        return MangaInfo(
            id=manga_id,
            title=title,
            url=f"{self.base_url}/title/{manga_id}",
            cover_url=cover_url,
            description=description or None,
            authors=authors,
            genres=genres,
            chapters=chapters,
        )

    async def _fetch_all_chapters(
        self, manga_id: str, languages: List[str]
    ) -> List[Dict[str, Any]]:
        """Lấy tất cả chapters của manga theo ngôn ngữ mong muốn (hỗ trợ phân trang feed)."""
        limit = 500
        offset = 0
        all_data: List[Dict[str, Any]] = []

        while True:
            params: Dict[str, Any] = {
                "limit": limit,
                "offset": offset,
                "translatedLanguage[]": languages,
                "order[chapter]": "asc",
                "includes[]": ["scanlation_group"],
                "contentRating[]": ["safe", "suggestive", "erotica"],
            }
            resp = await self._request("GET", f"/manga/{manga_id}/feed", params=params)
            body = resp.json()
            data = body.get("data", [])
            total = body.get("total", 0)

            all_data.extend(data)
            offset += len(data)

            if offset >= total or not data:
                break

        return all_data

    def _process_chapters(self, raw_chapters: List[Dict[str, Any]]) -> List[Chapter]:
        """
        Nhóm các chapter theo số chapter (chapter number) và ưu tiên bản Tiếng Việt ('vi')
        hơn Tiếng Anh ('en').
        """
        vi_chapters: List[Dict[str, Any]] = []
        en_chapters: List[Dict[str, Any]] = []

        for ch in raw_chapters:
            lang = ch.get("attributes", {}).get("translatedLanguage")
            if lang == "vi":
                vi_chapters.append(ch)
            elif lang == "en":
                en_chapters.append(ch)

        # Quyết định chọn lọc:
        # Nếu có bản tiếng Việt, lấy toàn bộ chapter tiếng Việt.
        # Với các chapter tiếng Việt còn thiếu (ví dụ bản dịch vi mới đến ch 50, mà en có đến ch 100),
        # bổ sung các chapter en chưa có trong vi.
        chosen_dict: Dict[str, Dict[str, Any]] = {}

        # 1. Đưa chapter en vào trước
        for ch in en_chapters:
            ch_num = ch.get("attributes", {}).get("chapter") or "0"
            chosen_dict[ch_num] = ch

        # 2. Ghi đè bằng chapter vi (ưu tiên cao nhất)
        for ch in vi_chapters:
            ch_num = ch.get("attributes", {}).get("chapter") or "0"
            chosen_dict[ch_num] = ch

        # Nếu không có cả vi lẫn en (trường hợp manga dùng ngôn ngữ khác), dùng danh sách gốc
        target_list = list(chosen_dict.values()) if chosen_dict else raw_chapters

        # Chuyển đổi sang đối tượng Chapter của hệ thống
        result: List[Chapter] = []
        for ch in target_list:
            ch_id = ch.get("id")
            attrs = ch.get("attributes", {})
            ch_num = attrs.get("chapter") or "0"
            ch_title = attrs.get("title") or f"Chương {ch_num}"

            # Nhóm dịch (scanlator)
            scanlator = None
            for rel in ch.get("relationships", []):
                if rel.get("type") == "scanlation_group":
                    scanlator = rel.get("attributes", {}).get("name")
                    if scanlator:
                        break

            result.append(
                Chapter(
                    id=ch_id,
                    title=ch_title,
                    chapter_number=str(ch_num),
                    url=f"{self.base_url}/chapter/{ch_id}",
                    scanlator=scanlator,
                    pages=[],
                )
            )

        # Sắp xếp theo số chapter tăng dần
        def parse_chapter_num(c: Chapter) -> float:
            try:
                return float(re.findall(r"\d+(?:\.\d+)?", c.chapter_number)[0])
            except (IndexError, ValueError):
                return 999999.0

        result.sort(key=parse_chapter_num)
        return result

    async def get_chapter_pages(self, chapter_id_or_url: str) -> List[str]:
        """
        Trích xuất danh sách link ảnh chất lượng cao qua MangaDex@Home endpoint.
        """
        chapter_id = self._extract_uuid(chapter_id_or_url)
        resp = await self._request("GET", f"/at-home/server/{chapter_id}")
        data = resp.json()

        base_url = data.get("baseUrl")
        chapter_data = data.get("chapter", {})
        ch_hash = chapter_data.get("hash")
        files = chapter_data.get("data", [])  # 'data' là ảnh chất lượng gốc cao nhất

        if not base_url or not ch_hash or not files:
            raise ValueError(
                f"[MangaDex] Không lấy được thông tin ảnh từ endpoint @Home cho chapter {chapter_id}"
            )

        return [f"{base_url}/data/{ch_hash}/{fn}" for fn in files]
