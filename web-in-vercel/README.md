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
