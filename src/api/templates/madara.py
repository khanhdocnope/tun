"""
Template Engine cho các trang WordPress sử dụng Madara Theme (hơn 440+ nguồn trên HakuNeko).
Hỗ trợ tìm kiếm, feed truyện mới nhất, chi tiết truyện và danh sách ảnh reading-content.
"""

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.api.templates.base_template import BaseTemplateSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult

logger = logging.getLogger(__name__)


class MadaraSource(BaseTemplateSource):
    """
    Template Scraper cho các website WordPress Madara CMS.
    """

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm truyện trên Madara hoặc lấy danh sách truyện mới cập nhật nếu query rỗng.
        """
        query_clean = (query or "").strip()
        if query_clean:
            path = f"/page/{page}/" if page > 1 else "/"
            params = {"s": query_clean, "post_type": "wp-manga"}
        else:
            # Feed truyện mới nhất (Mới -> Cũ)
            path = f"/page/{page}/" if page > 1 else "/"
            params = {"m_orderby": "latest"}

        try:
            html = await self._fetch_html(path, params=params)
        except Exception as e:
            logger.warning(f"[{self.source_name}] Lỗi cào Madara: {e}")
            return []

        soup = self._parse_soup(html)
        results: List[MangaSearchResult] = []

        items = soup.select("div.c-tabs-item__content, div.page-item-detail, div.badge-pos-1")
        for it in items:
            title_tag = it.select_one("div.post-title h3 a, h3.h4 a, div.post-title a")
            if not title_tag:
                continue

            title = title_tag.get_text().strip()
            link = title_tag.get("href", "")
            if not link:
                continue
            full_url = urljoin(self.base_url, link)

            # Lấy slug/ID
            manga_id = full_url.rstrip("/").split("/")[-1]

            # Bìa truyện
            img_tag = it.select_one("div.item-thumb img, div.c-image-hover img")
            cover_url = None
            if img_tag:
                cover_url = (
                    img_tag.get("data-src")
                    or img_tag.get("data-lazy-src")
                    or img_tag.get("srcset")
                    or img_tag.get("src")
                )
                if cover_url:
                    cover_url = cover_url.split(",")[0].split()[0]
                    if not cover_url.startswith("http"):
                        cover_url = urljoin(self.base_url, cover_url)

            # Chương mới nhất
            latest_ch_tag = it.select_one("span.chapter a, div.list-chapter div.chapter-item span.font-meta a")
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
        Lấy thông tin chi tiết manga và danh sách chương từ Madara.
        """
        if manga_id_or_url.startswith("http"):
            url = manga_id_or_url
            manga_id = url.rstrip("/").split("/")[-1]
        else:
            url = f"{self.base_url}/manga/{manga_id_or_url}/"
            manga_id = manga_id_or_url

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        title_tag = soup.select_one("div.post-title h1, h1#manga-title")
        title = title_tag.get_text().strip() if title_tag else f"Manga #{manga_id}"

        cover_tag = soup.select_one("div.summary_image img")
        cover_url = None
        if cover_tag:
            cover_url = (
                cover_tag.get("data-src")
                or cover_tag.get("data-lazy-src")
                or cover_tag.get("src")
            )
            if cover_url and not cover_url.startswith("http"):
                cover_url = urljoin(self.base_url, cover_url)

        desc_tag = soup.select_one("div.description-summary div.summary__content, div.manga-excerpt")
        description = desc_tag.get_text().strip() if desc_tag else None

        # Tác giả
        author_tags = soup.select("div.author-content a")
        authors = [a.get_text().strip() for a in author_tags] if author_tags else []

        # Thể loại
        genre_tags = soup.select("div.genres-content a")
        genres = [g.get_text().strip() for g in genre_tags] if genre_tags else []

        # Danh sách chương: li.wp-manga-chapter a
        chapter_links = soup.select("li.wp-manga-chapter a")
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
        Trích xuất link ảnh của chapter từ Madara.
        """
        if chapter_id_or_url.startswith("http"):
            url = chapter_id_or_url
        else:
            url = f"{self.base_url}/manga/{chapter_id_or_url}"

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        img_tags = soup.select("div.reading-content img, div.page-break img")
        image_urls: List[str] = []

        for img in img_tags:
            src = (
                img.get("data-src")
                or img.get("data-lazy-src")
                or img.get("src")
            )
            if src:
                src = src.strip()
                if not src.startswith("http"):
                    src = urljoin(self.base_url, src)
                image_urls.append(src)

        return image_urls
