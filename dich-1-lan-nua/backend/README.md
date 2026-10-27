---
title: Manga Text Cleaner
emoji: "🧽"
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: "5.20.0"
python_version: "3.10"
app_file: app.py
pinned: false
license: mit
---

# Comic Translation Studio — Backend (Hugging Face Space)

FastAPI + Gradio server on ZeroGPU (CPU work only) with a small upload UI:

- Manga-tuned RapidOCR ONNX (detector recall 7 → 27+ lines on the sample page, vertical columns rotated, PP-OCRv5 multilingual recognition)
- Automated speech-bubble & text detection with bubble-aware reading order (RTL for manga, LTR for webtoon)
- Pixel-accurate text masks + flat-bubble fill (no grey ghosting, no model download on the hot path)
- LaMa-Manga neural inpainting for translucent / patterned bubbles
- CPU-optimised inpainting (OpenCV `TELEA` & `NS`) as manual fallbacks
- Streaming image validation (PNG/JPEG/WebP, 10–16384 px, 50 MB ceiling)

> **Hardware note:** this Space runs on **ZeroGPU**, which only accepts the torch
> versions it pre-installs and only works with the Gradio SDK. That is why
> `requirements.txt` pins `torch==2.13.0` (no `+cpu` suffix: the runtime supplies
> its own build) and why there is a `@spaces.GPU` warm-up function in `app.py`.

## Web UI

`/` serves the Gradio page: upload **one image** (or pick an engine) and download
the cleaned PNG. The `/api/v1/*` REST API stays mounted on the same app for the
Studio frontend, and `/docs` has the OpenAPI page.

## LaMa-Manga neural eraser

`auto` fills flat bubbles with their exact background colour and only routes
translucent / patterned bubbles to the manga fine-tune of Big-LaMa.

On Hugging Face `app.py` downloads the ~196 MB checkpoint in the background on
first boot (`SPACE_ID` is set, so it happens automatically). Locally:

```powershell
backend\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
backend\.venv\Scripts\python.exe backend/tools/download_lama.py
```

The checkpoint lands in `backend/models/` (on the Space: `/app/models/`) and is
git-ignored. Without it `GET /api/v1/capabilities` omits `lama` and textured
bubbles fall back to the texture-fill engine. On a 2-core dev box a textured
bubble costs roughly 8–12 s; flat pages stay at ~1–2 s.
See [docs/LAMA_MANGA_ENGINE.md](../docs/LAMA_MANGA_ENGINE.md).

## Deployment

Space **SDK: Gradio**, hardware **ZeroGPU (free)**, `sdk_version` 5.20.0,
`python_version` 3.10. Push this folder; first boot downloads the LaMa
checkpoint and warms the OCR models.

## Endpoints

- `GET /` — Gradio UI
- `GET /status` — JSON service status
- `GET /api/v1/health` — health check with dynamic timestamp
- `GET /api/v1/capabilities` — available engines and system limits
- `POST /api/v1/erase-page` — OCR + erase one page (used by the UI)
- `POST /api/v1/erase-zip` — OCR + erase every image in a ZIP
- `POST /api/v1/upload/validate` — image upload & raster decode validation
- `POST /api/v1/ocr/detect` — OCR detection and text extraction
- `POST /api/v1/inpaint/process` — rectangle-mask inpainting (legacy API)
- `POST /api/v1/erase-text-in-region` — pixel-mask smart erase
- `POST /api/v1/mask/generate` — binary mask preview generation
