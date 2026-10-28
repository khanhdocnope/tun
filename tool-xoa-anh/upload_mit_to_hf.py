import os
import sys
from pathlib import Path
from huggingface_hub import HfApi

def get_hf_token() -> str:
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        return token
    for env_dir in (Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent):
        env_file = env_dir / ".env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line.startswith("HF_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

TARGET_SPACE = "dobietdc/manga-text-cleaner"
BASE_DIR = Path(__file__).resolve().parent / "manga-image-translator-ref"

def upload():
    token = get_hf_token()
    if not token:
        print("[!] HF_TOKEN not found in environment or .env file.")
        sys.exit(1)
    api = HfApi(token=token)
    print(f"[*] Uploading lightweight manga-image-translator to Space: {TARGET_SPACE}")
    print(f"[*] Source directory: {BASE_DIR}")
    
    # Upload folder
    api.upload_folder(
        folder_path=str(BASE_DIR),
        repo_id=TARGET_SPACE,
        repo_type="space",
        ignore_patterns=[
            ".git*",
            "__pycache__/*",
            "*.pyc",
            "*.ipynb",
            "server/*",
            "pip-modules/*",
            "test/*",
            "examples/*",
        ],
        commit_message="Deploy lightweight manga-image-translator (inpaint only)",
    )
    print(f"[+] Upload complete! Space: https://huggingface.co/spaces/{TARGET_SPACE}")

if __name__ == "__main__":
    upload()
