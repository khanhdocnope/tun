# ⚡ MangaStudio AI - Frontend Vercel

Ứng dụng Frontend độc lập dành cho **MangaStudio AI**: Nền tảng tự động bóc tách bóng thoại, tẩy chữ giữ nét vẽ (Inpaint) và dịch thuật ngữ cảnh Manga/Manhwa bằng LLM DeepSeek.

## 🚀 Tính năng nổi bật
* **AI Manga Cleaner**:
  * Đa mô hình inpaint: `Anime-Manga LaMa`, `Big-LaMa`, `OpenCV Telea`, `OpenCV Navier-Stokes`.
  * **Thanh trượt so sánh Before/After thời gian thực (Interactive Split Slider)**: Kéo trượt để so sánh ảnh gốc và ảnh đã xóa trực quan.
  * Tải ảnh chất lượng gốc (JPG 98% / PNG Lossless).
* **AI Manga Translator (Bubble OCR)**:
  * **🎯 Chỉ nhận diện & dịch chữ trong Bong Bóng Thoại**: Loại bỏ 100% SFX vẽ tay làm nhiễu bản dịch.
  * Bản đồ thứ tự đọc logic với thẻ số `#1`, `#2`, `#3...` phủ trực tiếp lên trang truyện.
  * Bảng đối chiếu câu thoại chi tiết (hover/click bóng thoại để đồng bộ hàng trong bảng).
  * Xuất kịch bản dịch Markdown / tải tệp `.txt`.
* **Xử lý hàng loạt tệp ZIP (Batch ZIP)**:
  * Hỗ trợ tệp ZIP nguyên chapter (10 - 50 trang).
  * Chế độ 1: Tẩy chữ hàng loạt $\rightarrow$ Tải ZIP ảnh đã xóa.
  * Chế độ 2: Dịch thuật toàn bộ ZIP $\rightarrow$ Tải gói kịch bản hoàn chỉnh.
* **Cấu hình API linh hoạt**:
  * Mặc định kết nối Hugging Face Space: `https://dobietdc-backe-manga-remove.hf.space`
  * Dễ dàng đổi sang server local `http://localhost:7860` khi test.
  * Lưu API Key DeepSeek / OpenAI an toàn trong `localStorage` trình duyệt.

## 🏛️ Kiến Trúc Hệ Thống & Ghi Chú API Legacy (Giai Đoạn 1)

### Chapter Workspace (/batch-studio)
Batch Studio (`/batch-studio`) hiện là **Workspace duy nhất** cho việc xử lý dịch truyện tranh và chapter hàng loạt:
- **Tẩy chữ AI hàng loạt**: Gọi `/api/clean`, giới hạn 2 concurrent requests có retry, lưu ảnh sạch vào IndexedDB v2 (kho `cleaned`).
- **OCR & Dịch ngữ cảnh Gemini**: Gọi `/api/process-batch` (Gemini 3.1 flash-lite / 3.5), hỗ trợ ngữ cảnh 12 dòng lùi 3 trang (`prevContext`), dual-worker song song 30 RPM.
- **Xuất dữ liệu**: Xuất ZIP ảnh đã tẩy chữ (giữ nguyên tên gốc), xuất script `.txt`, `.doc`, hoặc tải gói trọn bộ ZIP.

### Danh Sách API Legacy & Vị Trí UI Gọi
Các API sau được giữ nguyên nhằm đảm bảo tương thích ngược, không bị xóa nhưng được phân loại là **Legacy** (các tab UI tương ứng đã được ẩn sau cờ `const LEGACY_TABS = false` trong `index.html`):

| API | Trạng thái | Mục đích | Nơi UI còn gọi (Ẩn sau LEGACY_TABS) |
|---|---|---|---|
| `/api/vision.js` | **Legacy** | Bóc tách bong bóng thoại (YOLO / Gemini 2.5 Flash) | `index.html`: `runVisionOcr()`, `runQuickTranslate()` trong `tab-translator` |
| `/api/ocr.js` | **Legacy** | Quét OCR crop từng bóng thoại bằng Manga-OCR | `index.html`: `runCropOcr()` trong `tab-translator` |
| `/api/translate.js` | **Legacy** | Dịch mảng bong bóng thoại bằng DeepSeek / OpenAI | `index.html`: `runVisionTranslate()` trong `tab-translator` |
| `/api/batch-zip.js` | **Legacy** | Giải nén ZIP server-side và xử lý batch bằng DeepSeek | `index.html`: `runBatchProcessing()` trong `tab-batch` |

> [!NOTE]
> Trang chính hiện chỉ hiển thị 2 tab tinh gọn: **"Xóa chữ"** (`tab-cleaner`) và **"Dịch lại script"** (`tab-script-retrans`). Mọi tác vụ dịch truyện tranh đều mở trực tiếp sang `/batch-studio` qua liên kết header "Chương (hàng loạt)".

## 📦 Cách Triển Khai Lên Vercel

### Cách 1: Sử dụng Vercel CLI (Nhanh nhất)
1. Cài đặt Vercel CLI (nếu chưa có):
   ```bash
   npm i -g vercel
   ```
2. Mở terminal tại thư mục này và gõ lệnh:
   ```bash
   cd "d:\tool-xoa-anh-manga\web-in-vercel"
   vercel
   ```
3. Đăng nhập và làm theo hướng dẫn trên màn hình $\rightarrow$ Vercel sẽ cung cấp link web production dạng `https://mangastudio-ai.vercel.app`.

### Cách 2: Deploy qua GitHub
1. Đẩy thư mục `web-in-vercel` lên kho lưu trữ GitHub của bạn.
2. Truy cập [vercel.com](https://vercel.com) $\rightarrow$ bấm **Add New Project** $\rightarrow$ chọn repository.
3. Trong mục **Root Directory**, chọn thư mục `web-in-vercel` và bấm **Deploy**!
