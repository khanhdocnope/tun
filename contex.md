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
   - Đã được tái cấu trúc sạch sẽ theo mô hình **Single Source of Truth** (loại bỏ hoàn toàn thư mục `public/` trùng lặp và các file mã chết thừa):
   - `index.html`: Trang chính (VisionBox Manga Studio - Inpainting & Single Page OCR).
   - `batch-studio/`: Trang phòng dịch hàng loạt theo thư mục / nhiều trang truyện (**Batch Studio Pro**).
     - `index.html`: Giao diện chính của Batch Studio (có nút [📄 Tải .txt] trực tiếp và nạp style/script duy nhất).
     - `app.js`: Xử lý logic đọc ảnh, hàng đợi xử lý Gemini song song, phân trang, preview, fallback copy chống lỗi di động.
     - `style.css`: Toàn bộ CSS giao diện, responsive tối ưu cho mobile (< 480px, grid 2x2) và desktop.
   - `assets/`: Biểu tượng, favicon, hình ảnh (`assets/ico/web.png`, `web.ico`).
   - `js/`: Thư viện tiện ích (`jszip.min.js`).
   - `api/`: Các Serverless Functions cho Vercel:
     - `download-script.js`: API nhận dữ liệu text và trả về file .txt / .docx đính kèm header Content-Disposition UTF-8 RFC 5987 và UTF-8 BOM (\uFEFF).
     - `process-batch.js`, `translate-text.js`, `batch-helper.js`, `clean.js`, `ocr.js`, `translate.js`, `vision.js`, `batch-zip.js`, `health.js`, `config.js`.
   - `server.js`: Node Express server gọn gàng cho local dev (http://localhost:3000) phục vụ tĩnh trực tiếp từ thư mục gốc.
   - `vercel.json`: Cấu hình deployment Vercel kèm rewrite route `/batch-studio` chuẩn xác.

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
1. Chuẩn hóa bộ model Gemini sang `gemini-3.1-flash-lite` và `gemini-3.5-flash-lite` trong toàn bộ code frontend lẫn backend API.
2. Viết API serverless `api/download-script.js` hỗ trợ tải file có mã hóa BOM UTF-8 (\uFEFF) để không bị lỗi font Tiếng Việt khi mở trên Windows Notepad.
3. Dọn sạch khối CSS nhúng trùng lặp (`<style id=batch-studio-css>`) trong `web-in-vercel/batch-studio/index.html`.
4. **Tái cấu trúc thư mục `web-in-vercel/`**: Xóa hoàn toàn thư mục nhân bản `public/`, các file thừa (`prompt.txt`, `css/style.css`, `js/app.js`), áp dụng chuẩn Single-Source-of-Truth.
5. **Khắc phục lỗi nạp đúp CSS & JS**: Chuẩn hóa link `/batch-studio/style.css` và script `/batch-studio/app.js` trong `batch-studio/index.html`.
6. **Bổ sung nút tải trực tiếp `[📄 Tải .txt]`**: Nằm ngay trên thanh công cụ chính (không phụ thuộc menu dropdown), kèm modal xem trước và nút `[📋 Sao Chép Toàn Bộ]` với cơ chế `execCommand` fallback chạy 100% trên Safari/Chrome mobile và iframe.
7. **Tối ưu Mobile CSS**: Cấu hình grid 2x2 cho nút bấm trên màn hình nhỏ (< 480px), thanh công cụ co giãn hợp lý, nhãn ngôn ngữ rút gọn, không bị vỡ layout.
8. **Đơn giản hóa `server.js` & `vercel.json`**: Phục vụ tĩnh sạch sẽ, thêm rewrite route `/batch-studio`.

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