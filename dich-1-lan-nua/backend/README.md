---
title: Comic Translation Studio Backend
emoji: 🎨
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: "5.20.0"
app_file: app.py
pinned: false
license: mit
---

# Comic Translation Studio — Backend API (Hugging Face Space)

FastAPI + Gradio ASGI server (100% Free Tier Compatible on Hugging Face Spaces):
- Manga-tuned RapidOCR ONNX (detector recall 7 → 27+ lines on the sample page, vertical columns rotated, PP-OCRv5 multilingual recognition)
- Automated Speech Bubble & Text Detection with bubble-aware reading order (RTL for Manga, LTR for Webtoon)
- Pixel-accurate text masks + flat-bubble fill (no grey ghosting, no 200 MB LaMa download on the hot path)
- CPU-Optimized Inpainting (OpenCV `TELEA` & `NS`, optional pre-installed LaMa)
- Streaming Image Validation (whitelisting PNG/JPEG/WebP, bounds 10–16384px, 50MB ceiling)

## Free Hugging Face Spaces Deployment (Gradio SDK)
1. Create a Space on Hugging Face with **SDK: Gradio** (Hardware: **CPU basic - Free**).
2. Clone or push this repository directly.
3. System dependencies (`libgl1`, `libglib2.0-0`) are automatically installed via `packages.txt`.
4. The space starts automatically and exposes both the Gradio UI at `/` and all FastAPI endpoints under `/api/v1/*`.

## Endpoints
- `GET /` — Gradio Status & Interactive Test Demo
- `GET /api/v1/health` — Health Check with dynamic timestamp
- `GET /api/v1/capabilities` — Available engines and system limits
- `POST /api/v1/upload/validate` — Image upload & raster decode validation
- `POST /api/v1/ocr/detect` — Real OCR detection and text extraction
- `POST /api/v1/inpaint/process` — Rectangle-mask inpainting (legacy API)
- `POST /api/v1/erase-text-in-region` — Pixel-mask smart erase (PNG lossless by default; `output_format=webp` lossless or `jpeg` q98)
- `POST /api/v1/mask/generate` — Binary mask preview generation
