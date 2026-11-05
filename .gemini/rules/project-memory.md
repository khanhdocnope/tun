# Project MoeJect - AI Assistant Living Rules

## 1. Mạch định hướng cốt lõi (Core Focus)
- Giữ vững 2 trụ cột: Ingestion (bền bỉ, bypass WAF từ comix-downloader) & Vision Pipeline (xóa chữ, inpaint phục hồi nền manga).
- Giữ mã nguồn phân tách rõ ràng (core/api vs vision/formats).

## 2. Tính linh hoạt (Pragmatic Flexibility)
- Các giải pháp trong `doc/` là kim chỉ nam mặc định ưu tiên, KHÔNG phải giáo điều cứng nhắc.
- Được phép linh hoạt thử nghiệm, tinh chỉnh thuật toán (ví dụ: kích thước resize, fallback bounding box/polygon, model inpaint) khi tình huống thực tế đòi hỏi chất lượng hoặc hiệu năng tốt hơn.

## 3. Ưu tiên thị giác trực quan (Multimodal Vision First - BẮT BUỘC)
- AI có năng lực thị giác trực tiếp. Khi người dùng gửi ảnh lỗi hoặc ảnh kết quả, PHẢI dùng mắt nhìn trực quan trực tiếp để đánh giá tính thẩm mỹ và bố cục.
- TUYỆT ĐỐI KHÔNG dùng code/lệnh chạy script pixel mù quáng để phỏng đoán khi đã có ảnh trước mắt.

## 4. Luật cập nhật tài liệu (Documentation Evolution - BẮT BUỘC)
- Khi thêm ý tưởng mới, thay đổi giải pháp kỹ thuật hoặc kiến trúc: AI PHẢI chủ động cập nhật ngay vào `doc/` tương ứng và ghi nhận vào `doc/CHANGELOG.md`.
- Giữ `doc/` luôn là "tấm gương phản chiếu chân thực" của mã nguồn.
