"""
Script đồng bộ và đẩy mã nguồn dự án lên Hugging Face Space.
Repo: https://huggingface.co/spaces/dobietdc/backe-manga-remove
"""

import os
import sys
from pathlib import Path
from huggingface_hub import HfApi

# Fix encoding cho console Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ================= CẤU HÌNH =================
HF_TOKEN = "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"
REPO_ID = "dobietdc/backe-manga-remove"
REPO_TYPE = "space"

PROJECT_FILES = [
    "app.py",
    "manga_cleaner.py",
    "bubble_detector.py",
    "mask_logic.py",
    "download_models.py",
    "requirements.txt",
    "README.md",
    "Dockerfile",
]
PROJECT_FOLDERS = [
    ("examples", "examples"),
    ("core", "core"),
]
# ============================================


BASE_DIR = Path(__file__).resolve().parent

def main():
    token = os.environ.get("HF_TOKEN") or HF_TOKEN

    if not token or token == "PASTE_YOUR_HF_TOKEN_HERE":
        print("[!] LOI: Ban chua dien Hugging Face Token!")
        sys.exit(1)

    api = HfApi(token=token)

    print(f"[*] Bat dau dong bo ma nguon len Space: {REPO_ID} ...")
    print(f"[*] Thu muc goc du an: {BASE_DIR}")

    # 1. Upload cac file ma nguon goc
    for fname in PROJECT_FILES:
        fpath = BASE_DIR / fname
        if fpath.is_file():
            print(f" -> Dang tai file: {fname} ...")
            try:
                api.upload_file(
                    path_or_fileobj=str(fpath),
                    path_in_repo=fname,
                    repo_id=REPO_ID,
                    repo_type=REPO_TYPE,
                    commit_message=f"Update {fname} (AI Manga Translator & FastAPI backend)",
                )
                print(f"    [OK] Da cap nhat {fname}")
            except Exception as e:
                print(f"    [!] Loi khi upload {fname}: {e}")
        else:
            print(f"    [?] Khong tim thay file: {fpath}")

    # 2. Upload thu muc
    for local_f, repo_f in PROJECT_FOLDERS:
        fpath = BASE_DIR / local_f
        if fpath.is_dir():
            print(f" -> Dang tai thu muc: {local_f} -> {repo_f} ...")
            try:
                api.upload_folder(
                    folder_path=str(fpath),
                    path_in_repo=repo_f,
                    repo_id=REPO_ID,
                    repo_type=REPO_TYPE,
                    commit_message=f"Update folder {repo_f}",
                )
                print(f"    [OK] Da cap nhat {repo_f}")
            except Exception as e:
                print(f"    [!] Loi khi upload thu muc {local_f}: {e}")

    print("\n[+] HOAN TAT DONG BO LEN HUGGING FACE SPACE!")
    print(f"[*] Link Space: https://huggingface.co/spaces/{REPO_ID}")


if __name__ == "__main__":
    main()
