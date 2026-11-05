"""
Gradio Client chuyên biệt kết nối với Hugging Face Space 'dobietdc/manga-text-cleaner'.
Mặc định cấu hình Quality-First:
- Detector: 'default' (DBNet) - quét sạch chữ cả trong bóng thoại lẫn trên nền tranh.
- Inpainter: 'lama_large' (LaMa) - phục hồi nền mịn màng chuẩn studio, không để lại vết bẩn.
- Dilation offset: 2 - nuốt trọn bóng mờ và nét viền chữ.
- Giữ nguyên 100% độ phân giải gốc.
"""

import io
import json
import os
from pathlib import Path
import time
from typing import Optional, Union, Dict, Any, Tuple
from PIL import Image
import requests
from dotenv import load_dotenv

load_dotenv()


class HfGradioMangaCleanerClient:
    def __init__(
        self,
        space_name: str = "dobietdc/manga-text-cleaner",
        hf_token: Optional[str] = None
    ):
        """
        Khởi tạo Client kết nối Gradio Space.
        """
        self.space_name = space_name
        self.token = hf_token or os.getenv("HF_TOKEN")
        self.space_url = f"https://{space_name.replace('/', '-')}.hf.space"
        self.headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def clean_page(
        self,
        image_input: Union[bytes, str, Path],
        detector: str = "default",      # Ưu tiên 'default' (DBNet) để không sót chữ
        inpainter: str = "lama_large",  # Ưu tiên 'lama_large' (LaMa) để nền mịn phẳng
        dilation_offset: int = 2,       # Dilation 2px tối ưu chuẩn fit_text nuốt trọn viền chữ mà không lấn nét vẽ
        clean_mode: str = "all",        # 'all' (xóa tất cả) hoặc 'bubble_only' (giữ nguyên SFX, tóc, áo)
        max_dim: Optional[int] = None,  # Mặc định giữ nguyên độ phân giải gốc
        timeout: int = 120
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Gửi trang Manga lên Space để xóa chữ và nhận về ảnh sạch chuẩn Studio.
        """
        # 1. Đọc dữ liệu ảnh
        if isinstance(image_input, (str, Path)):
            with open(image_input, "rb") as f:
                img_bytes = f.read()
            filename = Path(image_input).name
        else:
            img_bytes = image_input
            filename = "page.webp"

        # 2. Xử lý Downscale (nếu người dùng yêu cầu)
        if max_dim is not None:
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            orig_size = pil_img.size
            orig_max = max(orig_size)
            if orig_max > max_dim:
                scale = max_dim / orig_max
                new_size = (int(round(orig_size[0] * scale)), int(round(orig_size[1] * scale)))
                pil_downscaled = pil_img.resize(new_size, Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                pil_downscaled.save(buf, format="WEBP", quality=95)
                send_bytes = buf.getvalue()
            else:
                send_bytes = img_bytes
                max_dim = None
        else:
            send_bytes = img_bytes

        # 3. Upload ảnh lên Gradio server (/gradio_api/upload)
        files = {"files": (filename, send_bytes, "image/webp")}
        up_resp = requests.post(
            f"{self.space_url}/gradio_api/upload",
            headers=self.headers,
            files=files,
            timeout=30
        )
        up_resp.raise_for_status()
        remote_path = up_resp.json()[0]

        # 4. Chuẩn bị payload Gradio FileData
        file_data = {
            "path": remote_path,
            "meta": {"_type": "gradio.FileData"}
        }
        session_hash = f"moeject_{int(time.time() * 1000)}"
        payload = {
            "data": [file_data, detector, inpainter, dilation_offset, clean_mode],
            "fn_index": 0,
            "session_hash": session_hash
        }

        # 5. Tham gia hàng đợi (Queue Join)
        q_resp = requests.post(
            f"{self.space_url}/gradio_api/queue/join",
            headers=self.headers,
            json=payload,
            timeout=30
        )
        q_resp.raise_for_status()

        # 6. Lắng nghe SSE stream nhận kết quả
        stream_url = f"{self.space_url}/gradio_api/queue/data?session_hash={session_hash}"
        cleaned_bytes_raw = None
        stats = {}

        with requests.get(stream_url, headers=self.headers, stream=True, timeout=timeout) as s_resp:
            for line in s_resp.iter_lines():
                if not line:
                    continue
                decoded = line.decode("utf-8")
                if not decoded.startswith("data: "):
                    continue
                msg = json.loads(decoded[6:])
                msg_type = msg.get("msg")
                
                if msg_type == "process_completed":
                    if not msg.get("success"):
                        err_msg = msg.get("output", {}).get("error", "Lỗi không xác định từ Space")
                        raise RuntimeError(f"Gradio Space execution failed: {err_msg}")
                    
                    data_out = msg.get("output", {}).get("data", [])
                    cleaned_info = data_out[0] if len(data_out) > 0 else {}
                    time_info = data_out[2] if len(data_out) > 2 else ""
                    stats_json_str = data_out[3] if len(data_out) > 3 else "{}"
                    
                    try:
                        stats = json.loads(stats_json_str)
                    except Exception:
                        stats = {"raw_time": time_info}

                    # Tải file kết quả về
                    if isinstance(cleaned_info, dict):
                        file_res_path = cleaned_info.get("path") or cleaned_info.get("url")
                        dl_url = f"{self.space_url}/gradio_api/file={file_res_path}" if not file_res_path.startswith("http") else file_res_path
                        dl_resp = requests.get(dl_url, headers=self.headers, timeout=30)
                        if dl_resp.status_code != 200:
                            dl_url = f"{self.space_url}/file={file_res_path}"
                            dl_resp = requests.get(dl_url, headers=self.headers, timeout=30)
                        dl_resp.raise_for_status()
                        cleaned_bytes_raw = dl_resp.content
                    break

        if cleaned_bytes_raw is None:
            raise TimeoutError("Không nhận được dữ liệu hoàn tất từ Gradio Space.")

        # 7. Upscale về kích thước ban đầu (nếu có downscale)
        if max_dim is not None:
            cleaned_pil_downscaled = Image.open(io.BytesIO(cleaned_bytes_raw)).convert("RGB")
            cleaned_pil_final = cleaned_pil_downscaled.resize(orig_size, Image.Resampling.LANCZOS)
            out_buf = io.BytesIO()
            cleaned_pil_final.save(out_buf, format="WEBP", quality=95)
            final_bytes = out_buf.getvalue()
        else:
            final_bytes = cleaned_bytes_raw

        return final_bytes, stats
