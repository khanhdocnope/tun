---
title: Manga Text Cleaner
emoji: 🧽
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 5.20.0
app_file: app.py
pinned: false
license: mit
---

# 🧽 Manga Text Cleaner — backend xóa chữ

Backend chỉ làm **một việc: xóa chữ / bóng thoại** trên trang Manga & Manhwa.
OCR / dịch thuật nằm ở phía studio (Vercel), không nằm trong Space này.

## Pipeline (mỗi trang)

1. **RT-DETR** `ogkalu/comic-text-and-bubble-detector` chia vùng **Chat** (chữ trong bóng) và **SFX** (chữ ngoài bóng) — quyết định bằng class, không dùng heuristic màu.
2. **MangaTextDetector `det`** (`Kellenok/PP-OCRv6_manga` ONNX trên CPU, ~300 ms) lấy polygon và heatmap chữ pixel-level; `mask_logic` dựng "barrier" mực đen + dilation chống lem viền bóng. (Hỗ trợ fallback ComicTextDetector qua `TEXT_DET_BACKEND=ctd`).
3. **Flat-fill**: bóng giấy trắng phẳng tô thẳng màu median, không cần inpaint.
4. Phần còn lại **LaMa** (anime-lama / big-lama) chỉ inpaint vùng cần, ghép lại 1:1 pixel ngoài mask.

### Tối ưu tốc độ (v3.1)

- **Text detector siêu nhẹ (`manga_det`)**: Thay ComicTextDetector nặng nề (từng tốn ~31–40 s/trang trên CPU) bằng `PP-OCRv6_manga` 0.92 MB chạy ONNX CPU ~100–350 ms.
- **Tiết kiệm quota ZeroGPU**: `GPU_DURATION` giảm từ 30 s xuống 8 s. Trang giấy trắng phẳng xử lý thuần CPU không đốt GPU.
- **Một cửa sổ ZeroGPU cho mỗi trang**: detect + inpaint nằm chung `@spaces.GPU`, model giữ trên device cả lượt thay vì `.to()` qua lại.
- **Khóa toàn cục**: model dùng chung, 1 trang xử lý tại một thời điểm → 2 request song song không còn trả ảnh lẫn.
- Model nạp **lazy** (import `app` không tải gì), `requirements` không còn kéo `paddlepaddle`/`paddleocr`/`manga-ocr`.

Đo lại thật: `python bench_clean.py --url https://dobietdc-backe-manga-remove.hf.space --url-runs 1`

## API

| Endpoint | Mô tả |
|---|---|
| `GET /health` (hoặc `/api/v1/health`) | trạng thái, model sẵn sàng, giới hạn ảnh (`MAX_PIXELS`, `MAX_B64_BYTES`) |
| `POST /clean_page` (hoặc `/api/clean_page`) | `{"imageBase64","cleanSFX","dilationPx","detThreshold","inpaintModel"}` → `{"success","cleanedImageBase64","colorMaskBase64","stats"}` |
| `GET /api/benchmark?runs=3&force_cpu=true` | đo thời gian từng giai đoạn trên 2 ảnh mẫu |

`stats.timings_ms` = `decode / detect / seg / masks / inpaint / total` của pipeline;
`stats.api_timings_ms` = chi phí encode/decode của HTTP. `stats.device` cho biết trang đó chạy GPU hay CPU.

Lỗi luôn có `{"detail": "..."}`: 400 base64 hỏng · 413 ảnh quá lớn · 422 tham số sai · 500 lỗi pipeline.

## Cấu trúc

```
app.py             Gradio UI + FastAPI router
manga_cleaner.py   pipeline: detect → seg → mask → flat-fill → LaMa
text_detector.py   MangaTextDetector (PP-OCRv6_manga ONNX CPU, ~300ms)
mask_logic.py      mask thuần numpy/cv2 (contour barrier, flat-fill, polygon masks)
bubble_detector.py RT-DETR vùng Chat/SFX
download_models.py tải weights (3 mirror) khi thiếu
bench_clean.py     đo tốc độ (local & qua HTTP)
test_cleaner_logic.py test mask không cần model
examples/          sample1.jpg, sample2.jpg
upload_to_hf.py    deploy lên Space (--dry-run trước)
```

## Deploy

Space dùng **Gradio SDK** (`app_file: app.py`), không Docker.

```bash
python upload_to_hf.py --dry-run
python upload_to_hf.py
```

Biến môi trường tuỳ chọn: `TEXT_DET_BACKEND` (`manga_det` | `ctd`, mặc định `manga_det`), `GPU_DURATION` (mặc định 8 s), `INPAINT_CONTEXT_PX` (64), `FULL_PAGE_RATIO` (0.35), `SEG_SIZE` (1024), `MAX_PIXELS`, `MAX_B64_BYTES`.
