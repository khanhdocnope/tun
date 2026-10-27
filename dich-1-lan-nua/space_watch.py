"""Poll the Space runtime and print the container log tail.

Usage: python space_watch.py [--logs] [--minutes 15]
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
ROOT = Path(__file__).resolve().parent
SPACE = os.environ.get("HF_SPACE_ID", "dobietdc/manga-text-cleaner")


def token() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("HF_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("HF_TOKEN missing in .env")


def fetch_log(kind: str) -> str:
    req = urllib.request.Request(
        f"https://huggingface.co/api/spaces/{SPACE}/logs/{kind}",
        headers={"Authorization": f"Bearer {token()}"},
    )
    raw = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "ignore")
    out = []
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        try:
            message = json.loads(payload).get("data", "")
        except Exception:
            message = payload
        if message:
            out.append(message)
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--logs", action="store_true")
    parser.add_argument("--minutes", type=int, default=15)
    parser.add_argument("--kind", default="run", choices=["run", "build"])
    args = parser.parse_args()

    from huggingface_hub import HfApi

    api = HfApi(token=token())
    deadline = time.time() + args.minutes * 60
    last = None
    while time.time() < deadline:
        info = api.space_info(SPACE)
        runtime = info.runtime
        line = f"{info.sdk} {runtime.stage} {runtime.requested_hardware} " + (
            (runtime.raw.get("errorMessage") or "")[:120]
        )
        if line != last:
            print(line, flush=True)
            last = line
        if runtime.stage in ("RUNNING", "RUNTIME_ERROR", "BUILD_ERROR", "CONFIG_ERROR", "PAUSED"):
            break
        time.sleep(15)

    if args.logs:
        print("=" * 20, args.kind, flush=True)
        text = fetch_log(args.kind)
        print("\n".join(text.splitlines()[-120:]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
