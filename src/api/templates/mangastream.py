"""
Template Engine cho các trang WordPress sử dụng MangaStream / Asura Theme (gần 200 nguồn trên HakuNeko).
Hỗ trợ tìm kiếm, feed truyện mới nhất, bóc tách chapter và trích xuất link ảnh từ #readerarea.
"""

import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.api.templates.base_template import BaseTemplateSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult

logger = logging.getLogger(__name__)


class MangaStreamSource(BaseTemplateSource):
    """
    Template Scraper cho MangaStream / Asura / FlameComics theme.
    """

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm truyện tranh hoặc lấy feed truyện mới cập nhật nếu query rỗng.
        """
        query_clean = (query or "").strip()
        if query_clean:
            path = f"/page/{page}/?s={query_clean}" if page > 1 else f"/?s={query_clean}"
            params = None
        else:
            # Feed truyện mới nhất (Mới -> Cũ)
            path = f"/manga/?page={page}&order=update"
            params = None

        try:
            html = await self._fetch_html(path, params=params)
        except Exception as e:
            # Fallback trang chủ nếu /manga/ không có
            try:
                html = await self._fetch_html("/")
            except Exception:
                logger.warning(f"[{self.source_name}] Lỗi cào MangaStream: {e}")
                return []

        soup = self._parse_soup(html)
        results: List[MangaSearchResult] = []

        items = soup.select("div.bsx, div.listupd div.bs, div.utao div.uta")
        for it in items:
            title_tag = it.select_one("div.tt a, a.tip, div.luf a")
            if not title_tag:
                title_tag = it.select_one("a")
            if not title_tag:
                continue

            title = title_tag.get("title") or title_tag.get_text().strip()
            link = title_tag.get("href", "")
            if not link or "/manga/" not in link and "/series/" not in link:
                continue
            full_url = urljoin(self.base_url, link)

            manga_id = full_url.rstrip("/").split("/")[-1]

            img_tag = it.select_one("img.ts-post-image, img")
            cover_url = None
            if img_tag:
                cover_url = img_tag.get("data-src") or img_tag.get("src")
                if cover_url and not cover_url.startswith("http"):
                    cover_url = urljoin(self.base_url, cover_url)

            latest_ch_tag = it.select_one("div.adds div.epxs, ul li a")
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
            url = f"{self.base_url}/manga/{manga_id_or_url}/"
            manga_id = manga_id_or_url

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        title_tag = soup.select_one("h1.entry-title")
        title = title_tag.get_text().strip() if title_tag else f"Manga #{manga_id}"

        cover_tag = soup.select_one("div.thumb img")
        cover_url = None
        if cover_tag:
            cover_url = cover_tag.get("data-src") or cover_tag.get("src")
            if cover_url and not cover_url.startswith("http"):
                cover_url = urljoin(self.base_url, cover_url)

        desc_tag = soup.select_one("div.entry-content-single, div.entry-content")
        description = desc_tag.get_text().strip() if desc_tag else None

        # Tác giả
        author_tags = soup.select("div.tsinfo div.imptdt:has(i:contains('Author')) i, div.fmed:has(b:contains('Author')) span")
        authors = [a.get_text().strip() for a in author_tags] if author_tags else []

        # Thể loại
        genre_tags = soup.select("div.mgen a, span.mgen a")
        genres = [g.get_text().strip() for g in genre_tags] if genre_tags else []

        # Danh sách chương: div#chapterlist li a, div.clstyle li a
        chapter_links = soup.select("div#chapterlist ul li a, div.clstyle li a")
        chapters: List[Chapter] = []

        for ch_a in chapter_links:
            ch_url = urljoin(self.base_url, ch_a.get("href", ""))
            ch_id = ch_url.rstrip("/").split("/")[-1]
            ch_num_tag = ch_a.select_one("span.chapternum")
            ch_title = ch_num_tag.get_text().strip() if ch_num_tag else ch_a.get_text().strip()

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
        Trích xuất danh sách link ảnh từ #readerarea.
        """
        if chapter_id_or_url.startswith("http"):
            url = chapter_id_or_url
        else:
            url = f"{self.base_url}/{chapter_id_or_url}"

        html = await self._fetch_html(url)
        soup = self._parse_soup(html)

        img_tags = soup.select("div#readerarea img")
        image_urls: List[str] = []

        for img in img_tags:
            src = img.get("data-src") or img.get("src")
            if src:
                src = src.strip()
                if not src.startswith("http"):
                    src = urljoin(self.base_url, src)
                image_urls.append(src)

        return image_urls
