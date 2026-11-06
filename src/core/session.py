"""
Quản lý Session và Cookie Jar an toàn.
Tự động lưu và nạp cookies (cf_cookies.dat) từ trình duyệt nodriver.
"""

import json
import logging
from pathlib import Path
import threading
from typing import Optional
import requests

logger = logging.getLogger(__name__)

COOKIE_FILE_PATH = Path(__file__).resolve().parents[2] / "cf_cookies.dat"
_cookie_lock = threading.Lock()


def get_http_session(user_agent: Optional[str] = None) -> requests.Session:
    """
    Tạo requests.Session nạp sẵn cookies từ Cloudflare bypass.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Referer": "https://google.com/",
    })

    # Nạp cookies từ file nếu tồn tại
    load_cookies_into_session(session)
    return session


def get_saved_cookies(cookie_file: Path = COOKIE_FILE_PATH) -> list:
    """Đọc danh sách cookie từ file."""
    with _cookie_lock:
        if not cookie_file.exists():
            return []
        try:
            with open(cookie_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"[Session] Cảnh báo: Không thể đọc cookie từ {cookie_file}: {e}")
            return []


def load_cookies_into_session(session: requests.Session, cookie_file: Path = COOKIE_FILE_PATH):
    """Nạp cookies đã lưu vào requests.Session."""
    cookies = get_saved_cookies(cookie_file)
    for item in cookies:
        name = item.get("name")
        value = item.get("value")
        if name and value:
            session.cookies.set(
                name=name,
                value=value,
                domain=item.get("domain", ""),
                path=item.get("path", "/")
            )


def load_cookies_into_httpx(client, cookie_file: Path = COOKIE_FILE_PATH):
    """Nạp cookies đã lưu vào httpx.Client hoặc httpx.AsyncClient."""
    cookies = get_saved_cookies(cookie_file)
    for item in cookies:
        name = item.get("name")
        value = item.get("value")
        domain = item.get("domain", "")
        # Domain cho httpx: bỏ dấu chấm đầu nếu có để tránh lỗi cookie mapping
        clean_domain = domain.lstrip(".") if domain else None
        if name and value:
            try:
                if clean_domain:
                    client.cookies.set(name, value, domain=clean_domain, path=item.get("path", "/"))
                else:
                    client.cookies.set(name, value, path=item.get("path", "/"))
            except Exception:
                pass


def save_cookies_from_list(cookies: list, cookie_file: Path = COOKIE_FILE_PATH):
    """Lưu danh sách cookie từ trình duyệt vào file an toàn."""
    with _cookie_lock:
        try:
            with open(cookie_file, "w", encoding="utf-8") as f:
                json.dump(cookies, f, indent=2)
            logger.info(f"[Session] Đã cập nhật {len(cookies)} cookies vào {cookie_file}")
        except Exception as e:
            logger.error(f"[Session] Lỗi ghi cookie: {e}")
