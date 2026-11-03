---
title: Manga Cleaner AI Engine
emoji: 🧹
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Manga Cleaner AI Engine (HF Spaces CPU)

REST API chuyên biệt xử lý bóc tách và xóa chữ trên Manga / Manhwa / Webtoon:
- **Phát hiện chữ:** RapidOCR Polygon Detection bám sát chữ nghiêng, chữ uốn lượn.
- **Tạo Mask:** OpenCV Dilation mở rộng biên bảo toàn chi tiết viền.
- **Inpainting phục hồi nền:** LaMa ONNX FP16 tối ưu cho 2 vCPU.

### Endpoint chính:
- `POST /clean`: Xóa chữ và trả về ảnh WebP sạch nền.
- `POST /detect`: Trích xuất JSON danh sách text và tọa độ polygon phục vụ dịch thuật.
