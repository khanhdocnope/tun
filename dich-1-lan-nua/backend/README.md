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
- High-speed Multilingual Comic OCR (RapidOCR ONNX: Japanese, Korean, Chinese, English)
- Automated Speech Bubble & Text Detection with Reading Order calculation (RTL for Manga, LTR for Webtoon)
- Morphological Mask Generation with customizable padding/dilation
- CPU-Optimized Inpainting (OpenCV Fast Marching `TELEA` & Navier-Stokes `NS`)
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
- `POST /api/v1/inpaint/process` — Text erasure and background inpainting
- `POST /api/v1/mask/generate` — Binary mask preview generation
