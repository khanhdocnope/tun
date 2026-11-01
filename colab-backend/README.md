# Hướng Dẫn Chạy Backend Manga Cleaner Trên Google Colab (GPU T4)

Google Colab hoàn toàn **dùng tài khoản Gmail có sẵn**, **không cần xác minh số điện thoại**.

---

### Bước 1: Mở Google Colab
1. Truy cập: **[colab.research.google.com](https://colab.research.google.com)**.
2. Bấm vào **Tải sổ tay lên (Upload Notebook)** ➔ Chọn file [`colab-backend/manga_cleaner_colab.ipynb`](file:///d:/tool-xoa-anh-manga/colab-backend/manga_cleaner_colab.ipynb).

---

### Bước 2: Bật GPU T4 Miễn Phí (Rất dễ)
1. Trên thanh menu trên cùng của Colab, chọn **Thời gian chạy (Runtime)** ➔ **Thay đổi loại thời gian chạy (Change runtime type)**.
2. Ở mục *Phần cứng tăng tốc (Hardware accelerator)*: Chọn **T4 GPU**.
3. Bấm **Lưu (Save)**.

---

### Bước 3: Chạy Notebook
1. Chọn **Thời gian chạy (Runtime)** ➔ **Chạy tất cả (Run all)** (hoặc bấm nút Play lần lượt ở từng ô cell).
2. Khi cell cuối cùng chạy xong, màn hình sẽ in ra đường dẫn Cloudflare Tunnel:
   ```text
   ============================================================
   🎉 URL BACKEND CỦA BẠN ĐÃ SẴN SÀNG:
   👉 https://abc-xyz-123.trycloudflare.com
   ============================================================
   ```
3. Copy link đó dán vào ô **Cài đặt URL Backend** trên web Vercel.
4. Tốc độ xóa chữ sẽ nhanh như chớp: **~0.6s - 1.2s/trang** nhờ GPU T4 16GB VRAM!
