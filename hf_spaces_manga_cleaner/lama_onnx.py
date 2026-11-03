"""
Engine Inpainting sử dụng mô hình LaMa ONNX.
Được tối ưu riêng biệt cho môi trường CPU (Hugging Face Spaces):
- Tự động download mô hình lama ONNX từ Hugging Face Hub nếu chưa có.
- Hỗ trợ cơ chế Patch-based Inpainting (crop vùng chữ) & Downscaling (512px).
- Dọn dẹp bộ nhớ RAM sau khi chạy.
"""

import os
import gc
from typing import Optional, Tuple
import numpy as np
import cv2
import onnxruntime as ort
from huggingface_hub import hf_hub_download

# Mặc định sử dụng model LaMa fp16 siêu nhẹ đã tối ưu số thực cho CPU
DEFAULT_MODEL_REPO = "g-ronimo/lama"
DEFAULT_MODEL_FILENAME = "lama_fp16.onnx"


class LamaONNXInpainter:
    def __init__(self, model_path: Optional[str] = None, providers: Optional[list] = None):
        """
        Khởi tạo ONNX Runtime Inference Session cho LaMa.
        """
        if model_path is None or not os.path.exists(model_path):
            print(f"[LaMa] Đang tải trọng số từ HuggingFace: {DEFAULT_MODEL_REPO}/{DEFAULT_MODEL_FILENAME}...")
            model_path = hf_hub_download(
                repo_id=DEFAULT_MODEL_REPO,
                filename=DEFAULT_MODEL_FILENAME
            )
            print(f"[LaMa] Đã tải thành công model về: {model_path}")

        self.model_path = model_path
        
        # Cấu hình tối ưu CPU Session cho ONNX Runtime
        sess_options = ort.SessionOptions()
        sess_options.intra_op_num_threads = os.cpu_count() or 2
        sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        if providers is None:
            providers = ["CPUExecutionProvider"]

        self.session = ort.InferenceSession(self.model_path, sess_options, providers=providers)
        self.input_names = [inp.name for inp in self.session.get_inputs()]
        self.output_names = [out.name for out in self.session.get_outputs()]

    def _preprocess(self, image: np.ndarray, mask: np.ndarray, target_size: Optional[Tuple[int, int]] = None):
        """
        Tiền xử lý ảnh RGB và Mask nhị phân sang định dạng NCHW chuẩn hóa cho LaMa.
        """
        h, w = image.shape[:2]
        
        # Nếu có target_size (ví dụ chia hết cho 8 hoặc scale xuống 512)
        if target_size:
            tw, th = target_size
            image = cv2.resize(image, (tw, th), interpolation=cv2.INTER_AREA)
            mask = cv2.resize(mask, (tw, th), interpolation=cv2.INTER_NEAREST)
        else:
            # Đảm bảo kích thước chia hết cho 8 để qua được các tầng downsampling của UNet
            pad_h = (8 - h % 8) % 8
            pad_w = (8 - w % 8) % 8
            if pad_h > 0 or pad_w > 0:
                image = cv2.copyMakeBorder(image, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT)
                mask = cv2.copyMakeBorder(mask, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT)

        # Chuyển đổi sang float32 [0.0, 1.0]
        img_tensor = image.astype(np.float32) / 255.0
        img_tensor = np.transpose(img_tensor, (2, 0, 1))  # HWC -> CHW
        img_tensor = np.expand_dims(img_tensor, axis=0)   # CHW -> NCHW

        mask_tensor = (mask > 0).astype(np.float32)
        mask_tensor = np.expand_dims(mask_tensor, axis=0) # HW -> 1HW
        mask_tensor = np.expand_dims(mask_tensor, axis=0) # 1HW -> N1HW

        return img_tensor, mask_tensor, (h, w)

    def inpaint(self, image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """
        Inpainting trực tiếp trên một patch ảnh hoặc ảnh đã scale.
        """
        orig_h, orig_w = image_rgb.shape[:2]
        img_tensor, mask_tensor, _ = self._preprocess(image_rgb, mask)

        inputs = {
            self.input_names[0]: img_tensor,
            self.input_names[1]: mask_tensor
        }

        # Chạy inference
        outputs = self.session.run(self.output_names, inputs)
        result = outputs[0][0]  # (C, H, W)

        # Hậu xử lý: CHW -> HWC và clip [0, 255]
        result = np.transpose(result, (1, 2, 0))
        result = np.clip(result * 255.0, 0, 255).astype(np.uint8)

        # Cắt bỏ phần padding nếu trước đó đã pad
        result = result[:orig_h, :orig_w]
        return result

    def inpaint_smart_downscale(self, image_rgb: np.ndarray, mask: np.ndarray, max_dim: int = 512) -> np.ndarray:
        """
        Kỹ thuật Smart Downscale cho CPU:
        1. Resize ảnh về max_dim (mặc định 512px).
        2. Chạy inpaint cực nhanh (~1s).
        3. Phóng to kết quả về kích thước ban đầu.
        4. Hòa trộn (Alpha Blend): Chỉ đè phần có mask, bảo toàn 100% nét vẽ gốc ở phần không có chữ.
        """
        orig_h, orig_w = image_rgb.shape[:2]
        
        # Nếu ảnh đã nhỏ sẵn thì inpaint luôn
        if max(orig_h, orig_w) <= max_dim:
            return self.inpaint(image_rgb, mask)

        scale = max_dim / max(orig_h, orig_w)
        target_w = int(round(orig_w * scale / 8)) * 8
        target_h = int(round(orig_h * scale / 8)) * 8

        small_img = cv2.resize(image_rgb, (target_w, target_h), interpolation=cv2.INTER_AREA)
        small_mask = cv2.resize(mask, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

        # Inpaint trên ảnh nhỏ
        small_inpainted = self.inpaint(small_img, small_mask)

        # Upscale trở lại kích thước gốc
        upscaled_result = cv2.resize(small_inpainted, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)

        # Alpha Blend với Mask gốc (để phần không có chữ không bị mờ do resize)
        mask_3d = np.expand_dims(mask > 0, axis=-1).astype(np.float32)
        final_image = (upscaled_result.astype(np.float32) * mask_3d + 
                       image_rgb.astype(np.float32) * (1.0 - mask_3d)).astype(np.uint8)

        # Giải phóng bộ nhớ tạm thời
        del small_img, small_mask, small_inpainted, upscaled_result
        gc.collect()

        return final_image
