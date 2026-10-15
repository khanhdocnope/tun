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
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("translator")

load_dotenv()

DEFAULT_BASE_URL = os.getenv("DEEPSEEK_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://discovery-api.intern-ai.org.cn/v1"
DEFAULT_MODEL = os.getenv("DEEPSEEK_MODEL") or os.getenv("MODEL") or "deepseek-v4-flash-0731"
DEFAULT_API_KEY = os.getenv("DEEPSEEK_API_KEY") or os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY") or ""


PROMPT_TXT_PATH = Path(__file__).resolve().parent.parent / "prompt.txt"
if not PROMPT_TXT_PATH.is_file():
    alt_p = Path(__file__).resolve().parent.parent.parent / "prompt.txt"
    if alt_p.is_file():
        PROMPT_TXT_PATH = alt_p


def build_system_prompt(target_lang: str = "Vietnamese") -> str:
    # 1. Đọc trực tiếp từ prompt.txt nếu tồn tại
    if PROMPT_TXT_PATH.is_file():
        try:
            with open(PROMPT_TXT_PATH, "r", encoding="utf-8") as f:
                raw_rules = f.read()
            formatted = raw_rules.replace("${targetName}", target_lang).replace("${sourceName}", "Manga/Comic")
            return (
                f"{formatted}\n\n"
                "## CRITICAL OUTPUT JSON CONTRACT:\n"
                "- Output MUST be a valid JSON array of objects mapping 1-to-1 with input IDs: "
                '[{"id": 1, "translated": "..."}, ...]\n'
                "- Return ONLY the JSON array. Absolutely NO intro, NO markdown commentary, NO notes."
            )
        except Exception as err:
            logger.warning("Không thể đọc prompt.txt: %s, dùng prompt mặc định.", err)

    # 2. Fallback prompt chuẩn hóa sẵn
    return (
        f"You are a professional comic/manga/manhwa localization expert with 20+ years of experience translating into {target_lang}.\n"
        f"Your task is to translate an entire page of comic speech bubbles provided as a structured JSON list.\n\n"
        "## CRITICAL TRANSLATION GUIDELINES & RULES:\n\n"
        "1. CONTEXTUAL COHESION & VISUAL ALIGNMENT:\n"
        f"   - Translate accurately into natural, expressive, modern {target_lang} suited to the comic genre (shonen, shojo, seinen, webtoon).\n"
        "   - MULTI-BUBBLE SENTENCES: When a single sentence is split across consecutive bubbles, comprehend the full sentence first, then distribute the translation naturally across those exact IDs without losing grammatical flow.\n"
        "   - OCR ERROR AUTO-CORRECTION: Comics frequently suffer from OCR noise (confused characters like l/I/|, broken punctuation, broken Kanji/furigana). Automatically infer and repair OCR typos using narrative context.\n\n"
        "2. TONE, HONORIFICS & ADDRESSING:\n"
        f"   - Reflect character relationships, ages, and intimacy levels accurately using appropriate pronouns and honorifics in {target_lang} (e.g. Vietnamese xưng hô: anh/em, cậu/tớ, mày/tao, tiền bối/hậu bối, đại nhân).\n"
        "   - Maintain consistent character voice across all bubbles on the page.\n\n"
        "3. SOUND EFFECTS (SFX):\n"
        f"   - If a text item is a standalone sound effect / onomatopoeia (e.g., BANG, THUD, DOKI-DOKI, MEOW), translate or transliterate it BRIEFLY into a punchy {target_lang} sound equivalent.\n"
        "   - Do NOT translate sound effects literally as full explanatory sentences.\n\n"
        "4. CAPITALIZATION & SPECIAL PUNCTUATION:\n"
        f"   - DE-CAPITALIZE ALL-CAPS: Comic source fonts often use ALL-CAPS by default, NOT because characters are shouting. Always convert to natural sentence case (capitalize only the first letter and proper nouns) following standard {target_lang} spelling.\n"
        f"   - JAPANESE WAVE DASH ('〜' / '～'): Indicates a drawn-out, sing-song, or playful trailing tone. Do NOT replace with ellipsis ('...'), which wrongly implies hesitation. Keep the wave dash or naturally elongate the final sound in {target_lang}.\n\n"
        "5. STRICT OUTPUT INTEGRITY:\n"
        "   - TRULY EMPTY BUBBLES: If a text item has no translatable text or contains only unreadable noise, return an empty string \"\" for 'translated'. NEVER output placeholder notes like '(blank)', '(empty)', '(no text)', 'N/A', or '(để trống)'.\n"
        "   - PRESERVE EVERY ID: Output MUST map 1-to-1 with every single input 'id'. Never merge, skip, or create new IDs.\n"
        "   - STRICT JSON OUTPUT: Return ONLY a valid JSON array of objects: [{\"id\": 1, \"translated\": \"...\"}, ...]. Absolutely NO markdown commentary, NO introduction, and NO notes."
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
        timeout: float = 12.0,
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
            logger.info("Không có API Key cho DeepSeek, giữ nguyên bản OCR gốc (bỏ qua bước dịch).")
            for it in items:
                it["translated_text"] = it.get("original_text", "")
            return items

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

            except Exception as exc:
                logger.warning("DeepSeek API lỗi hoặc timeout (%s). Giữ nguyên kết quả OCR gốc.", exc)
                for it in items:
                    if "translated_text" not in it or not it["translated_text"]:
                        it["translated_text"] = it.get("original_text", "")
                return items
