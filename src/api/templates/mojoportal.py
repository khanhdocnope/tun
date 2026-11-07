"""
Template Engine cho họ website truyện tranh MojoPortal / NetTruyen (NetTruyen, TruyenChon, NhatTruyen...).
Bao phủ các nguồn truyện tiếng Việt phổ biến nhất với tốc độ bóc tách cực cao.
"""

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.api.templates.base_template import BaseTemplateSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult

logger = logging.getLogger(__name__)


class MojoPortalSource(BaseTemplateSource):
    """
    Template Scraper cho NetTruyen / TruyenChon / NhatTruyen.
    """

    def __init__(
        self,
        source_id: str = "nettruyen",
        source_name: str = "NetTruyen",
        base_url: str = "https://www.nettruyenus.com",
        **kwargs,
    ):
        super().__init__(source_id, source_name, base_url, **kwargs)

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm truyện tranh hoặc lấy danh sách truyện mới cập nhật nếu query rỗng.
        """
        query_clean = (query or "").strip()
        if query_clean:
            path = "/tim-truyen"
            params = {"keyword": query_clean, "page": page}
        else:
            # Feed truyện mới nhất (Mới -> Cũ)
            path = f"/?page={page}"
            params = None

        try:
            html = await self._fetch_html(path, params=params)
        except Exception as e:
            logger.warning(f"[{self.source_name}] Lỗi tải danh sách: {e}")
            return []

        soup = self._parse_soup(html)
        results: List[MangaSearchResult] = []

        # Các items truyện trên NetTruyen nằm trong div.items div.item
        items = soup.select("div.ModuleContent div.items div.item, div.items div.item")
        for it in items:
            title_tag = it.select_one("figcaption h3 a, figcaption a.jtip")
            if not title_tag:
                continue

            title = title_tag.get_text().strip()
            link = title_tag.get("href", "")
            if not link:
                continue
            full_url = urljoin(self.base_url, link)

            # Lấy ID từ URL (vd: /truyen-tranh/one-piece-1234 -> one-piece-1234)
            manga_id = full_url.rstrip("/").split("/")[-1]

            # Bìa truyện
            img_tag = it.select_one("div.image a img, div.image img")
            cover_url = None
            if img_tag:
                cover_url = (
                    img_tag.get("data-original")
                    or img_tag.get("data-src")
                    or img_tag.get("src")
                )
                if cover_url and not cover_url.startswith("http"):
                    cover_url = f"https:{cover_url}" if cover_url.startswith("//") else urljoin(self.base_url, cover_url)

            # Chương mới nhất
            latest_ch_tag = it.select_one("ul li.chapter a")
            latest_ch = latest_ch_tag.get_text().strip() if latest_ch_tag else None

            results.append(
                MangaSearchResult(
                    id=manga_id,
                    title=title,
                    url=full_url,
                    cover_url=cover_url,
                    latest_chapter=latest_ch,
                    description=None,
                    authors=[],
                    genres=[],
                )
            )

        return results

    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Lấy thông tin chi tiết manga và danh sách chương.
        """
        if manga_id_or_url.startswith("http"):
            url = manga_id_or_url
            manga_id = url.rstrip("/").split("/")[-1]
        else:
            url = f"{self.base_url}/truyen-tranh/{manga_id_or_url}"
            manga_id = manga_id_or_url

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        title_tag = soup.select_one("h1.title-detail")
        title = title_tag.get_text().strip() if title_tag else f"Manga #{manga_id}"

        cover_tag = soup.select_one("div.col-image img")
        cover_url = None
        if cover_tag:
            cover_url = (
                cover_tag.get("data-original")
                or cover_tag.get("data-src")
                or cover_tag.get("src")
            )
            if cover_url and not cover_url.startswith("http"):
                cover_url = f"https:{cover_url}" if cover_url.startswith("//") else urljoin(self.base_url, cover_url)

        desc_tag = soup.select_one("div.detail-content p, div.shortened")
        description = desc_tag.get_text().strip() if desc_tag else None

        # Tác giả
        author_tags = soup.select("li.author p.col-xs-8 a")
        authors = [a.get_text().strip() for a in author_tags] if author_tags else []

        # Thể loại
        genre_tags = soup.select("li.kind p.col-xs-8 a")
        genres = [g.get_text().strip() for g in genre_tags] if genre_tags else []

        # Danh sách chương: div.list-chapter ul li.row div.chapter a
        chapter_links = soup.select("div.list-chapter ul li.row div.chapter a")
        chapters: List[Chapter] = []

        for ch_a in chapter_links:
            ch_url = urljoin(self.base_url, ch_a.get("href", ""))
            ch_id = ch_url.rstrip("/").split("/")[-1]
            ch_title = ch_a.get_text().strip()

            ch_num_match = re.search(r"Chapter\s+([\d.]+)", ch_title, re.IGNORECASE)
            ch_num = ch_num_match.group(1) if ch_num_match else "0"

            chapters.append(
                Chapter(
                    id=ch_id,
                    title=ch_title,
                    chapter_number=ch_num,
                    url=ch_url,
                    scanlator=None,
                    pages=[],
                )
            )

        # Đảo ngược danh sách chapters từ nhỏ đến lớn (Chapter 1 -> Chapter mới nhất)
        chapters.reverse()

        return MangaInfo(
            id=manga_id,
            title=title,
            url=url,
            cover_url=cover_url,
            description=description,
            authors=authors,
            genres=genres,
            chapters=chapters,
        )

    async def get_chapter_pages(self, chapter_id_or_url: str) -> List[str]:
        """
        Trích xuất danh sách link ảnh của chapter.
        """
        if chapter_id_or_url.startswith("http"):
            url = chapter_id_or_url
        else:
            url = f"{self.base_url}/truyen-tranh/{chapter_id_or_url}"

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        img_tags = soup.select("div.reading div.page-chapter img, div.reading-detail div.page-chapter img")
        image_urls: List[str] = []

        for img in img_tags:
            src = (
                img.get("data-original")
                or img.get("data-src")
                or img.get("data-cdn")
                or img.get("src")
            )
            if src:
                src = src.strip()
                if not src.startswith("http"):
                    src = f"https:{src}" if src.startswith("//") else urljoin(self.base_url, src)
                image_urls.append(src)

        return image_urls
