# NHẬT KÝ PHÁT TRIỂN DỰ ÁN (PROJECT CHANGELOG)

## [2026-11-03] - Tích hợp thành công Hugging Face Space `dobietdc/manga-text-cleaner` (Gradio)

### Đã hoàn thành:
1. **Kết nối & Cấu hình Hugging Face Space:**
   - Đọc token xác thực từ file `.env` (`HF_TOKEN`).
   - Cập nhật nhẹ `app.py` trên Space `dobietdc/manga-text-cleaner` để mở khóa endpoint API `api_name="clean_image"`.
2. **Xây dựng Client Gradio Native chuyên nghiệp (`src/vision/cleaner_client.py`):**
   - Viết class `HfGradioMangaCleanerClient` hỗ trợ giao thức Gradio 5.x:
     - Upload ảnh đa định dạng (WebP, JPG, PNG) lên `/gradio_api/upload`.
     - Tham gia hàng đợi `/gradio_api/queue/join`.
     - Lắng nghe EventSource (SSE) qua stream `/gradio_api/queue/data` và tự động kéo ảnh sạch về máy.
3. **Thử nghiệm thực tế với tập ảnh mẫu trong `image-test/`:**
   - Chạy test thành công trang `image-test/0.webp`: Xóa sạch chữ, tổng thời gian 8.5s (Inpaint: 1.1s trên GPU CUDA của Space). Lưu kết quả tại `image-test/0_cleaned.webp`.
   - Chạy test thành công trang `image-test/03.webp`: Tổng thời gian chỉ **2.9s** (Inpaint: 0.24s). Lưu kết quả tại `image-test/03_cleaned.webp`.
