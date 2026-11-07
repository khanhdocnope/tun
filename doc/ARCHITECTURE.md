# DỰ ÁN MOEJECT (KUMO-MANGA / OMNI-MANGA)
## TÀI LIỆU KIẾN TRÚC TỔNG THỂ & ĐẶC TẢ HỆ THỐNG (SYSTEM ARCHITECTURE)

> **Mục tiêu dự án:** Xây dựng hệ sinh thái đọc, tải và xử lý Manga/Manhwa thế hệ mới cho người dùng phổ thông trên cả **Máy tính (Desktop PC)** và **Điện thoại (Mobile App)**. 
> Kết hợp công nghệ thu thập dữ liệu tiên tiến (bypassing WAF/Cloudflare) với Pipeline AI Computer Vision (xóa chữ, khôi phục nền và dịch tự động) theo mô hình **Kiến trúc Phân tách (Decoupled Client-Server)** tối ưu hóa tuyệt đối tài nguyên bộ nhớ (RAM < 80MB) và tốc độ tải.

---

### 1. KIẾN TRÚC ĐA NỀN TẢNG (DESKTOP & MOBILE DECOUPLED ARCHITECTURE)

Để giải quyết triệt để bài toán hiệu năng, dung lượng ứng dụng và thời lượng pin trên thiết bị di động, hệ thống được thiết kế phân tách rõ rệt thành 2 tầng:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   FRONTEND CLIENTS (DESKTOP & MOBILE)                  │
│  - Desktop App (Windows / macOS / Linux)                               │
│  - Mobile App (Android / iOS) - Flutter / Native                       │
│  * Nhiệm vụ: Đọc truyện mượt mà 60-120 FPS, RAM siêu nhẹ (~30-50MB),   │
│    quản lý thư viện, điều khiển tìm kiếm & tải truyện                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (REST API / WebSocket / Local IPC)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               HEADLESS CORE ENGINE (PYTHON FASTAPI SERVICE)            │
│  - Module Ingestion & Scraper (Bypass WAF, Gated Downloader)           │
│  - Module Computer Vision & AI Cleaner (LaMa Inpainting, RapidOCR)     │
│  - Module Packaging (CBZ + ComicInfo.xml metadata)                     │
│  * Nhiệm vụ: Xử lý toàn bộ logic nặng về mạng, WAF, nén file và AI     │
│  * Vận hành: Local Service trên PC, hoặc Self-hosted / Cloud Server    │
└────────────────────────────────────────────────────────────────────────┘
```

#### Đảm bảo về Hiệu năng & Bộ nhớ (RAM & Performance Guarantees):
1. **Kiểm soát RAM tuyệt đối (< 80MB cho Ingestion):**
   - Áp dụng cơ chế **Chunk Streaming & Disk Flush**: Trang ảnh sau khi tải và kiểm tra magic bytes sẽ được ghi trực tiếp vào file đệm hoặc nén tức thì vào file `.cbz`. 
   - Bộ nhớ đệm trong RAM chỉ duy trì từ 3–5 trang ảnh đang xử lý đồng thời, tuyệt đối không gom toàn bộ cả chapter vào RAM.
2. **Vòng đời Trình duyệt Ngắn hạn (Ephemeral Browser Lifecycle):**
   - Trình duyệt `nodriver` (Chromium) **chỉ được khởi động khi gặp Cloudflare Challenge mới** hoặc khi cookie hết hạn.
   - Ngay sau khi giải mã và trích xuất cookie thành công vào `cf_cookies.dat`, toàn bộ tiến trình Chromium sẽ được đóng và giải phóng $100\%$ khỏi RAM. Quá trình tải ảnh hàng loạt sau đó chạy thuần túy bằng `requests.Session` nhẹ nhàng.
3. **Phân tách Native cho Mobile:**
   - Ứng dụng điện thoại không cần phải nhúng Python runtime cồng kềnh, tránh được việc bị hệ điều hành tắt ngầm (*kill background task*) hay app bị phình to hàng trăm MB.

---

### 2. NGUỒN CỘNG HƯỞNG & THỪA HƯỞNG CÔNG NGHỆ

Dự án được xây dựng dựa trên 2 trụ cột cốt lõi:

#### A. Ingestion & Scraper Engine (Kế thừa từ `comix-downloader` & `hakuneko`)
- **Bypass Cloudflare & WAF:** Sử dụng `nodriver` (giao tiếp trực tiếp qua Chrome DevTools Protocol - CDP), cơ chế **Smart Headless + Fallback Headed** (chạy ẩn, chỉ hiện cửa sổ khi Turnstile cần click tay), giải WAF challenge một lần, lưu cookie vào session (`cf_cookies.dat`) và tái sử dụng qua HTTP headers.
- **POWBlock Bypass Strategy (MangaDex):** Domain `uploads.mangadex.org` sử dụng cơ chế bảo vệ POWBlock chặn các browser User-Agent (`Mozilla/5.0...`). Core Engine tự động định tuyến qua Client User-Agent (`MoeJect/1.0`) giúp bóc tách và tải trực tiếp 100% ảnh bìa và chapter với HTTP 200 OK ngay tức thì.
- **Cứu Truyện DRM Scramble Descrambler:** Giải mã ảnh DRM bị xáo trộn từ Cứu Truyện bằng thuật toán Base64 decode + XOR Cipher với chuỗi 16 số Pi (`3141592653589793`), cắt và dán các dải ảnh ngang (horizontal slices) theo tọa độ đích `dy` với độ chính xác tuyệt đối.
- **Hitomi.la Dynamic CDN Sharding & Binary Nozomi Engine:** Bẻ khóa thuật toán phân tán CDN `gold-usergeneratedcontent.net` của Hitomi.la. Nạp động `gg.js` để trích xuất epoch prefix `gg.b` và bảng băm nhánh `gg.m(g)`, phân giải subdomain WebP (`w1`, `w2`, `atn`, `btn`). Áp dụng HTTP Range Requests trên file binary index `.nozomi` (`>I`) để nạp feed truyện mới nhất với dung lượng chỉ 96 bytes/trang.
- **Kho Connectors Đa Nguồn (Template-Driven Registry):** Phân tích và chuyển giao 1,328 nguồn từ HakuNeko thành Catalog 354KB và 45 Template Engines (Madara, MangaStream, MojoPortal, FlatManga...). Cơ chế Dynamic Lazy-Loading giúp khởi động server chỉ trong 0.05s và giữ mức tiêu thụ RAM < 50MB.
- **Two-Tier Concurrency Pool:**
  - Tầng 1: Đa luồng xử lý chương (`max_chapter_workers`, mặc định 2–3 chapters).
  - Tầng 2: Đa luồng tải ảnh trang truyện (`max_image_workers`, mặc định 5–8 ảnh/chapter).
- **Connection Gating (Chống Rate-Limit):** Dùng `threading.BoundedSemaphore` giới hạn tối đa số kết nối đồng thời trên mỗi host/CDN (mặc định 4-5 connections) để tránh bị máy chủ truyện chặn IP.
- **Phân loại lỗi chi tiết (Structured Failure Diagnostics):** Phân loại lỗi mạng, SSL, DNS, 403 WAF, ảnh hỏng; cơ chế retry với Exponential Backoff & Jitter.
- **Multiple Output Formats & Comic Metadata:** Hỗ trợ lưu thư mục ảnh thô (raw), đóng gói file **ZIP** (ảnh thô nguyên bản thuận tiện lưu trữ hoặc nạp trực tiếp vào tool AI Cleaner batch), đóng gói chuẩn truyện tranh quốc tế **CBZ** (`zipfile`) tích hợp sẵn file đặc tả **`ComicInfo.xml`** để các ứng dụng đọc truyện trên PC và điện thoại tự động hiển thị metadata (bìa, tác giả, mô tả, số tập), và PDF.

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

### 3. SƠ ĐỒ LUỒNG DỮ LIỆU TOÀN HỆ THỐNG (DATA FLOW)

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

### 4. CƠ CẤU TỔ CHỨC MÃ NGUỒN (PROJECT DIRECTORY STRUCTURE)

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
│   ├── core\                      # Logic nền tảng (Downloader, Session, Two-tier Pool)
│   │   ├── downloader.py          # Bộ tải ảnh đa luồng kèm Rate Gate & Streaming Flush
│   │   ├── models.py              # Data classes (MangaInfo, Chapter, Page, ComicInfo)
│   │   └── session.py             # Quản lý request sessions, nạp cookies cf_cookies.dat
│   ├── api\                       # Tương tác với các nguồn truyện (Connectors & WAF)
│   │   ├── base.py                # BaseMangaSource abstract class
│   │   ├── mangadex.py            # Connector MangaDex qua REST API
│   │   ├── cuutruyen.py           # Connector Cuutruyen (WAF/Cloudflare)
│   │   └── browser_runner.py      # Điều khiển nodriver / CDP headless + fallback headed
│   ├── vision\                    # Pipeline xử lý ảnh & AI
│   │   ├── detector.py            # RapidOCR bóc text và tọa độ polygon
│   │   ├── mask.py                # Xử lý mask nhị phân, padding, dilation
│   │   ├── inpainter.py           # Engine LaMa ONNX (tối ưu CPU, patch cropping)
│   │   └── pipeline.py            # Gắn kết toàn bộ luồng xử lý ảnh một trang truyện
│   ├── formats\                   # Xuất bản file
│   │   ├── cbz.py                 # Đóng gói chuẩn CBZ kèm ComicInfo.xml metadata
│   │   └── images.py              # Xử lý nén, lưu WebP/PNG
│   ├── cli\                       # Giao diện dòng lệnh tương tác Desktop
│   │   └── main.py                # Rich/Typer Interactive Terminal UI
│   ├── server\                    # REST API Server phục vụ Desktop GUI & Mobile
│   │   └── app.py                 # FastAPI endpoints (Search, Download Queue)
│   └── utils\                     # Helpers, logging, config loader
├── tests\                         # Unit test & Integration test
├── config.json                    # Cấu hình người dùng (Workers, Paths, Models)
└── requirements.txt               # Danh sách thư viện phụ thuộc
```
