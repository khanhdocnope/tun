"""
Lớp cơ sở cho các Template Scraper Engines trong MoeJect.
Tích hợp Smart DNS DoH, connection pooling, header giả lập Chrome,
và khả năng xử lý cả tìm kiếm theo từ khóa lẫn feed truyện mới cập nhật.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
import httpx

from src.api.base import BaseMangaSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult
from src.utils.dns import enable_smart_dns

logger = logging.getLogger(__name__)


class BaseTemplateSource(BaseMangaSource):
    """
    Template Scraper Base Class hỗ trợ cào dữ liệu từ các CMS phổ biến.
    """

    def __init__(
        self,
        source_id: str,
        source_name: str,
        base_url: str,
        client: Optional[httpx.AsyncClient] = None,
        timeout: float = 20.0,
    ):
        enable_smart_dns()
        self.source_id = source_id
        self.source_name = source_name
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._owns_client = client is None

        # Headers chuẩn trình duyệt
        domain = urlparse(self.base_url).netloc
        self._client = client or httpx.AsyncClient(
            verify=False,
            timeout=httpx.Timeout(timeout),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
                "Referer": f"{self.base_url}/",
            },
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self._owns_client and self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _fetch_html(self, url_or_path: str, params: Optional[Dict[str, Any]] = None) -> str:
        """Gửi GET request và trả về chuỗi HTML văn bản."""
        url = url_or_path if url_or_path.startswith("http") else f"{self.base_url}{url_or_path}"
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.text

    def _parse_soup(self, html: str) -> BeautifulSoup:
        """Khởi tạo BeautifulSoup parser."""
        return BeautifulSoup(html, "html.parser")
