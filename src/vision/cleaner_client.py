"""
Gradio Client chuyên biệt kết nối với Hugging Face Space 'dobietdc/manga-text-cleaner'.
Hỗ trợ cơ chế Streaming EventSource và Queue của Gradio 5.x.
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
        detector: str = "default",      # "default" (DBNet) hoặc "ctd" (ComicTextDetector)
        inpainter: str = "aot",          # "aot", "lama_large", "lama_mpe"
        dilation_offset: int = 0,
        timeout: int = 120
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Gửi trang Manga lên Space để xóa chữ và nhận về ảnh sạch.
        
        Returns:
            Tuple[cleaned_image_bytes, stats_dict]
        """
        # 1. Đọc bytes ảnh
        if isinstance(image_input, (str, Path)):
            with open(image_input, "rb") as f:
                img_bytes = f.read()
            filename = Path(image_input).name
        else:
            img_bytes = image_input
            filename = "page.webp"

        # 2. Upload ảnh lên Gradio server (/gradio_api/upload)
        files = {"files": (filename, img_bytes, "image/webp")}
        up_resp = requests.post(
            f"{self.space_url}/gradio_api/upload",
            headers=self.headers,
            files=files,
            timeout=30
        )
        up_resp.raise_for_status()
        uploaded_files = up_resp.json()
        remote_path = uploaded_files[0]

        # 3. Chuẩn bị payload theo Gradio FileData format
        file_data = {
            "path": remote_path,
            "meta": {"_type": "gradio.FileData"}
        }
        session_hash = f"moeject_{int(time.time() * 1000)}"
        payload = {
            "data": [file_data, detector, inpainter, dilation_offset],
            "fn_index": 0,
            "session_hash": session_hash
        }

        # 4. Tham gia hàng đợi (Queue Join)
        q_resp = requests.post(
            f"{self.space_url}/gradio_api/queue/join",
            headers=self.headers,
            json=payload,
            timeout=30
        )
        q_resp.raise_for_status()

        # 5. Lắng nghe SSE stream nhận kết quả
        stream_url = f"{self.space_url}/gradio_api/queue/data?session_hash={session_hash}"
        cleaned_bytes = None
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
                        cleaned_bytes = dl_resp.content
                    break

        if cleaned_bytes is None:
            raise TimeoutError("Không nhận được dữ liệu hoàn tất từ Gradio Space.")

        return cleaned_bytes, stats
