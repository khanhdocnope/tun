"""
Quản lý Session và Cookie Jar an toàn.
Tự động lưu và nạp cookies (cf_cookies.dat) từ trình duyệt nodriver.
"""

import json
from pathlib import Path
import threading
from typing import Optional
import requests

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


def load_cookies_into_session(session: requests.Session, cookie_file: Path = COOKIE_FILE_PATH):
    """Nạp cookies đã lưu vào session."""
    with _cookie_lock:
        if not cookie_file.exists():
            return
        try:
            with open(cookie_file, "r", encoding="utf-8") as f:
                cookies = json.load(f)
                for item in cookies:
                    session.cookies.set(
                        name=item.get("name"),
                        value=item.get("value"),
                        domain=item.get("domain", ""),
                        path=item.get("path", "/")
                    )
        except Exception as e:
            print(f"[Session] Cảnh báo: Không thể nạp cookie từ {cookie_file}: {e}")


def save_cookies_from_list(cookies: list, cookie_file: Path = COOKIE_FILE_PATH):
    """Lưu danh sách cookie từ trình duyệt vào file an toàn."""
    with _cookie_lock:
        try:
            with open(cookie_file, "w", encoding="utf-8") as f:
                json.dump(cookies, f, indent=2)
            print(f"[Session] Đã cập nhật {len(cookies)} cookies vào {cookie_file}")
        except Exception as e:
            print(f"[Session] Lỗi ghi cookie: {e}")
