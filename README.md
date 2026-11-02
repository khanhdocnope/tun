# ⚡ Manga Studio Pro
### *Next-Gen AI Manga Cleaner, Spatial OCR, Canvas Typesetting & Localization Studio*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?logo=node.js)](https://nodejs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-Flash%20Lite-4285F4?logo=google)](https://deepmind.google/technologies/gemini/)

> **"Không chỉ là một công cụ xoá ảnh thông thường. Đây là một Studio hoàn chỉnh định nghĩa lại cách con người và AI cùng sáng tạo, làm sạch và bản địa hóa truyện tranh."**

---

## 🌟 Đột phá Kỹ thuật & Tính năng Nổi bật

### 1. 🎨 Dual-Path Inpainting Engine (Tẩy chữ Thông minh)
* **Flat-Fill Uniform Paper Bypass:** Tự động phát hiện các bong bóng thoại nền trắng phẳng bằng thuật toán phân tích biên và độ lệch chuẩn màu $\rightarrow$ đổ màu siêu tốc trong **0.005 giây** (tiết kiệm 80% thời gian tính toán, giữ nguyên vẹn 100% nét viền line-art đen của tác giả).
* **Screentone-Aware AI Inpainting:** Chỉ những vùng chữ phức tạp (đè lên tóc, quần áo, vân chấm tram halftones hoặc hiệu ứng âm thanh SFX) mới được nạp vào mô hình chuyên dụng **Anime-Manga LaMa / Big-LaMa**.
* **Zero Seam Artifacts:** Bảo tồn vân tram truyện tranh đen trắng, loại bỏ hoàn toàn các vết nhòe xám bết màu thường thấy ở các công cụ inpainting thông thường.

### 2. 📐 Interactive Canvas Studio (Click Đúp & Gõ Ngay trên Ảnh)
* **Manga Layered Document (Chuẩn V2.0):** Mỗi trang truyện được bóc tách thành các lớp hình học độc lập (Clean Background, Vector Bubble Masks, Text Typography).
* **Inline Live Text Editing:** Nhấp đúp vào bất kỳ bong bóng thoại nào trên canvas để sửa chữ trực tiếp với con trỏ neon hiện đại; nhấp đúp vào khoảng trống để lập tức tạo khung thoại mới tại con trỏ chuột.
* **Elliptical Diamond Wrap:** Tự động uốn và ngắt dòng văn bản tiếng Việt theo dáng elip chuẩn của bóng thoại truyện tranh, không làm tràn chữ ra ngoài khung.
* **Split-Curtain Slider:** Kéo rèm trượt trực quan so sánh ảnh gốc và ảnh đã xóa/dịch theo thời gian thực (60 FPS).

### 3. 🚀 Async Job Engine & Server-Sent Events (SSE Streaming)
* **Xử lý trơn tru cả Chapter (30 – 100 trang):** Triệt tiêu hoàn toàn vấn đề nghẽn mạng hay HTTP 504 Timeout khi xử lý file lớn.
* **Realtime Progress Stream:** Kết nối luồng Server-Sent Events (`text/event-stream`), cập nhật tiến độ từng trang theo thời gian thực và đẩy kết quả về render ngay lập tức (`page_done`).
* **Fault-Tolerant & Resumable:** Nếu một trang bị lỗi file, hệ thống ghi nhận độc lập và tiếp tục xử lý các trang còn lại; hỗ trợ tự động chuyển sang Polling định kỳ nếu rớt mạng.

### 4. 🤖 Contextual Story Translation (Google Gemini Flash Lite)
* **Topology Reading Order:** Tự động phân dải hàng (Panel Bands) và sắp xếp thứ tự đọc tự nhiên:
  * **Manga Nhật:** Phải qua Trái, Trên xuống Dưới (`rtl`).
  * **Webtoon Hàn / Manhua:** Tuyệt đối theo trục dọc (`ttb`).
* **Chuyển ngữ Ngữ cảnh:** Tự động nạp ngữ cảnh các trang liền trước (`prevContext`) và từ điển thuật ngữ nhân vật (`glossary`), giúp văn phong nhân vật tự nhiên, đúng tính cách và không bị máy móc.

---

## 🏛️ Kiến trúc Hệ thống (System Architecture)

