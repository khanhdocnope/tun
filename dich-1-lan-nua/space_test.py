"""Smoke-test the live Hugging Face Space: health, capabilities, UI, erase speed."""

from __future__ import annotations

import io
import time
import zipfile
from pathlib import Path

import httpx

BASE = "https://dobietdc-manga-text-cleaner.hf.space"
ROOT = Path(__file__).resolve().parent
IMG = ROOT / "raw-test" / "05.webp"


def main() -> int:
    with httpx.Client(timeout=300) as client:
        t = time.perf_counter()
        health = client.get(f"{BASE}/api/v1/health")
        print(f"health      {health.status_code} {health.text[:120]}  ({(time.perf_counter()-t)*1000:.0f} ms)")

        t = time.perf_counter()
        caps = client.get(f"{BASE}/api/v1/capabilities")
        data = caps.json()
        print(f"capabilities {caps.status_code} in {(time.perf_counter()-t)*1000:.0f} ms")
        print("  inpaint:", data.get("inpainting", {}).get("available_engines"))

        t = time.perf_counter()
        ui = client.get(f"{BASE}/")
        print(f"ui          {ui.status_code} {len(ui.content)} bytes  ({(time.perf_counter()-t)*1000:.0f} ms)")

        payload = IMG.read_bytes()
        for engine in ("auto", "lama", "flat"):
            t = time.perf_counter()
            resp = client.post(
                f"{BASE}/api/v1/erase-page",
                files={"file": (IMG.name, payload, "image/webp")},
                data={"engine": engine, "direction": "rtl", "dilation": "5"},
            )
            secs = time.perf_counter() - t
            print(
                f"erase-page {engine:5s} {resp.status_code} {len(resp.content)/1024:.0f} KB "
                f"status={resp.headers.get('x-erase-status')} "
                f"regions={resp.headers.get('x-erase-regions')} "
                f"engine_used={resp.headers.get('x-erase-engine')} "
                f"server_ms={resp.headers.get('x-erase-elapsed-ms')} wall={secs:.1f}s"
            )
            if resp.status_code == 200 and engine == "auto":
                (ROOT / "raw-test" / "bench-out" / "space_auto_05.png").write_bytes(resp.content)

        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as archive:
            archive.writestr("page1.webp", payload)
            archive.writestr("page2.webp", payload)
        t = time.perf_counter()
        zresp = client.post(
            f"{BASE}/api/v1/erase-zip",
            files={"file": ("batch.zip", zbuf.getvalue(), "application/zip")},
            data={"engine": "flat", "direction": "rtl", "dilation": "5"},
        )
        print(
            f"erase-zip         {zresp.status_code} {len(zresp.content)/1024:.0f} KB "
            f"pages={zresp.headers.get('x-erase-pages')} ok={zresp.headers.get('x-erase-ok')} "
            f"wall={time.perf_counter()-t:.1f}s"
        )
        print("  log:", (zresp.headers.get("x-erase-log") or "")[:300])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
