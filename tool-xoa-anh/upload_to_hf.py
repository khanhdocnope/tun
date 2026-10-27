"""
Đồng bộ mã nguồn backend (chỉ xóa chữ) lên Hugging Face Space.

Repo: https://huggingface.co/spaces/dobietdc/backe-manga-remove
Chỉ upload các file cần cho Space chạy; không upload test, ảnh kết quả cũ hay file cấu hình bí mật.

Cách dùng:
    python upload_to_hf.py --dry-run     # xem trước file sẽ gửi
    python upload_to_hf.py               # đẩy thật
    python upload_to_hf.py --delete-only # chỉ xóa file thừa trên Space

Token: đặt HF_TOKEN trong .env (thư mục này hoặc thư mục cha) hoặc biến môi trường.
"""

import os
import re
import sys
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

REPO_ID = os.environ.get("HF_SPACE_ID", "dobietdc/backe-manga-remove")
REPO_TYPE = "space"

PROJECT_FILES = [
    "app.py",
    "manga_cleaner.py",
    "text_detector.py",
    "mask_logic.py",
    "bubble_detector.py",
    "download_models.py",
    "bench_clean.py",
    "requirements.txt",
    "README.md",
]
PROJECT_FOLDERS = [
    ("examples", "examples"),
]

# Files removed from the backend (OCR / dịch / Docker / tài liệu cũ). Xóa luôn khỏi Space.
DELETE_ON_SPACE = [
    "Dockerfile",
    "prompt.txt",
    "core/__init__.py",
    "core/ocr_engine.py",
    "core/translator.py",
]

BASE_DIR = Path(__file__).resolve().parent
TOKEN_PATTERN = re.compile(r"hf_[A-Za-z0-9]{30,}")


def load_env() -> Tuple[str, str]:
    token = os.environ.get("HF_TOKEN", "").strip()
    repo_id = os.environ.get("HF_SPACE_ID", "").strip()
    for env_dir in (BASE_DIR, BASE_DIR.parent):
        env_file = env_dir / ".env"
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k == "HF_TOKEN" and not token:
                token = v
                os.environ["HF_TOKEN"] = v
            elif k == "HF_SPACE_ID" and not repo_id:
                repo_id = v
                os.environ["HF_SPACE_ID"] = v
    if not repo_id:
        repo_id = "dobietdc/backe-manga-remove"
    return token, repo_id


def scan_for_tokens(text: str) -> bool:
    return bool(TOKEN_PATTERN.search(text))


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    delete_only = "--delete-only" in sys.argv

    token, repo_id = load_env()
    if not token:
        print("[!] Chưa có HF_TOKEN (thêm vào .env hoặc biến môi trường).")
        return 1

    files = [BASE_DIR / name for name in PROJECT_FILES if (BASE_DIR / name).is_file()]
    missing = [name for name in PROJECT_FILES if not (BASE_DIR / name).is_file()]
    if missing and not delete_only:
        print(f"[!] Thiếu file: {missing}")
        return 1

    for path in files:
        if scan_for_tokens(path.read_text(encoding="utf-8", errors="ignore")):
            print(f"[!] {path.name} chứa token HF dạng thật -> dừng để tránh lộ secret.")
            return 1

    print(f"[*] Space   : {repo_id}")
    print(f"[*] Nguồn   : {BASE_DIR}")
    print(f"[*] File    : {[p.name for p in files]}")
    print(f"[*] Thư mục : {[local for local, _ in PROJECT_FOLDERS if (BASE_DIR / local).is_dir()]}")
    print(f"[*] Xóa trên Space: {DELETE_ON_SPACE}")
    if dry_run:
        print("[dry-run] Không upload gì.")
        return 0

    from huggingface_hub import HfApi

    api = HfApi(token=token)

    if not delete_only:
        for path in files:
            print(f" -> {path.name} ...", end=" ")
            api.upload_file(
                path_or_fileobj=str(path),
                path_in_repo=path.name,
                repo_id=repo_id,
                repo_type=REPO_TYPE,
                commit_message=f"Update {path.name} (text-removal backend)",
            )
            print("OK")

        for local, repo_dir in PROJECT_FOLDERS:
            folder = BASE_DIR / local
            if not folder.is_dir():
                continue
            print(f" -> {local}/ ...", end=" ")
            api.upload_folder(
                folder_path=str(folder),
                path_in_repo=repo_dir,
                repo_id=repo_id,
                repo_type=REPO_TYPE,
                allow_patterns=["*.jpg", "*.png"],
                commit_message=f"Update {repo_dir}",
            )
            print("OK")

    for rel in DELETE_ON_SPACE:
        try:
            api.delete_file(path_in_repo=rel, repo_id=repo_id, repo_type=REPO_TYPE,
                            commit_message=f"Remove {rel} (text-removal cleanup)")
            print(f" [x] đã xóa {rel}")
        except Exception as exc:  # noqa: BLE001
            print(f" [ ] {rel}: {exc}")

    print(f"\n[+] Xong. Space: https://huggingface.co/spaces/{repo_id}")
    print(f"    Kiểm tra: curl https://huggingface.co/spaces/{repo_id}/resolve/main/app.py | head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
