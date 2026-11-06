"""
Bộ quản lý trình duyệt Chromium thông qua nodriver & Chrome DevTools Protocol (CDP).
Triển khai cơ chế Smart Headless + Fallback Headed Window để vượt Cloudflare Turnstile / WAF.
Kế thừa tinh hoa từ comix-downloader (Yui007/comix-downloader):
- Đóng an toàn CDP websocket connection (`await browser.aclose()`) với timeout 3s trước khi `browser.stop()`.
- Hỗ trợ giải Turnstile WAF chuyên biệt của Comix.to tại https://comix.to/@waf/challenge với cookie `waf_pass`.
- Dọn dẹp cưỡng chế toàn bộ tiến trình Chromium con bằng `psutil` để giải phóng 100% RAM.
"""

import asyncio
import gc
import logging
import os
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import nodriver as uc
import psutil

from src.core.session import save_cookies_from_list
from src.utils.dns import enable_smart_dns, get_chrome_dns_args

logger = logging.getLogger(__name__)

# Khóa chống xung đột khi nhiều tác vụ đồng thời yêu cầu giải WAF
_bypass_lock = asyncio.Lock()


class CloudflareBypassRunner:
    """
    Quản lý vòng đời trình duyệt nodriver ngắn hạn (Ephemeral Browser Lifecycle).
    """

    def __init__(
        self,
        headless_timeout: float = 8.0,
        headed_timeout: float = 40.0,
        user_agent: Optional[str] = None,
    ):
        self.headless_timeout = headless_timeout
        self.headed_timeout = headed_timeout
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
        )
        enable_smart_dns()

    @staticmethod
    def _is_challenge_resolved(
        cookies: list,
        title: str,
        current_url: str,
        required_cookie: Optional[str] = None,
    ) -> bool:
        """
        Kiểm tra xem Cloudflare / WAF challenge đã được giải xong chưa:
        - Nếu chỉ định required_cookie (ví dụ: 'waf_pass' cho comix.to): kiểm tra đúng cookie đó.
        - Mặc định: Có cookie cf_clearance hoặc waf_pass
        - Tiêu đề không còn là "Just a moment...", "Attention Required!", "Cloudflare"
        - URL không còn nằm trong challenge-platform hoặc @waf/challenge
        """
        cookie_names = {getattr(c, "name", "") for c in cookies}
        if required_cookie:
            return required_cookie in cookie_names

        has_clearance = "cf_clearance" in cookie_names or "waf_pass" in cookie_names

        low_title = (title or "").lower()
        is_challenge_page = any(
            pattern in low_title
            for pattern in [
                "just a moment",
                "attention required",
                "cloudflare",
                "verify you are human",
                "security check",
            ]
        )
        in_challenge_url = (
            "/cdn-cgi/challenge-platform" in current_url
            or "@waf/challenge" in current_url
        )

        if has_clearance:
            return True

        # Nếu trang đã tải nội dung bình thường và không còn ở trang challenge
        if not is_challenge_page and not in_challenge_url and title.strip():
            return True

        return False

    @staticmethod
    def _extract_cookie_dicts(cookies: list) -> List[Dict[str, Any]]:
        """Chuyển đổi cookie CDP sang định dạng dict chuẩn cho Session."""
        cookie_list: List[Dict[str, Any]] = []
        for c in cookies:
            name = getattr(c, "name", None)
            value = getattr(c, "value", None)
            if not name or value is None:
                continue

            cookie_dict = {
                "name": str(name),
                "value": str(value),
                "domain": getattr(c, "domain", "") or "",
                "path": getattr(c, "path", "/") or "/",
            }
            if hasattr(c, "expires") and c.expires is not None:
                cookie_dict["expires"] = c.expires
            if hasattr(c, "secure"):
                cookie_dict["secure"] = bool(c.secure)
            if hasattr(c, "http_only"):
                cookie_dict["httpOnly"] = bool(c.http_only)

            cookie_list.append(cookie_dict)
        return cookie_list

    async def _terminate_browser(self, browser: Optional[uc.Browser]) -> None:
        """
        Đóng an toàn CDP connection trước và tiêu diệt triệt để toàn bộ tiến trình Chromium
        theo chuẩn comix-downloader để đảm bảo không bị rò rỉ websocket hay process con.
        """
        if not browser:
            return

        pid: Optional[int] = None
        try:
            if hasattr(browser, "_process") and browser._process:
                pid = browser._process.pid
            elif hasattr(browser, "_process_pid") and browser._process_pid:
                pid = browser._process_pid
        except Exception:
            pass

        # 1. Đóng CDP connection socket an toàn trước với timeout 3s (từ comix-downloader)
        aclose = getattr(browser, "aclose", None)
        if callable(aclose):
            try:
                await asyncio.wait_for(aclose(), timeout=3.0)
                logger.debug("[BrowserRunner] Đã đóng an toàn CDP connection qua aclose().")
            except Exception as exc:
                logger.debug(f"[BrowserRunner] aclose error (bỏ qua): {exc}")

        # 2. Dừng tiến trình browser
        stop = getattr(browser, "stop", None)
        if callable(stop):
            try:
                stop()
            except Exception as e:
                logger.debug(f"[BrowserRunner] Ngoại lệ khi browser.stop(): {e}")

        # 3. Dọn dẹp cưỡng chế qua psutil nếu tiến trình Chromium vẫn còn trong RAM
        if pid:
            try:
                if psutil.pid_exists(pid):
                    parent_proc = psutil.Process(pid)
                    children = parent_proc.children(recursive=True)
                    for child in children:
                        try:
                            child.kill()
                        except Exception:
                            pass
                    parent_proc.kill()
                    logger.debug(
                        f"[BrowserRunner] Đã dọn dẹp Chromium process PID {pid} và {len(children)} con."
                    )
            except psutil.NoSuchProcess:
                pass
            except Exception as e:
                logger.debug(f"[BrowserRunner] Lỗi kiểm tra psutil: {e}")

        # Thu hồi rác Python
        gc.collect()

    async def _attempt_headless(
        self, target_url: str, required_cookie: Optional[str] = None
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Giai đoạn 1: Chạy ẩn hoàn toàn (Headless).
        Nếu Cloudflare cho qua tự động trong 8s, lấy cookies và đóng trình duyệt.
        """
        logger.info(f"[BrowserRunner] Khởi động Smart Headless để kiểm tra WAF: {target_url}")
        browser_args = [
            "--window-size=1280,800",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            f"--user-agent={self.user_agent}",
        ] + get_chrome_dns_args()

        browser: Optional[uc.Browser] = None
        try:
            browser = await uc.start(headless=True, browser_args=browser_args)
            tab = await browser.get(target_url)

            start_time = asyncio.get_event_loop().time()
            check_interval = 0.8

            while (asyncio.get_event_loop().time() - start_time) < self.headless_timeout:
                await asyncio.sleep(check_interval)
                cookies = await browser.cookies.get_all()
                title = tab.title or ""
                url = tab.url or target_url

                if self._is_challenge_resolved(
                    cookies, title, url, required_cookie=required_cookie
                ):
                    logger.info("[BrowserRunner] Vượt qua Cloudflare thành công trong chế độ Headless!")
                    return self._extract_cookie_dicts(cookies)

            logger.info(
                f"[BrowserRunner] Sau {self.headless_timeout}s Headless chưa giải xong challenge. Cần fallback Headed."
            )
            return None

        except Exception as e:
            logger.warning(f"[BrowserRunner] Ngoại lệ trong Headless mode: {e}")
            return None
        finally:
            await self._terminate_browser(browser)

    async def _attempt_headed_fallback(
        self, target_url: str, required_cookie: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Giai đoạn 2: Fallback mở cửa sổ nhỏ (Headed) để giải quyết Turnstile tương tác.
        Đóng ngay lập tức khi xuất hiện cookie mong muốn.
        """
        logger.info(
            f"[BrowserRunner] Mở cửa sổ nhỏ (Headed Window) để vượt Cloudflare Turnstile: {target_url}"
        )
        browser_args = [
            "--window-size=480,640",
            "--window-position=300,150",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-agent={self.user_agent}",
        ] + get_chrome_dns_args()

        browser: Optional[uc.Browser] = None
        try:
            browser = await uc.start(headless=False, browser_args=browser_args)
            tab = await browser.get(target_url)

            start_time = asyncio.get_event_loop().time()
            check_interval = 1.0

            while (asyncio.get_event_loop().time() - start_time) < self.headed_timeout:
                await asyncio.sleep(check_interval)
                cookies = await browser.cookies.get_all()
                title = tab.title or ""
                url = tab.url or target_url

                if self._is_challenge_resolved(
                    cookies, title, url, required_cookie=required_cookie
                ):
                    logger.info("[BrowserRunner] Đã vượt qua Cloudflare thành công trong cửa sổ Headed!")
                    return self._extract_cookie_dicts(cookies)

            raise TimeoutError(
                f"[BrowserRunner] Hết thời gian chờ {self.headed_timeout}s vượt qua Cloudflare Turnstile."
            )

        finally:
            # QUAN TRỌNG: Đóng ngay lập tức để giải phóng 100% RAM
            await self._terminate_browser(browser)

    async def bypass_cloudflare(
        self, target_url: str, required_cookie: Optional[str] = None
    ) -> bool:
        """
        Quy trình Smart Headless Bypass tổng thể:
        1. Thử giải ẩn trong 8s.
        2. Nếu chưa được, mở cửa sổ nhỏ fallback.
        3. Lưu cookies vào cf_cookies.dat.
        4. Đóng hoàn toàn trình duyệt Chromium.
        """
        async with _bypass_lock:
            # Giai đoạn 1: Headless
            cookies = await self._attempt_headless(
                target_url, required_cookie=required_cookie
            )

            # Giai đoạn 2: Fallback Headed nếu giai đoạn 1 chưa giải quyết được
            if not cookies:
                cookies = await self._attempt_headed_fallback(
                    target_url, required_cookie=required_cookie
                )

            if cookies:
                save_cookies_from_list(cookies)
                logger.info(f"[BrowserRunner] Đã cập nhật {len(cookies)} cookies vào session.")
                return True

            return False


async def bypass_url(
    target_url: str,
    headless_timeout: float = 8.0,
    headed_timeout: float = 40.0,
    required_cookie: Optional[str] = None,
) -> bool:
    """Hàm tiện ích bất đồng bộ để vượt Cloudflare cho một URL đích."""
    runner = CloudflareBypassRunner(
        headless_timeout=headless_timeout, headed_timeout=headed_timeout
    )
    return await runner.bypass_cloudflare(target_url, required_cookie=required_cookie)


async def bypass_comix_waf(
    headless_timeout: float = 8.0, headed_timeout: float = 60.0
) -> bool:
    """
    Vượt qua Turnstile WAF challenge chuyên biệt của comix.to tại https://comix.to/@waf/challenge
    để trích xuất cookie 'waf_pass' kế thừa từ comix-downloader.
    """
    return await bypass_url(
        target_url="https://comix.to/@waf/challenge",
        headless_timeout=headless_timeout,
        headed_timeout=headed_timeout,
        required_cookie="waf_pass",
    )


def run_bypass_sync(
    target_url: str,
    headless_timeout: float = 8.0,
    headed_timeout: float = 40.0,
    required_cookie: Optional[str] = None,
) -> bool:
    """Hàm tiện ích đồng bộ cho các module chạy trên ThreadPoolExecutor hoặc CLI."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(
                    asyncio.run,
                    bypass_url(
                        target_url,
                        headless_timeout,
                        headed_timeout,
                        required_cookie=required_cookie,
                    ),
                ).result()
        else:
            return loop.run_until_complete(
                bypass_url(
                    target_url,
                    headless_timeout,
                    headed_timeout,
                    required_cookie=required_cookie,
                )
            )
    except RuntimeError:
        return asyncio.run(
            bypass_url(
                target_url,
                headless_timeout,
                headed_timeout,
                required_cookie=required_cookie,
            )
        )
