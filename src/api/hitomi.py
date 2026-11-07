"""
Hitomi.la Manga Source Connector cho MoeJect.
Hỗ trợ bẻ khóa thuật toán ltn.gold-usergeneratedcontent.net,
đọc binary index .nozomi và giải mã dynamic CDN subdomain sharding từ gg.js.
"""

import asyncio
import json
import logging
import re
import struct
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

import httpx

from src.api.base import BaseMangaSource
from src.core.models import Chapter, MangaInfo, MangaSearchResult

logger = logging.getLogger(__name__)


class HitomiSource(BaseMangaSource):
    """
    Source connector chuyên biệt cho Hitomi.la.
    
    Đặc điểm kỹ thuật:
    1. Base CDN: https://ltn.gold-usergeneratedcontent.net/
    2. Binary Indexes (.nozomi): Mỗi gallery ID là 1 số nguyên 4-byte big-endian (>I).
       Hỗ trợ HTTP Range requests để phân trang cực nhanh theo thứ tự Mới -> Cũ.
    3. Metadata JS: https://ltn.gold-usergeneratedcontent.net/galleries/{id}.js
    4. Image URL Sharding: Tính toán từ SHA256 hash của từng trang qua hàm gg.s(), gg.m()
       và tham số gg.b lấy động từ gg.js.
    """

    source_id = "hitomi"
    source_name = "Hitomi.la"
    base_url = "https://hitomi.la"

    LTN_DOMAIN = "ltn.gold-usergeneratedcontent.net"
    IMAGE_DOMAIN = "gold-usergeneratedcontent.net"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
            ),
            "Referer": "https://hitomi.la/",
        }
        self._client: Optional[httpx.AsyncClient] = None
        self._gg_b: str = ""
        self._gg_cases: Set[int] = set()
        self._gg_default_o: int = 0
        self._gg_case_o: int = 1
        self._gg_last_updated: float = 0.0
        self._gg_ttl: float = 1800.0  # Cache gg.js trong 30 phút để bắt kịp epoch flip

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=self.headers,
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(max_keepalive_connections=25, max_connections=50),
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def _ensure_gg(self) -> None:
        """Nạp động và cập nhật cache thông số giải mã từ gg.js."""
        now = time.time()
        if self._gg_b and (now - self._gg_last_updated < self._gg_ttl):
            return

        client = await self._get_client()
        try:
            url = f"https://{self.LTN_DOMAIN}/gg.js"
            resp = await client.get(url)
            if resp.status_code == 200:
                text = resp.text
                b_match = re.search(r"b:\s*'([^']+)'", text)
                if b_match:
                    self._gg_b = b_match.group(1)
                
                # Hitomi thay đổi đảo cờ var o = 0/1 và o = 1/0 break định kỳ theo giờ
                init_m = re.search(r"var o = (\d+);", text)
                if init_m:
                    self._gg_default_o = int(init_m.group(1))
                    
                case_m = re.search(r"o = (\d+);\s*break;", text)
                if case_m:
                    self._gg_case_o = int(case_m.group(1))

                cases = set(map(int, re.findall(r"case\s+(\d+):", text)))
                if cases:
                    self._gg_cases = cases
                    
                self._gg_last_updated = now
                logger.info(f"Đã cập nhật gg.js cho Hitomi.la: gg.b={self._gg_b}, default_o={self._gg_default_o}, case_o={self._gg_case_o}, {len(self._gg_cases)} cases")
            else:
                logger.warning(f"Không thể tải gg.js: HTTP {resp.status_code}")
        except Exception as e:
            logger.error(f"Lỗi khi nạp gg.js: {e}")
            if not self._gg_b:
                # Fallback tham số dự phòng nếu mất mạng tạm thời
                self._gg_b = "1794056401/"

    def _gg_m(self, g: int) -> int:
        """Hàm gg.m(g) từ gg.js để chọn subdomain CDN (tự động thích ứng flip logic)."""
        return self._gg_case_o if g in self._gg_cases else self._gg_default_o

    def _gg_s(self, h: str) -> str:
        """Hàm gg.s(h) từ gg.js: lấy số thập phân từ 3 ký tự cuối của SHA256 hash."""
        m = re.search(r"(..)(.)$", h)
        if not m:
            return "0"
        return str(int(m.group(2) + m.group(1), 16))

    def _get_image_url(self, image_dict: Dict[str, Any]) -> str:
        """
        Tính toán URL ảnh WebP gốc dựa trên giải thuật phân phối subdomain của Hitomi.
        url = https://w{1+gg.m(g)}.gold-usergeneratedcontent.net/{gg.b}{gg.s(h)}/{h}.webp
        """
        h = image_dict.get("hash", "")
        if not h:
            return ""

        s_val = self._gg_s(h)
        m = re.search(r"(..)(.)$", h)
        g_val = int(m.group(2) + m.group(1), 16) if m else 0
        m_val = self._gg_m(g_val)
        subdomain = f"w{1 + m_val}"

        return f"https://{subdomain}.{self.IMAGE_DOMAIN}/{self._gg_b}{s_val}/{h}.webp"

    def _get_cover_url(self, first_image_dict: Dict[str, Any]) -> str:
        """
        Tính toán URL ảnh thumbnail WebP bìa truyện.
        url = https://{sub}tn.gold-usergeneratedcontent.net/webpbigtn/{last1}/{last2}/{h}.webp
        """
        h = first_image_dict.get("hash", "")
        if not h or len(h) < 3:
            return ""

        m = re.search(r"(..)(.)$", h)
        g_val = int(m.group(2) + m.group(1), 16) if m else 0
        m_val = self._gg_m(g_val)
        subdomain = f"{chr(97 + m_val)}tn"

        last1 = h[-1]
        last2 = h[-3:-1]
        return f"https://{subdomain}.{self.IMAGE_DOMAIN}/webpbigtn/{last1}/{last2}/{h}.webp"

    async def _fetch_gallery_info(self, gallery_id: str) -> Optional[Dict[str, Any]]:
        """Lấy metadata gallery JSON từ ltn server."""
        client = await self._get_client()
        url = f"https://{self.LTN_DOMAIN}/galleries/{gallery_id}.js"
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                text = resp.text
                start = text.find("{")
                end = text.rfind("}")
                if start != -1 and end != -1:
                    return json.loads(text[start : end + 1])
        except Exception as e:
            logger.warning(f"Lỗi khi lấy galleryinfo {gallery_id}: {e}")
        return None

    def _extract_gallery_id(self, query_or_url: str) -> Optional[str]:
        """Trích xuất ID số từ URL hoặc chuỗi nhập liệu."""
        clean = query_or_url.strip()
        if clean.isdigit():
            return clean

        # Tìm chuỗi số ở cuối URL (ví dụ: /doujinshi/ten-truyen-4311552.html)
        m = re.search(r"[-/](\d{5,8})(?:\.html)?$", clean)
        if m:
            return m.group(1)

        # Tìm bất kỳ cụm 5-8 chữ số
        m2 = re.search(r"\b(\d{5,8})\b", clean)
        if m2:
            return m2.group(1)

        return None

    async def search(self, query: str = "", page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm truyện trên Hitomi.la.
        - Nếu query là ID / URL: Trả về trực tiếp truyện đó.
        - Nếu query để trống: Đọc từ binary index `index-all.nozomi` theo thứ tự Mới -> Cũ.
        - Nếu query là từ khóa: Thử nghiệm tra cứu các index tag/artist/series tương ứng.
        """
        await self._ensure_gg()
        client = await self._get_client()
        query_str = (query or "").strip()

        # 1. Kiểm tra nếu tìm bằng Gallery ID cụ thể
        gid = self._extract_gallery_id(query_str)
        if gid:
            info = await self._fetch_gallery_info(gid)
            if info:
                title = info.get("title", f"Gallery {gid}")
                files = info.get("files", [])
                cover_url = self._get_cover_url(files[0]) if files else ""
                authors = [a.get("artist") for a in info.get("artists", []) if a.get("artist")]
                genres = [t.get("tag") for t in info.get("tags", []) if t.get("tag")]
                return [
                    MangaSearchResult(
                        id=str(gid),
                        title=title,
                        cover_url=cover_url,
                        latest_chapter=f"{len(files)} Trang",
                        url=f"https://hitomi.la/reader/{gid}.html",
                        authors=authors,
                        genres=genres,
                    )
                ]

        # 2. Xác định file .nozomi mục tiêu
        page_size = 24
        start_byte = (page - 1) * page_size * 4
        end_byte = start_byte + (page_size * 4) - 1

        nozomi_path = "index-all.nozomi"

        if query_str:
            q_clean = query_str.lower().strip()
            # Xử lý các tiền tố chuyên dụng: artist:..., tag:..., series:...
            if ":" in q_clean:
                prefix, val = q_clean.split(":", 1)
                prefix = prefix.strip()
                val = val.strip().replace(" ", "%20")
                nozomi_path = f"{prefix}/{val}-all.nozomi"
            else:
                # Tìm kiếm tự động: thử tag, artist, series, type
                candidates = [
                    f"tag/{q_clean}-all.nozomi",
                    f"artist/{q_clean}-all.nozomi",
                    f"series/{q_clean}-all.nozomi",
                    f"character/{q_clean}-all.nozomi",
                    f"type/{q_clean}-all.nozomi",
                ]
                found = False
                for cand in candidates:
                    try:
                        r = await client.head(f"https://{self.LTN_DOMAIN}/{cand}")
                        if r.status_code == 200:
                            nozomi_path = cand
                            found = True
                            break
                    except Exception:
                        pass
                if not found:
                    # Nếu không tìm thấy index phù hợp, fallback về index-all
                    nozomi_path = "index-all.nozomi"

        # 3. Đọc danh sách ID nhị phân từ .nozomi bằng HTTP Range Request
        nozomi_url = f"https://{self.LTN_DOMAIN}/{nozomi_path}"
        try:
            resp = await client.get(nozomi_url, headers={"Range": f"bytes={start_byte}-{end_byte}"})
            if resp.status_code not in (200, 206) or not resp.content:
                return []
            
            total_ids = len(resp.content) // 4
            gallery_ids = struct.unpack(f">{total_ids}I", resp.content)
        except Exception as exc:
            logger.error(f"Lỗi đọc index nozomi {nozomi_url}: {exc}")
            return []

        # 4. Tải metadata song song có giới hạn cho các ID thu thập được
        semaphore = asyncio.Semaphore(10)

        async def _load_meta(gallery_id: int) -> Optional[MangaSearchResult]:
            async with semaphore:
                try:
                    info = await self._fetch_gallery_info(str(gallery_id))
                    if not info:
                        return None
                    title = info.get("title", f"Gallery {gallery_id}")
                    files = info.get("files", [])
                    cover = self._get_cover_url(files[0]) if (files and isinstance(files, list)) else ""
                    lang = info.get("language", "")
                    suffix = f" • [{lang.upper()}]" if lang else ""
                    artists = info.get("artists") or []
                    tags = info.get("tags") or []
                    authors = [a.get("artist") for a in artists if isinstance(a, dict) and a.get("artist")]
                    genres = [t.get("tag") for t in tags if isinstance(t, dict) and t.get("tag")]
                    return MangaSearchResult(
                        id=str(gallery_id),
                        title=title,
                        cover_url=cover,
                        latest_chapter=f"{len(files)} Trang{suffix}",
                        url=f"https://hitomi.la/reader/{gallery_id}.html",
                        authors=authors,
                        genres=genres,
                    )
                except Exception as exc:
                    logger.warning(f"Lỗi parse gallery {gallery_id}: {exc}")
                    return None

        tasks = [_load_meta(gid) for gid in gallery_ids]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        results: List[MangaSearchResult] = []
        for r in raw_results:
            if isinstance(r, MangaSearchResult):
                results.append(r)

        return results

    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Lấy toàn bộ chi tiết Gallery và tạo 1 Chapter duy nhất chứa toàn bộ link ảnh WebP.
        """
        await self._ensure_gg()
        gid = self._extract_gallery_id(manga_id_or_url)
        if not gid:
            raise ValueError(f"Không thể nhận diện Gallery ID Hitomi từ: {manga_id_or_url}")

        info = await self._fetch_gallery_info(gid)
        if not info:
            raise ValueError(f"Không tìm thấy thông tin Gallery Hitomi ID: {gid}")

        title = info.get("title", f"Gallery {gid}")
        gallery_type = info.get("type", "doujinshi")
        language = info.get("language", "japanese")

        artists_list = info.get("artists") or []
        tags_list = info.get("tags") or []
        artists = [a.get("artist") for a in artists_list if isinstance(a, dict) and a.get("artist")]
        tags = [t.get("tag") for t in tags_list if isinstance(t, dict) and t.get("tag")]
        description = f"Type: {gallery_type} | Language: {language} | Tags: {', '.join(tags[:12])}"

        files = info.get("files") or []
        cover_url = self._get_cover_url(files[0]) if files else ""

        # Sinh danh sách URLs ảnh WebP độ phân giải đầy đủ cho toàn bộ gallery
        page_urls = [self._get_image_url(f) for f in files]

        # Với Hitomi, mỗi gallery đóng gói là 1 chapter hoàn chỉnh
        chapter = Chapter(
            id=f"{gid}_full",
            title=f"Full Gallery ({len(files)} trang)",
            chapter_number="1",
            url=f"https://hitomi.la/reader/{gid}.html",
            scanlator=", ".join(artists) if artists else "Unknown",
            pages=page_urls,
        )

        return MangaInfo(
            id=str(gid),
            title=title,
            url=f"https://hitomi.la/reader/{gid}.html",
            cover_url=cover_url,
            description=description,
            authors=artists or ["Unknown"],
            genres=tags,
            chapters=[chapter],
        )

    async def get_chapter_pages(self, chapter_id_or_url: str) -> List[str]:
        """
        Trả về danh sách URL ảnh WebP của gallery.
        """
        gid = self._extract_gallery_id(chapter_id_or_url)
        if not gid:
            raise ValueError(f"Không nhận diện được ID chapter: {chapter_id_or_url}")

        details = await self.get_manga_details(gid)
        if details.chapters and details.chapters[0].pages:
            return details.chapters[0].pages
        return []
