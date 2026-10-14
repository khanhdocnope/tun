"""
Module Dịch thuật Ngữ cảnh (core/translator.py)
- Sử dụng httpx (async) gọi sang API OpenAI-compatible (/v1/chat/completions).
- Gộp toàn bộ danh sách text cả trang thành một payload JSON duy nhất để LLM giữ nguyên văn cảnh.
- System Prompt chuyên nghiệp cho dịch truyện tranh: văn phong tự nhiên, xưng hô phù hợp, tự sửa lỗi chính tả do OCR.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
import httpx
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("translator")

load_dotenv()

DEFAULT_BASE_URL = os.getenv("DEEPSEEK_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://discovery-api.intern-ai.org.cn/v1"
DEFAULT_MODEL = os.getenv("DEEPSEEK_MODEL") or os.getenv("MODEL") or "deepseek-v4-flash-0731"
DEFAULT_API_KEY = os.getenv("DEEPSEEK_API_KEY") or os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY") or ""


def build_system_prompt(target_lang: str = "Vietnamese") -> str:
    return (
        f"Bạn là một biên dịch viên manga/manhwa/comic chuyên nghiệp dịch sang tiếng {target_lang}.\n"
        "Nhiệm vụ của bạn là dịch toàn bộ các đoạn thoại trên một trang truyện được cung cấp dưới dạng danh sách JSON.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. Dịch chuẩn xác theo ngữ cảnh tổng thể của toàn trang truyện.\n"
        "2. Sử dụng xưng hô và văn phong truyện tranh tự nhiên, mượt mà, đúng tâm lý nhân vật.\n"
        "3. Tự động nhận diện và sửa các lỗi chính tả, nhận diện sai ký tự phát sinh do OCR (ví dụ: chữ bị đứt nét, nhầm ký tự tương tự).\n"
        "4. Nếu một câu bị ngắt dòng qua nhiều bóng thoại, hãy ghép nối ngữ nghĩa cho liền mạch.\n"
        "5. Giữ nguyên cấu trúc JSON đầu ra tương ứng 100% với các 'id' đã cho. Không thêm bớt id.\n"
        "6. CHỈ trả về duy nhất chuỗi JSON hợp lệ theo định dạng: [{\"id\": 1, \"translated\": \"...\"}, ...]. Không giải thích, không thêm lời mở đầu hay kết thúc."
    )


def extract_json_from_response(raw_text: str) -> List[Dict[str, Any]]:
    """Trích xuất và làm sạch chuỗi JSON từ phản hồi của LLM."""
    text = raw_text.strip()

    # Bỏ markdown code block nếu có (```json ... ``` hoặc ``` ... ```)
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    # Parse JSON
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Nếu model bọc trong key như "translations" hoặc "data"
            for k, v in data.items():
                if isinstance(v, list):
                    return v
            return [data]
    except Exception as e:
        logger.warning("Không thể parse trực tiếp JSON: %s. Thử trích xuất mảng regex...", e)

    # Thử trích xuất mảng [...] bằng regex
    arr_match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", text)
    if arr_match:
        try:
            return json.loads(arr_match.group(0))
        except Exception:
            pass

    raise ValueError(f"Không thể trích xuất cấu trúc JSON từ phản hồi: {raw_text[:200]}...")


class MangaTranslator:
    """Client dịch thuật truyện tranh toàn trang bất đồng bộ."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self.api_key = (api_key or DEFAULT_API_KEY).strip()
        self.base_url = (base_url or DEFAULT_BASE_URL).strip().rstrip("/")
        self.model = (model or DEFAULT_MODEL).strip()
        self.timeout = timeout

    async def translate_page(
        self,
        items: List[Dict[str, Any]],
        target_lang: str = "Vietnamese",
        api_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Dịch toàn bộ danh sách text OCR trên trang truyện.
        items: List[{"id": int, "bbox": [...], "original_text": str, ...}]
        Trả về: items đã được điền "translated_text" tương ứng.
        """
        if not items:
            return []

        active_key = (api_key or self.api_key).strip()
        if not active_key:
            raise ValueError(
                "Thiếu API Key cho DeepSeek. Vui lòng truyền api_key trong request hoặc cấu hình biến môi trường DEEPSEEK_API_KEY / API_KEY."
            )

        # Lọc ra các item có nội dung chữ
        payload_input = []
        for it in items:
            text = (it.get("original_text") or "").strip()
            payload_input.append({"id": it["id"], "text": text})

        system_prompt = build_system_prompt(target_lang=target_lang)
        user_content = json.dumps(payload_input, ensure_ascii=False)

        headers = {
            "Authorization": f"Bearer {active_key}",
            "Content-Type": "application/json",
        }

        endpoint = f"{self.base_url}/chat/completions"
        request_body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Dịch danh sách sau sang {target_lang}:\n{user_content}"},
            ],
            "temperature": 0.3,
            "stream": False,
        }

        logger.info("Đang gửi %d đoạn thoại tới DeepSeek LLM (%s)...", len(payload_input), self.model)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(endpoint, headers=headers, json=request_body)
                resp.raise_for_status()
                res_json = resp.json()

                raw_reply = res_json["choices"][0]["message"]["content"]
                translated_list = extract_json_from_response(raw_reply)

                # Map kết quả dịch theo id
                trans_map: Dict[int, str] = {}
                for t in translated_list:
                    if isinstance(t, dict) and "id" in t:
                        trans_map[int(t["id"])] = str(t.get("translated") or t.get("text") or "").strip()

                # Gán vào danh sách kết quả
                for it in items:
                    it_id = int(it["id"])
                    it["translated_text"] = trans_map.get(it_id, it.get("original_text", ""))

                logger.info("Dịch thành công %d đoạn thoại.", len(items))
                return items

            except httpx.HTTPStatusError as exc:
                logger.error("HTTP error từ DeepSeek API (%s): %s", exc.response.status_code, exc.response.text)
                raise RuntimeError(f"DeepSeek API trả về lỗi {exc.response.status_code}: {exc.response.text}")
            except Exception as exc:
                logger.error("Lỗi trong quá trình dịch thuật: %s", exc)
                # Fallback: gán translated_text = original_text để không làm sập luồng
                for it in items:
                    it["translated_text"] = it.get("original_text", "")
                raise RuntimeError(f"Lỗi dịch thuật: {exc}")
