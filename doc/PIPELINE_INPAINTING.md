# PIPELINE XÓA CHỮ & KHÔI PHỤC NỀN MANGA (MANGA INPAINTING)
## ĐẶC TẢ KỸ THUẬT CHO MÔI TRƯỜNG CPU / HUGGING FACE SPACES

> **Tôn chỉ:** Chạy mượt mà, ổn định trên CPU thông thường (2 vCPU - 16GB RAM) mà không bị Out-Of-Memory (OOM) hay nghẽn CPU. Thời gian xử lý mỗi trang truyện phải duy trì dưới 2–3 giây.

---

### GIAI ĐOẠN 1: TEXT DETECTION & POLYGON MASKING

#### 1. Công nghệ: `RapidOCR`
- **Cấu hình bắt buộc:** `return_polygons = True`.
- **Lý do kỹ thuật:** Manga có rất nhiều chữ dọc, chữ xếp nghiêng theo bóng thoại tròn hoặc elip, và từ tượng thanh (SFX). Bounding Box hình chữ nhật (xmin, ymin, xmax, ymax) sẽ lấy thừa quá nhiều phần tranh vẽ xung quanh chữ $\rightarrow$ làm LaMa vẽ hỏng nét vẽ gốc. Đa giác (Polygon) chỉ bao sát nét chữ.

#### 2. Kỹ thuật tạo Mask bằng OpenCV:
```python
import cv2
import numpy as np

def generate_text_mask(image_shape, polygons, dilation_kernel_size=5, padding_px=6):
    """
    Tạo binary mask từ danh sách các đa giác (polygons).
    - image_shape: (H, W) hoặc (H, W, C)
    - polygons: list các numpy array tọa độ [[x1, y1], [x2, y2], ...]
    """
    h, w = image_shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # 1. Vẽ đa giác chữ màu trắng (255) trên nền đen (0)
    for poly in polygons:
        pts = np.array(poly, dtype=np.int32)
        cv2.fillPoly(mask, [pts], color=255)
        
    # 2. Mở rộng biên (Dilation) để phủ kín viền chữ, bóng đổ (shadows) và nét mảnh
    if dilation_kernel_size > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation_kernel_size, dilation_kernel_size))
        mask = cv2.dilate(mask, kernel, iterations=1)
        
    return mask
```

---

### GIAI ĐOẠN 2: INPAINTING & TÁI TẠO NỀN (LAMA ONNX CPU)

#### 1. Lựa chọn Model & Trọng số:
- **Ưu tiên 1 (Chất lượng cao nhất):** `mayocream/lama-manga` (SafeTensors/ONNX). Đã fine-tune trên ~300.000 tranh manga/anime, hiểu rõ screentone, nét mực manga và gradient bóng thoại.
- **Ưu tiên 2 (Siêu nhẹ, tải nhanh):** `g-ronimo/lama` (`lama_fp16.onnx` hoặc `lama_int8.onnx` kích thước ~110MB). Không bị lỗi tràn số khi lượng tử hóa, chạy cực ổn định trên ONNX Runtime CPU.

#### 2. Kỹ thuật tăng tốc trên CPU (Giảm thời gian từ 15s $\rightarrow$ <2s):

* **Kỹ thuật A: Patch-based Inpainting (Chỉ inpaint phần có chữ):**
  - Không đưa toàn bộ ảnh $1200 \times 1800$ vào LaMa.
  - Tìm các vùng liên thông (Connected Components) hoặc Bounding Boxes của Mask.
  - Crop từng vùng có chữ ra kèm lề đệm 32px (để LaMa có thông tin ngữ cảnh xung quanh để tái tạo).
  - Cho LaMa inpaint từng mẩu nhỏ này.
  - Dán (Paste) ngược lại vào ảnh gốc.
  
* **Kỹ thuật B: Smart Downscaling:**
  - Nếu trang có chữ rải rác toàn trang: Resize cạnh dài nhất về 512px.
  - Đưa qua LaMa ONNX (chỉ mất ~1.2s trên CPU).
  - Resize kết quả inpainting về kích thước ban đầu và dùng Mask gốc để hòa trộn (Alpha Blend): Chỉ lấy pixel tại vị trí có mask, giữ nguyên $100\%$ độ nét của phần tranh không có chữ.

#### 3. Quản lý Bộ nhớ (Garbage Collection):
- Vì chạy trên môi trường hạn chế RAM (HF CPU Spaces):
  ```python
  import gc
  # Sau khi inpaint xong mỗi trang:
  del mask, patch, input_tensor
  gc.collect()
  ```
