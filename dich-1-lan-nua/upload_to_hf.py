#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Đẩy backend Comic Translation Studio (`dich-1-lan-nua/backend`) lên Hugging Face Space (Gradio SDK).

Backend deploy dạng Gradio SDK (tham khao tool-xoa-anh/app.py):
  - `app.py`      : tao FastAPI app cua Gradio, gan CORS + router /api/v1/*, launch, block_thread
  - `README.md`   : front matter `sdk: gradio`, `sdk_version: 5.20.0`, `app_file: app.py`
  - `requirements.txt`, `packages.txt`: thư viện Python + gói hệ thống (libgl1)

Cách dùng:
    python upload_to_hf.py --dry-run     # xem trước file sẽ gửi
    python upload_to_hf.py               # đẩy thật

Token: đặt `HF_TOKEN=hf_...` trong file .env (thư mục này hoặc biến môi trường),
hoặc đăng nhập sẵn: `huggingface-cli login`

Tuỳ chọn:
    --repo  <owner/space>   Space đích (mặc định dobietdc/comic-studio-backend)
    --dir   <thư mục>       Thư mục backend (mặc định: backend)
    --message "..."         Commit message
    --dry-run               Chỉ liệt kê file, không upload
    --create                Tạo Space (Gradio SDK, CPU free) nếu chưa tồn tại
"""

import argparse
import fnmatch
import os
import re
import sys
from pathlib import Path

# Console Windows mặc định cp1252 -> ép UTF-8 để không lỗi font
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_REPO = os.environ.get("HF_SPACE_ID", "dobietdc/manga-text-cleaner")
DEFAULT_DIR = "backend"

# The Xet chunk cache can hit Windows ACL/permission issues (spawn staging
# files under %USERPROFILE%\.cache\huggingface\xet).  Falling back to regular
# HTTP upload is slower but far more reliable for this 20 MB Space.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# Không đẩy lên Space: môi trường ảo, cache, bí mật, dữ liệu tạm
IGNORE_PATTERNS = [
    ".git/*",
    "*/.git/*",
    ".venv/*",
    ".venv*",
    "venv/*",
    "env/*",
    "node_modules/*",
    "*/node_modules/*",
    "__pycache__/*",
    "*/__pycache__/*",
    "*.pyc",
    "*.pyo",
    ".pytest_cache/*",
    "*/.pytest_cache/*",
    ".mypy_cache/*",
    ".ruff_cache/*",
    ".env",
    ".env.*",
    "storage/*",
    "*.log",
    "*.tmp",
    "*.zip",
]

SECRET_RE = re.compile(r"hf_[A-Za-z0-9]{30,}")
TEXT_SUFFIXES = {".py", ".md", ".txt", ".json", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".bat", ".sh"}


def load_env() -> None:
    """Nạp .env ở thư mục script và thư mục cha (nếu có)."""
    try:
        from dotenv import load_dotenv
    except Exception:
        return
    for candidate in (BASE_DIR / ".env", BASE_DIR.parent / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False)


def is_ignored(rel_path: str) -> bool:
    return any(fnmatch.fnmatch(rel_path, pattern) for pattern in IGNORE_PATTERNS)


def collect_files(src: Path):
    """Danh sách (đường dẫn tương đối, số byte) sẽ gửi lên Space."""
    files = []
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(src).as_posix()
        if not is_ignored(rel):
            files.append((rel, path.stat().st_size))
    return sorted(files)


def human_size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


def find_secret_files(src: Path, files):
    """Tìm token HF lộ trong file text (không in token ra màn hình)."""
    hits = []
    for rel, size in files:
        path = src / rel
        if path.suffix.lower() not in TEXT_SUFFIXES or size > 1_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if SECRET_RE.search(text):
            hits.append(rel)
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload backend Comic Translation Studio lên Hugging Face Space")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Space đích (owner/space)")
    parser.add_argument("--dir", default=DEFAULT_DIR, help="Thư mục backend cần đẩy lên")
    parser.add_argument("--message", default="Update backend", help="Commit message")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ liệt kê file, không upload")
    parser.add_argument("--create", action="store_true", help="Tạo Space nếu chưa tồn tại")
    args = parser.parse_args()

    load_env()
    src = (BASE_DIR / args.dir).resolve()
    if not src.is_dir():
        print(f"[!] Không tìm thấy thư mục backend: {src}")
        return 1

    # Space cần đủ 3 file này mới khởi động được
    for required in ("app.py", "README.md", "requirements.txt"):
        if not (src / required).is_file():
            print(f"[!] Thiếu {required} trong {src} — Space sẽ không chạy được.")
            return 1

    files = collect_files(src)
    total_size = sum(size for _, size in files)
    print(f"[*] Space : {args.repo}")
    print(f"[*] Nguồn : {src}")
    print(f"[*] Gửi   : {len(files)} file, {human_size(total_size)}")
    for rel, size in files:
        print(f"    {human_size(size):>9}  {rel}")

    leaked = find_secret_files(src, files)
    if leaked:
        print("\n[!] DỪNG LẠI: phát hiện token Hugging Face trong file sắp public:")
        for rel in leaked:
            print(f"    - {rel}")
        print("    Hãy xoá token khỏi file rồi chạy lại.")
        return 1

    if args.dry_run:
        print("\n[=] Dry-run: chưa upload gì cả. Bỏ --dry-run để đẩy thật.")
        return 0

    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("[!] Thiếu thư viện: pip install huggingface_hub python-dotenv")
        return 1

    token = (os.environ.get("HF_TOKEN") or "").strip() or None
    api = HfApi(token=token)

    try:
        who = api.whoami()
        print(f"[*] Đăng nhập: {who.get('name')}")
    except Exception as exc:
        print(f"[!] Chưa đăng nhập Hugging Face: {exc}")
        print("    -> Đặt HF_TOKEN trong .env hoặc chạy: huggingface-cli login")
        return 1

    if args.create:
        try:
            api.create_repo(repo_id=args.repo, repo_type="space", space_sdk="gradio", exist_ok=True)
            print(f"[*] Space sẵn sàng: {args.repo}")
        except Exception as exc:
            print(f"[!] Không tạo được Space: {exc}")
            return 1

    print(f"\n[*] Đang upload {len(files)} file...")
    try:
        api.upload_folder(
            folder_path=str(src),
            repo_id=args.repo,
            repo_type="space",
            commit_message=args.message,
            ignore_patterns=IGNORE_PATTERNS,
            token=token,
        )
    except Exception as exc:
        text = str(exc)
        print(f"[!] Upload thất bại: {text}")
        if "401" in text or "Invalid user token" in text:
            print("    -> Token sai/hết hạn. Tạo token mới (quyền Write): https://huggingface.co/settings/tokens")
        elif "403" in text:
            print("    -> Token không có quyền ghi vào Space này.")
        elif "404" in text:
            print(f"    -> Không thấy Space '{args.repo}'. Kiểm tra --repo hoặc thêm --create.")
        return 1

    url = f"https://{args.repo.replace('/', '-')}.hf.space"
    print("\n[+] XONG!")
    print(f"[*] Space : https://huggingface.co/spaces/{args.repo}")
    print(f"[*] API   : {url}")
    print(f"[*] Dùng URL API trên trong Server Settings của Studio.")
    print("[!] Space CPU free: lần gọi đầu có thể cold-start 15-30s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
