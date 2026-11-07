"""
Connector cho Comix.to kế thừa và tối ưu hóa từ comix-downloader (Yui007/comix-downloader).
Hỗ trợ tìm kiếm, bóc tách metadata từ script initial-data, danh sách chapter và link ảnh.
Tự động kích hoạt cơ chế giải WAF challenge tại https://comix.to/@waf/challenge với cookie waf_pass.
"""

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from bs4 import BeautifulSoup
import httpx
import nodriver as uc

from src.api.base import BaseMangaSource
from src.api.browser_runner import bypass_comix_waf, bypass_url
from src.core.models import Chapter, MangaInfo, MangaSearchResult
from src.core.session import load_cookies_into_httpx
from src.utils.dns import enable_smart_dns, get_chrome_dns_args

logger = logging.getLogger(__name__)

# Regex trích xuất manga code: vd /title/93q1r-the-summoner -> 93q1r
MANGA_CODE_REGEX = re.compile(r"/title/([a-zA-Z0-9]+)")
# Regex trích xuất chapter: vd /title/slug/12345-chapter-1.5 -> (12345, 1.5)
CHAPTER_URL_REGEX = re.compile(r"/title/[^/]+/(\d+)-chapter-([a-zA-Z0-9.]+)")


class ComixSource(BaseMangaSource):
    """
    Source connector cho Comix.to kế thừa từ comix-downloader.
    Tích hợp vượt WAF Turnstile (@waf/challenge) và trích xuất dữ liệu từ initial-data.
    """

    source_id: str = "comix"
    source_name: str = "Comix.to"
    base_url: str = "https://comix.to"
    api_url: str = "https://comix.to/api/v1"
    waf_url: str = "https://comix.to/@waf/challenge"
    needs_browser_bypass: bool = True

    def __init__(
        self,
        client: Optional[httpx.AsyncClient] = None,
        timeout: float = 25.0,
        max_waf_retries: int = 2,
    ):
        enable_smart_dns()
        self.timeout = timeout
        self.max_waf_retries = max_waf_retries
        self._owns_client = client is None

        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
                "Referer": "https://comix.to/",
            },
            follow_redirects=True,
        )
        self._reload_cookies()

    def _reload_cookies(self) -> None:
        """Nạp cookies (bao gồm waf_pass và cf_clearance) từ cf_cookies.dat."""
        load_cookies_into_httpx(self._client)

    async def close(self) -> None:
        """Giải phóng kết nối HTTP."""
        if self._owns_client and self._client and not self._client.is_closed:
            await self._client.aclose()

    @staticmethod
    def extract_manga_code(identifier_or_url: str) -> str:
        """
        Trích xuất mã manga (manga_code) từ URL hoặc mã hash.
        Ví dụ: https://comix.to/title/93q1r-the-summoner -> 93q1r
        """
        clean = identifier_or_url.strip()
        match = MANGA_CODE_REGEX.search(clean)
        if match:
            return match.group(1)
        # Nếu truyền vào dạng '93q1r-the-summoner' hoặc '93q1r'
        parts = clean.rstrip("/").split("/")
        last_seg = parts[-1]
        code = last_seg.split("-")[0]
        if code:
            return code
        raise ValueError(f"Không thể trích xuất manga code từ: {identifier_or_url}")

    async def _request(
        self, method: str, endpoint: str, **kwargs
    ) -> httpx.Response:
        """
        Gửi HTTP request với cơ chế tự động xử lý WAF Challenge (@waf/challenge) của comix.to.
        """
        url = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"

        for attempt in range(1, self.max_waf_retries + 2):
            try:
                resp = await self._client.request(method, url, **kwargs)

                is_waf_blocked = (
                    resp.status_code in (403, 503)
                    or "cf-turnstile" in resp.text
                    or "just a moment..." in resp.text.lower()
                    or "@waf/challenge" in str(resp.url)
                )

                if is_waf_blocked:
                    if attempt <= 1:
                        logger.warning(
                            f"[Comix] Bị chặn bởi WAF (HTTP {resp.status_code}) tại {url}. "
                            f"Đang kích hoạt bypass_comix_waf() (lần {attempt})..."
                        )
                        success = await bypass_comix_waf(headless_timeout=6.0, headed_timeout=12.0)
                        if success:
                            self._reload_cookies()
                            await asyncio.sleep(0.5)
                            continue
                        else:
                            logger.warning("[Comix] Không thể vượt qua WAF challenge trong thời gian cho phép.")
                            break
                    else:
                        break

                if resp.status_code == 200:
                    return resp

                resp.raise_for_status()

            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt > self.max_waf_retries:
                    logger.error(f"[Comix] Lỗi kết nối tới {url}: {e}")
                    raise
                logger.info(f"[Comix] Lỗi mạng ({e}), thử lại lần {attempt}...")
                await asyncio.sleep(1.5)

        raise RuntimeError(f"[Comix] Thất bại khi gửi request tới {url}")

    @staticmethod
    def _parse_initial_data(html_text: str) -> Optional[Dict[str, Any]]:
        """Bóc tách JSON payload từ thẻ script <script id='initial-data'>."""
        soup = BeautifulSoup(html_text, "html.parser")
        script_tag = soup.find("script", id="initial-data")
        if script_tag:
            content = script_tag.get_text().strip()
            if content:
                try:
                    return json.loads(content)
                except Exception as e:
                    logger.debug(f"[Comix] Lỗi parse initial-data: {e}")
        return None

    @staticmethod
    def _find_manga_detail_query(initial_data: Dict[str, Any], manga_code: str) -> Optional[Dict[str, Any]]:
        """Tìm object manga detail trong initial-data.queries."""
        queries = initial_data.get("queries", {})
        if not isinstance(queries, dict):
            return None

        for key, value in queries.items():
            key_str = str(key).lower()
            if "manga" in key_str and "detail" in key_str and manga_code.lower() in key_str:
                if isinstance(value, dict):
                    return value
        return None

    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm manga trên Comix.to.
        Thử nghiệm qua API /api/v1/manga; nếu bị WAF hoặc query rỗng, lấy danh sách trending từ trang chủ.
        """
        query_clean = (query or "").strip()

        # 1. Thử qua API /api/v1/manga nếu có từ khóa
        if query_clean:
            try:
                params = {"keyword": query_clean, "page": page}
                resp = await self._request(
                    "GET",
                    f"{self.api_url}/manga",
                    params=params,
                    headers={"Accept": "application/json, text/plain, */*"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    result_obj = data.get("result", {})
                    items = result_obj.get("items") or result_obj.get("data") or []
                    results: List[MangaSearchResult] = []
                    for it in items:
                        hid = it.get("hid") or it.get("manga_code") or str(it.get("id"))
                        title = it.get("title") or it.get("name") or "Unknown"
                        poster = it.get("poster") or {}
                        cover_url = (
                            poster.get("large")
                            or poster.get("medium")
                            or (poster if isinstance(poster, str) else None)
                        )
                        latest_ch = it.get("latestChapter") or it.get("latest_chapter")

                        results.append(
                            MangaSearchResult(
                                id=str(hid),
                                title=str(title),
                                url=f"{self.base_url}/title/{hid}",
                                cover_url=cover_url,
                                latest_chapter=str(latest_ch) if latest_ch else None,
                                description=it.get("synopsis") or it.get("description"),
                                authors=[],
                                genres=[],
                            )
                        )
                    if results:
                        return results
            except Exception as e:
                logger.debug(f"[Comix] API search không khả dụng ({e}), chuyển sang cào initial-data.")

        # 2. Fallback cào từ initial-data trên trang chủ hoặc /browse
        target_page_url = (
            f"{self.base_url}/browse?keyword={query_clean}&page={page}"
            if query_clean
            else f"{self.base_url}/browse?order=latest&page={page}"
        )
        resp = await self._request("GET", target_page_url)
        initial_data = self._parse_initial_data(resp.text)

        results: List[MangaSearchResult] = []
        if initial_data and "queries" in initial_data:
            queries = initial_data["queries"]
            for q_key, q_val in queries.items():
                items = []
                if isinstance(q_val, list):
                    items = q_val
                elif isinstance(q_val, dict) and isinstance(q_val.get("items"), list):
                    items = q_val["items"]

                for it in items:
                    if not isinstance(it, dict):
                        continue
                    title = it.get("title") or it.get("name")
                    if not title:
                        continue
                    hid = it.get("hid") or it.get("manga_code") or str(it.get("id"))
                    poster = it.get("poster") or {}
                    cover_url = (
                        poster.get("large")
                        or poster.get("medium")
                        or (poster if isinstance(poster, str) else None)
                    )
                    latest_ch = it.get("latestChapter") or it.get("latest_chapter")

                    results.append(
                        MangaSearchResult(
                            id=str(hid),
                            title=str(title),
                            url=f"{self.base_url}/title/{hid}",
                            cover_url=cover_url,
                            latest_chapter=str(latest_ch) if latest_ch else None,
                            description=it.get("synopsis") or it.get("description"),
                            authors=[],
                            genres=[],
                        )
                    )
                if results:
                    break

        return results

    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Bóc tách chi tiết truyện và danh sách chapter của Comix.to.
        """
        manga_code = self.extract_manga_code(manga_id_or_url)
        url = f"{self.base_url}/title/{manga_code}"

        resp = await self._request("GET", url)
        html_text = resp.text

        # 1. Bóc tách initial-data
        initial_data = self._parse_initial_data(html_text)
        manga_detail = {}
        if initial_data:
            manga_detail = self._find_manga_detail_query(initial_data, manga_code) or {}

        title = manga_detail.get("title") or f"Comix #{manga_code}"
        poster = manga_detail.get("poster") or {}
        cover_url = (
            poster.get("large")
            or poster.get("medium")
            or (poster if isinstance(poster, str) else None)
        )
        description = manga_detail.get("synopsis") or manga_detail.get("description")

        genres: List[str] = []
        for g in manga_detail.get("genres", []):
            if isinstance(g, dict) and "title" in g:
                genres.append(g["title"])
            elif isinstance(g, str):
                genres.append(g)

        authors: List[str] = []
        for a in manga_detail.get("authors", []):
            if isinstance(a, dict) and "name" in a:
                authors.append(a["name"])
            elif isinstance(a, str):
                authors.append(a)

        # 2. Bóc tách danh sách chapters từ HTML DOM
        chapters = self._parse_chapter_rows(html_text, manga_code)

        return MangaInfo(
            id=manga_code,
            title=title,
            url=url,
            cover_url=cover_url,
            description=description,
            authors=authors,
            genres=genres,
            chapters=chapters,
        )

    def _parse_chapter_rows(self, html_text: str, manga_code: str) -> List[Chapter]:
        """Bóc tách các hàng chapter từ cấu trúc DOM .mchap-item của comix.to."""
        soup = BeautifulSoup(html_text, "html.parser")
        items = soup.select(".mchap-item")

        chapters: List[Chapter] = []
        seen_ids = set()

        for li in items:
            a_tag = li.select_one(".mchap-row__primary")
            if not a_tag or not a_tag.get("href"):
                continue

            href = a_tag["href"]
            match = CHAPTER_URL_REGEX.search(href)
            if not match:
                # Thử pattern đơn giản: /title/{manga}/{chapter_id}-...
                nums = re.findall(r"/(\d+)-chapter-", href)
                if nums:
                    ch_id = nums[0]
                    ch_num = re.findall(r"-chapter-([a-zA-Z0-9.]+)", href)
                    ch_num_val = ch_num[0] if ch_num else "0"
                else:
                    continue
            else:
                ch_id, ch_num_val = match.group(1), match.group(2)

            if ch_id in seen_ids:
                continue
            seen_ids.add(ch_id)

            # Tiêu đề & Scanlator
            title_tag = li.select_one(".mchap-row__title")
            group_tag = li.select_one(".mchap-row__group")

            title_text = title_tag.text.strip() if title_tag else ""
            display_title = f"Chapter {ch_num_val}" + (f": {title_text}" if title_text else "")

            scanlator = None
            if group_tag:
                span = group_tag.select_one("span")
                scanlator = span.text.strip() if span else group_tag.text.strip()
            elif li.select_one(".is-official"):
                scanlator = "Official"

            full_chapter_url = (
                href if href.startswith("http") else f"{self.base_url}{href}"
            )

            chapters.append(
                Chapter(
                    id=ch_id,
                    title=display_title,
                    chapter_number=str(ch_num_val),
                    url=full_chapter_url,
                    scanlator=scanlator,
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
        Trích xuất danh sách link ảnh của chapter.
        Thử cào HTML tĩnh trước; nếu trang dùng reader canvas/decryption như comix-downloader,
        khởi động headless browser nodriver ngắn hạn để bóc tách và giải phóng RAM tức thì.
        """
        target_url = (
            chapter_id_or_url
            if chapter_id_or_url.startswith("http")
            else f"{self.base_url}/title/manga/{chapter_id_or_url}-chapter-1"
        )

        resp = await self._request("GET", target_url)
        soup = BeautifulSoup(resp.text, "html.parser")

        # 1. Thử bóc tách thẻ img trong .rpage-page
        page_elements = soup.select(".rpage-page")
        image_urls: List[str] = []

        for p in page_elements:
            img = p.select_one("img")
            if img and img.get("src"):
                src = img["src"]
                if not src.startswith("data:") and not src.startswith("blob:"):
                    image_urls.append(src)

        if image_urls:
            return image_urls

        # 2. Fallback: Nếu ảnh được mã hóa hoặc render qua Canvas (như mô tả trong comix-downloader),
        # sử dụng nodriver để scroll và trích xuất ảnh chuẩn
        logger.info(f"[Comix] Trang reader yêu cầu render Canvas/DOM. Đang khởi động nodriver: {target_url}")
        return await self._extract_pages_via_nodriver(target_url)

    async def _extract_pages_via_nodriver(self, chapter_url: str) -> List[str]:
        """
        Khởi động nodriver ngắn hạn để trích xuất ảnh từ các element .rpage-page,
        sau đó đóng CDP an toàn và giải phóng 100% RAM.
        """
        browser_args = [
            "--window-size=1280,800",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
        ] + get_chrome_dns_args()

        browser: Optional[uc.Browser] = None
        extracted_urls: List[str] = []

        try:
            browser = await uc.start(headless=True, browser_args=browser_args)
            page = await browser.get(chapter_url)

            # Chờ các trang .rpage-page xuất hiện
            for _ in range(40):
                count = await page.evaluate("document.querySelectorAll('.rpage-page').length")
                if count and int(count) > 0:
                    break
                await asyncio.sleep(0.5)

            # Lấy danh sách ảnh từ img src hoặc canvas toDataURL
            extract_js = """(() => {
                const results = [];
                const pages = document.querySelectorAll('.rpage-page');
                pages.forEach(p => {
                    const img = p.querySelector('img');
                    if (img && img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:image/svg')) {
                        results.append(img.src);
                    } else {
                        const canvas = p.querySelector('canvas');
                        if (canvas && canvas.width > 20 && canvas.height > 20) {
                            try {
                                results.push(canvas.toDataURL('image/webp', 0.95));
                            } catch(e) {}
                        }
                    }
                });
                return results;
            })()"""

            try:
                raw_urls = await page.evaluate(extract_js)
                if isinstance(raw_urls, list):
                    extracted_urls = [str(u) for u in raw_urls if u]
            except Exception as e:
                logger.debug(f"[Comix] Lỗi evaluate nodriver: {e}")

            return extracted_urls

        finally:
            # Áp dụng cơ chế đóng CDP an toàn của comix-downloader
            if browser:
                aclose = getattr(browser, "aclose", None)
                if callable(aclose):
                    try:
                        await asyncio.wait_for(aclose(), timeout=3.0)
                    except Exception:
                        pass
                try:
                    browser.stop()
                except Exception:
                    pass
                gc.collect()
