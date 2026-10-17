# TỔNG QUAN DỰ ÁN & BỐI CẢNH TOÀN DIỆN (PROJECT CONTEXT)
> **Mục đích tài liệu:** Cung cấp đầy đủ bối cảnh cấu trúc, kiến trúc AI, tiến độ hiện tại, các vấn đề kỹ thuật và các việc cần làm tiếp theo để có thể mở cửa sổ làm việc mới mà không bị đứt đoạn thông tin.

---

## 1. THÔNG TIN CHUNG & REPOSITORY
- **Thư mục dự án:** d:\tool-xoa-anh-manga
- **Git Repo:** https://github.com/khanhdocnope/tun.git (Branch: main)
- **Mục tiêu cốt lõi:**
  1. Xóa chữ / bóng thoại trên ảnh truyện tranh (Manga Inpainting / Text Cleaning) sử dụng mô hình AI (LaMa / Manga Cleaner chạy trên Hugging Face Space: https://dobietdc-backe-manga-remove.hf.space).
  2. OCR & Dịch truyện tranh tự động hàng loạt (Batch Manga OCR & Translation Studio) sử dụng Google Gemini Vision & Text API.
  3. Xuất kịch bản dịch truyện dạng .txt (cho thợ dịch / typesetter) hoặc .docx / .json / .zip.

---

## 2. PHÂN VÙNG THƯ MỤC CHÍNH

1. **web-in-vercel/ (KHU VỰC ĐANG PHÁT TRIỂN CHÍNH - DUY NHẤT ĐƯỢC CHỈNH SỬA):**
   - Đã được tái cấu trúc sạch sẽ theo mô hình **Single Source of Truth**:
   - `index.html`: Trang chính (VisionBox Manga Studio - Inpainting & Single Page OCR).
   - `batch-studio.html` & `batch-studio/`: Trang phòng dịch hàng loạt theo thư mục / nhiều trang truyện (**Batch Studio Pro**).
     - `index.html`: Giao diện chính của Batch Studio (có nút [Tải .txt] SVG trực tiếp và nạp style/script duy nhất).
     - `app.js`: Xử lý logic đọc ảnh, hàng đợi xử lý Gemini song song, phân trang, preview, fallback copy chống lỗi di động.
     - `style.css`: Toàn bộ CSS giao diện, responsive tối ưu cho mobile (< 480px, grid 2x2) và desktop.
   - `assets/`: Biểu tượng, favicon, hình ảnh (`assets/ico/web.png`, `web.ico`).
   - `js/`: Thư viện tiện ích (`jszip.min.js`).
   - `api/`: Các Serverless Functions cho Vercel:
     - `download-script.js`: API nhận dữ liệu text và trả về file .txt / .docx đính kèm header Content-Disposition UTF-8 RFC 5987 và UTF-8 BOM (\uFEFF).
     - `process-batch.js`, `translate-text.js`, `batch-helper.js`, `clean.js`, `ocr.js`, `translate.js`, `vision.js`, `batch-zip.js`, `health.js`, `config.js`.
   - `server.js`: Node Express server gọn gàng cho local dev (http://localhost:3000) phục vụ chuẩn `/batch-studio` và `/batch-studio/`.
   - `vercel.json`: Cấu hình deployment Vercel với `cleanUrls: true` và rewrite tương thích cho sub-web `/batch-studio`.

2. **Do-not-touch/:**
   - Thư mục dữ liệu / công cụ phụ (scraper, crawler, link vip, token) -> **TUYỆT ĐỐI KHÔNG ĐƯỢC CHẠM VÀO HOẶC XÓA**.

3. **tool-xoa-anh/ & templates/, static/, web_app.py:**
   - Bản prototype Python / Flask ban đầu chạy local gradio/flask cho việc inpainting AI trước khi chuyển thể sang Node.js + Vercel.

---

## 3. CẤU HÌNH AI & MÔ HÌNH GEMINI (QUAN TRỌNG)

Dự án đã được chốt và tối ưu cơ chế Dual-Key & Model Gemini như sau:
1. **Primary Model:** gemini-3.1-flash-lite
   - Rate limit: 15 Requests/phút (RPM), 500 Requests/ngày (RPD).
   - Dùng cho toàn bộ tác vụ OCR bong bóng thoại từ ảnh và dịch thuật nhanh.
2. **Fallback Model:** gemini-3.5-flash-lite
   - Tự động chuyển đổi khi primary gặp lỗi 429 hoặc cạn quota.
3. **Dual API Keys (Xoay tua / Song song):**
   - Hệ thống hỗ trợ cấu hình 2 API keys (GEMINI_API_KEY và GEMINI_API_KEY_2) chạy xoay tua (Round-robin) hoặc chia đôi pool xử lý để nhân đôi hạn ngạch (tổng cộng 30 RPM, 1.000 RPD).

---

## 4. TIẾN ĐỘ & TRẠNG THÁI HIỆN TẠI

### Đã hoàn thành:
1. Chuẩn hóa bộ model Gemini sang `gemini-3.1-flash-lite` và `gemini-3.5-flash-lite`.
2. Viết API serverless `api/download-script.js` hỗ trợ tải file có mã hóa BOM UTF-8 (\uFEFF) mở trên Notepad không bị lỗi font Tiếng Việt.
3. Tái cấu trúc toàn diện `web-in-vercel/`: Loại bỏ thư mục trùng lặp `public/` và mã chết.
4. Bổ sung nút bấm tải trực tiếp `[Tải .txt]` với icon SVG trên thanh công cụ chính và modal sao chép dự phòng.
5. Tối ưu Mobile CSS: Cấu hình grid 2x2 cho nút bấm trên di động (< 480px), thanh công cụ không bị vỡ.
6. Thay thế toàn bộ emoji thành icon SVG vector sắc nét trên cả trang chính và Batch Studio Pro.
7. Khắc phục triệt để lỗi định tuyến Vercel: Truy cập `/batch-studio` hiển thị chính xác trang phòng dịch Batch Studio Pro, không bị rơi về trang chủ.

---

## 5. HƯỚNG DẪN VẬN HÀNH & KIỂM THỬ LOCAL
- **Chạy local server:**
  ```bash
  cd d:\tool-xoa-anh-manga\web-in-vercel
  npm start
  ```
- **Truy cập:**
  - Trang chính: http://localhost:3000
  - Batch Studio Pro: http://localhost:3000/batch-studio
