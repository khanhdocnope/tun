---
title: Autonomous Manga Cleaner
emoji: ⚡
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 5.20.0
app_file: app.py
pinned: false
license: mit
---

# ⚡ Autonomous Manga Cleaner (ZeroGPU A100 Edition)

Pipeline bóc tách thông minh **Chat (Bóng thoại)** & **SFX (Hiệu ứng âm thanh)** cùng thuật toán phục hồi tranh Manga/Manhwa siêu tốc bằng **ComicTextDetector & Anime-Manga Big-LaMa**.

## 🚀 Tính năng nổi bật
- **Phân loại thông minh Chat vs SFX**:
  - 🟢 **Xanh lá (Chat):** Chữ thoại trong bóng $\rightarrow$ Xóa sạch bóng thoại, giữ nguyên form tranh.
  - 🔴 **Đỏ (SFX):** Hiệu ứng âm thanh vẽ tay $\rightarrow$ Mặc định giữ nguyên nét vẽ tác giả (hoặc xóa sạch nếu người dùng bật tùy chọn).
- **Sub-second ZeroGPU Inpainting**: Chạy qua `@spaces.GPU(duration=15)` trên Nvidia A100 với tốc độ ~0.2s - 0.5s/trang! Tự động chuyển CPU mượt mà khi hết lượt.
- **1:1 Pixel-Perfect Mask Blending**: Giữ nguyên vẹn 100% chi tiết nét vẽ và screentone gốc của các vùng không có chữ.
- **Giao diện đa năng**: Hỗ trợ xem trước Color Mask trực quan, Quẹt cọ vẽ tay (Brush Editor), và Xử lý hàng loạt tệp ZIP (Batch ZIP).
- **REST API tích hợp**: Cung cấp `/health`, `/api/clean_page`, `/api/clean_zip` sẵn sàng cho Web/Mobile App.
