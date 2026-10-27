"""Push backend/ to the Hugging Face Space and report the build status.

Usage:
    python push_space.py --dry-run          # verify token/space only
    python push_space.py                    # push
    python push_space.py --wait             # push then poll until RUNNING
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
ROOT = Path(__file__).resolve().parent
SPACE = os.environ.get("HF_SPACE_ID", "dobietdc/manga-text-cleaner")
IGNORE = [
    ".venv/*", "__pycache__/*", "*/__pycache__/*", "*.pyc",
    ".pytest_cache/*", "storage/*", "*.log", ".env",
    "models/*.pt", "models/*.onnx", "pip-*/*", "pip-*",
    "tmp*", "*.part", "*.zip", 
]


def load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def probe(url: str, label: str, timeout: float = 90.0) -> bool:
    try:
        import httpx

        resp = httpx.get(f"{url}{label}", timeout=timeout)
        print(f"[*] {label} {resp.status_code}: {resp.text[:600]}")
        return resp.status_code == 200
    except Exception as exc:
        print(f"[!] {label} failed: {exc}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--wait", action="store_true")
    parser.add_argument(
        "--message", default="fix(space): ZeroGPU-compatible torch pin + zip/image UI"
    )
    args = parser.parse_args()

    load_env()
    token = (os.environ.get("HF_TOKEN") or "").strip()
    if not token or not re.match(r"^hf_[A-Za-z0-9]{20,}$", token):
        print(f"[!] HF_TOKEN missing or malformed (len={len(token)}) in {ROOT / '.env'}")
        return 2

    from huggingface_hub import HfApi

    api = HfApi(token=token)
    try:
        who = api.whoami()
        info = api.space_info(SPACE)
    except Exception as exc:
        print(f"[!] cannot reach the Hub: {exc}")
        return 2
    runtime = info.runtime
    print(f"[*] token user : {who.get('name')}")
    print(f"[*] space       : {SPACE} sdk={info.sdk} stage={getattr(runtime, 'stage', '?')}")
    if getattr(runtime, "raw", {}).get("errorMessage"):
        print(f"[!] stage error : {runtime.raw['errorMessage']}")

    if args.dry_run:
        return 0

    api.upload_folder(
        folder_path=str(ROOT / "backend"),
        repo_id=SPACE,
        repo_type="space",
        commit_message=args.message,
        ignore_patterns=IGNORE,
        token=token,
    )
    print("[+] pushed")

    if not args.wait:
        return 0

    url = f"https://{SPACE.replace('/', '-')}.hf.space"
    for attempt in range(60):
        runtime = api.space_info(SPACE).runtime
        stage = getattr(runtime, "stage", None)
        error = getattr(runtime, "raw", {}).get("errorMessage")
        print(f"  [{attempt:02d}] stage={stage}" + (f" error={error}" if error else ""), flush=True)
        if stage in ("RUNNING", "RUNTIME_ERROR", "BUILD_ERROR", "CONFIG_ERROR", "PAUSED"):
            break
        time.sleep(20)

    probe(f"{url}/api/v1/health", "/api/v1/health")
    probe(f"{url}/api/v1/capabilities", "/api/v1/capabilities")
    return 0


if __name__ == "__main__":
    sys.exit(main())

