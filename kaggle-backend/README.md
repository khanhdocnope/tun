# Hướng Dẫn Chạy Backend Manga Cleaner Trên Kaggle GPU + Cloudflare Tunnel

Backend này được tối ưu đặc biệt để chạy **trực tiếp trên GPU chuyên dụng (Nvidia T4 hoặc P100)** của Kaggle.
- **Tốc độ:** ~0.5s - 1.2s / trang (nhanh gấp nhiều lần so với Hugging Face ZeroGPU bị nghẽn queue).
- **Chi phí:** 100% Miễn phí (30 giờ GPU/tuần trên Kaggle).
- **Public URL:** Tự động phát sinh qua Cloudflare Tunnel (`https://xxxx.trycloudflare.com`).

---

## Cách 1: Nhanh nhất — Tải toàn bộ thư mục `kaggle-backend` lên Kaggle Dataset hoặc Git

1. Nén thư mục `kaggle-backend` thành file `kaggle-backend.zip`.
2. Vào **[Kaggle.com](https://www.kaggle.com)** -> Đăng nhập -> Chọn **+ Create** -> **New Notebook**.
3. Ở cột bên phải (Settings):
   - **Accelerator**: Chọn **GPU T4 x2** hoặc **GPU P100**.
   - **Internet**: Bật **ON** (bắt buộc để tải model và chạy Cloudflare Tunnel).
4. Tải file `manga_cleaner_kaggle.ipynb` lên Kaggle (Menu **File -> Import Notebook** -> chọn file `manga_cleaner_kaggle.ipynb`).
5. Upload các file code (`server.py`, `manga_cleaner.py`, `text_detector.py`, `mask_logic.py`, `bubble_detector.py`, `download_models.py` và thư mục `models/` nếu có) vào thư mục làm việc `/kaggle/working/` (hoặc upload qua Kaggle Dataset/Git).
6. Bấm **Run All** (hoặc chạy lần lượt từng ô cell).

---

## Cách 2: Chạy trực tiếp từ Notebook (Tự động clone từ GitHub)

Nếu bạn đẩy code lên GitHub cá nhân (hoặc repo công khai), trong Notebook Kaggle bạn chỉ cần chạy cell đầu tiên:

```bash
!git clone https://github.com/<username>/<repo>.git app_code
%cd app_code/kaggle-backend
```

Sau đó chạy tiếp các bước trong notebook:
1. `!pip install -r requirements.txt`
2. `!python download_models.py`
3. Chạy cell khởi động Cloudflare Tunnel + `python server.py`.

---

## Lấy URL và Kết Nối vào Web (Vercel)

1. Khi cell cuối cùng chạy xong, màn hình sẽ in ra:
   ```text
   ============================================================
   🎉 URL BACKEND CỦA BẠN ĐÃ SẴN SÀNG:
   👉 https://random-name-xyz.trycloudflare.com
   ============================================================
   ```
2. Mở web studio của bạn (trên Vercel hoặc localhost).
3. Vào phần **Cài đặt** (Settings) -> Dán URL `https://random-name-xyz.trycloudflare.com` vào ô **URL Backend**.
4. Bắt đầu xóa chữ truyện với tốc độ GPU tức thì!
