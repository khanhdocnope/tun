# DỰ ÁN MOEJECT (KUMO-MANGA / OMNI-MANGA)
## TÀI LIỆU KIẾN TRÚC TỔNG THỂ & ĐẶC TẢ HỆ THỐNG (SYSTEM ARCHITECTURE)

> **Mục tiêu dự án:** Xây dựng hệ sinh thái đọc, tải và xử lý Manga/Manhwa thế hệ mới cho người dùng phổ thông. Kết hợp công nghệ thu thập dữ liệu tiên tiến (bypassing WAF/Cloudflare) với Pipeline AI Computer Vision (xóa chữ, khôi phục nền và dịch tự động) tối ưu cho phần cứng CPU/Hugging Face.

---

### 1. NGUỒN CỘNG HƯỞNG & THỪA HƯỞNG CÔNG NGHỆ

Dự án được xây dựng dựa trên 2 trụ cột cốt lõi:

#### A. Ingestion & Scraper Engine (Kế thừa từ `comix-downloader`)
- **Bypass Cloudflare & WAF:** Sử dụng `nodriver` (giao tiếp trực tiếp qua Chrome DevTools Protocol - CDP), giải WAF challenge một lần, lưu cookie vào session (`cf_cookies.dat`) và tái sử dụng qua HTTP headers.
- **Two-Tier Threading Pool:**
  - Tầng 1: Đa luồng xử lý chương (`max_chapter_workers`).
  - Tầng 2: Đa luồng tải ảnh trang truyện (`max_image_workers`).
- **Connection Gating (Chống Rate-Limit):** Dùng `threading.BoundedSemaphore` giới hạn tối đa số kết nối đồng thời trên mỗi host/CDN (mặc định 4-5 connections).
- **Phân loại lỗi chi tiết (Structured Failure Diagnostics):** Phân loại lỗi mạng, SSL, DNS, 403, ảnh hỏng; cơ chế retry với Exponential Backoff & Jitter.
- **Multiple Output Formats:** Hỗ trợ lưu ảnh thô (raw), đóng gói PDF (`reportlab`), hoặc đóng gói chuẩn truyện tranh **CBZ** (`zipfile`).

#### B. Inpainting & Manga Cleaner Pipeline (Tối ưu cho CPU / Hugging Face Spaces)
- **Bước 1: Phát hiện chữ & Tạo Polygon Mask (Text Detection):**
  - Công cụ: `RapidOCR` với chế độ `return_polygons: True`.
  - Bóc tách đa giác bám sát độ nghiêng/uốn lượn của chữ trong manga, không làm mất nền xung quanh.
  - Tạo Binary Mask bằng OpenCV (`cv2.fillPoly`).
  - Phủ thêm đệm Padding/Dilation (khoảng 6-8 pixel) bằng `cv2.dilate` để bao phủ hoàn toàn bóng đổ và viền nét chữ mỏng.
- **Bước 2: Inpainting & Phục hồi nền (Background Inpainting):**
  - Công cụ: **LaMa (ONNX Runtime / SafeTensors)**.
  - Model ưu tiên: `mayocream/lama-manga` (fine-tuned trên ~300.000 tranh manga/anime) hoặc `g-ronimo/lama` (`lama_fp16.onnx` ~110MB).
  - Tối ưu tốc độ CPU:
    1. Downscale ảnh (resize cạnh dài nhất về 384–512px) trước khi đưa vào mô hình LaMa.
    2. Smart Patch Inpainting: Chỉ crop các bounding box chứa chữ kèm lề 32px đưa vào LaMa, sau đó dán (paste) ngược lại ảnh gốc.
- **Bước 3: Typesetting & Dịch tự động (Mở rộng tương lai):**
  - Dùng LLM (Gemini API) nhận diện ngữ cảnh và dịch văn bản từ OCR.
  - Tính toán bounding box khung thoại để tự động bẻ dòng (word-wrap) và chọn kích cỡ font tiếng Việt phù hợp.

---

### 2. SƠ ĐỒ LUỒNG DỮ LIỆU TOÀN HỆ THỐNG (DATA FLOW)

```
[Web/App Manga Source]
         │
         ▼ (nodriver + WAF Cookie Gated Downloader)
[Image Stream in Memory (Bytes)]
         │
    ┌────┴────────────────────────────────────────┐
    ▼                                             ▼
[Luồng Đọc Thô / Cache]             [Pipeline Xóa Chữ / Dịch AI]
    │                                             │
    │                                1. RapidOCR (Polygon Text & Boxes)
    │                                             │
    │                                2. Mask Builder (cv2.fillPoly + Dilate 8px)
    │                                             │
    │                                3. Crop Patches / Resize 512px
    │                                             │
    │                                4. LaMa ONNX Inpaint (CPU Optimized)
    │                                             │
    │                                5. Paste back & Alpha Blend
    │                                             │
    │                                6. (Optional) AI Typeset Vietnamese Text
    │                                             │
    └──────────────────────┬──────────────────────┘
                           │
                           ▼
          [Storage / Output Formats]
          - Local Folder (WebP/JPG)
          - CBZ Package
          - Client Web / Mobile Reader API
```

---

### 3. CƠ CẤU TỔ CHỨC MÃ NGUỒN (PROJECT DIRECTORY STRUCTURE)

```text
d:\MoeJect\
├── doc\                           # Tài liệu thiết kế, API spec, nhật ký dự án
│   ├── ARCHITECTURE.md            # Tài liệu kiến trúc toàn diện (File này)
│   ├── PIPELINE_INPAINTING.md     # Đặc tả chi tiết về RapidOCR & LaMa ONNX
│   ├── DOWNLOADER_DESIGN.md       # Cơ chế cào dữ liệu, bypass WAF từ comix-downloader
│   └── CHANGELOG.md               # Nhật ký cập nhật qua từng giai đoạn
├── rules\
│   └── AI_ASSISTANT_RULES.md      # Quy tắc ứng xử và phát triển cho AI Assistant
├── src\
│   ├── core\                      # Logic nền tảng (Downloader, Session, Threading)
│   │   ├── downloader.py          # Bộ tải ảnh đa luồng kèm Rate Gate
│   │   ├── models.py              # Data classes (MangaInfo, Chapter, Page, MaskBox)
│   │   └── session.py             # Quản lý request sessions, cookies
│   ├── api\                       # Tương tác với các nguồn truyện (Bypass Cloudflare)
│   │   └── browser.py             # Điều khiển nodriver / CDP headless browser
│   ├── vision\                    # Pipeline xử lý ảnh & AI
│   │   ├── detector.py            # RapidOCR bóc text và tọa độ polygon
│   │   ├── mask.py                # Xử lý mask nhị phân, padding, dilation
│   │   ├── inpainter.py           # Engine LaMa ONNX (tối ưu CPU, patch cropping)
│   │   └── pipeline.py            # Gắn kết toàn bộ luồng xử lý ảnh một trang truyện
│   ├── formats\                   # Xuất bản file
│   │   ├── cbz.py                 # Đóng gói CBZ
│   │   └── images.py              # Xử lý nén, lưu WebP/PNG
│   └── utils\                     # Helpers, logging, config loader
├── tests\                         # Unit test & Integration test
├── config.json                    # Cấu hình người dùng (Workers, Paths, Models)
└── requirements.txt               # Danh sách thư viện phụ thuộc
```