```
[Manga Reader / Creator]
           │
           ├── (1) Giao diện Canvas & Batch Studio Pro (Vercel / HTML5 / Fabric.js)
           │
           ▼
[Vercel Serverless / Express Edge API]
   ├── /api/clean          ──► Inpainting Proxy & 413 Payload Guard
   ├── /api/ai-vision      ──► Unified Spatial Vision & Dual-Key Gemini Rotation
   ├── /api/jobs           ──► Async Batch Job Dispatcher & SSE Stream Proxy
   └── /api/manga-contract ──► Single Source of Truth: Data Normalization & Sorter
           │
           ▼
[Dedicated GPU Backend (FastAPI / Colab / Kaggle / Cloud Run)]
   ├── Bubble & Text Detector (RT-DETR + DBNet)
   ├── Dual-Path Inpainter (Flat-Fill Bypass + Anime-LaMa CUDA FP16)
   └── Async Job Queue Engine (Semaphore Controlled, Zero-OOM)
```

---

## 📂 Cấu trúc Thư mục Dự án

```
tool-xoa-anh-manga/
├── web-in-vercel/               # Fullstack Web & Serverless API
│   ├── api/                     # Serverless Function Handlers
│   │   ├── ai-vision.js         # Endpoint Vision, OCR & Dịch thuật
│   │   ├── clean.js             # Endpoint Proxy tẩy chữ
│   │   ├── jobs.js              # Endpoint Async Job & SSE Proxy
│   │   └── manga-contract.js    # Chuẩn hóa Data Contract V2 & Geometry Helpers
│   ├── public/                  # Frontend SPA
│   │   ├── index.html           # Trang chủ Manga Studio Pro
│   │   ├── batch-studio/        # Phòng dịch hàng loạt (Batch Studio Pro)
│   │   └── typeset/             # Canvas Editor & Typeset Studio chuyên nghiệp
│   └── server.js                # Local Dev Server (Express)
│
├── colab-backend/               # GPU Backend tối ưu cho Google Colab
│   ├── manga_cleaner.py         # Pipeline Inpainting kết hợp Dual-Path
│   ├── manga_schema.py          # Pydantic Models chuẩn V2.0
│   ├── job_engine.py            # Async Job Queue & SSE Broadcaster
│   ├── mask_logic.py            # Thuật toán Flat-fill & Wavefront dilation
│   └── server.py                # FastAPI Server
│
├── kaggle-backend/              # GPU Backend tối ưu cho Kaggle (P100 / T4)
├── tests/                       # Bộ kiểm thử tự động (Unit & Regression Tests)
│   ├── unit/                    # Node.js Unit Tests (Contract, Jobs, Helper)
│   ├── test_job_engine.py       # Python Job Engine Lifecycle Tests
│   ├── test_manga_schema.py     # Python Data Schema & Sorter Tests
│   └── test_mask_logic.py       # Thuật toán bảo toàn nét vẽ & Screentone
├── LICENSE                      # Giấy phép MIT
└── README.md                    # Tài liệu dự án
```

---

## 🛠️ Hướng dẫn Cài đặt & Khởi chạy

### 1. Khởi chạy Web Studio (Local)
Yêu cầu: **Node.js >= 18.0.0**

```bash
# 1. Đi vào thư mục web
cd web-in-vercel

# 2. Cài đặt dependencies
npm install

# 3. Khởi chạy server
npm start
```
* Mở trình duyệt tại: `http://localhost:3000`
* Phòng dịch hàng loạt: `http://localhost:3000/batch-studio`

### 2. Khởi chạy GPU AI Backend (Python)
Yêu cầu: **Python 3.10+** (Khuyên dùng GPU có hỗ trợ CUDA)

```bash
# 1. Đi vào thư mục backend
cd colab-backend

# 2. Cài đặt các gói phụ thuộc
pip install -r requirements.txt

# 3. Chạy server FastAPI
python server.py
```
* Backend API hoạt động tại: `http://localhost:7860`

---

## 🧪 Kiểm thử Đơn vị & Hồi quy (Testing)

Hệ thống được bảo vệ bởi bộ kiểm thử tự động nghiêm ngặt trên cả 2 nền tảng:

```bash
# Chạy toàn bộ Unit Tests phía Node.js:
npm --prefix web-in-vercel test:unit

# Chạy toàn bộ Tests phía Python:
python tests/test_manga_schema.py
python tests/test_job_engine.py
python tests/test_mask_logic.py
```

---

## 📄 Giấy phép (License)

Dự án được phân phối dưới giấy phép **[MIT License](LICENSE)**. Bạn hoàn toàn có quyền sử dụng, sửa đổi, phân phối và tích hợp vào các dự án thương mại hoặc cá nhân.
