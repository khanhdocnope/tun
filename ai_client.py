"""
Client kết nối API Intern-AI hỗ trợ cả 2 giao thức:
1. Giao thức OpenAI (OpenAI Protocol): https://discovery-api.intern-ai.org.cn/v1
2. Giao thức nhân sinh / Native (Native REST Protocol): https://discovery-api.intern-ai.org.cn
"""

import os
import sys
from typing import Dict, Any, List, Optional
import requests
from dotenv import load_dotenv

# Đảm bảo stdout hỗ trợ UTF-8 khi chạy trên terminal Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Tải cấu hình từ file .env
load_dotenv()


class AIClientConfig:
    """Quản lý các thông số cấu hình từ .env"""

    @staticmethod
    def get_api_key() -> str:
        key = (
            os.getenv("API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("API-KEY")
        )
        if not key:
            raise ValueError("Không tìm thấy API Key trong file .env (kiểm tra API_KEY hoặc OPENAI_API_KEY).")
        return key.strip()

    @staticmethod
    def get_model() -> str:
        return (os.getenv("MODEL") or os.getenv("MODEL_NAME") or "deepseek-v4-flash-0731").strip()

    @staticmethod
    def get_openai_base_url() -> str:
        return os.getenv("OPENAI_BASE_URL", "https://discovery-api.intern-ai.org.cn/v1").strip().rstrip("/")

    @staticmethod
    def get_native_base_url() -> str:
        return os.getenv("NATIVE_BASE_URL", "https://discovery-api.intern-ai.org.cn").strip().rstrip("/")


class InternAIClient:
    """Client giao tiếp với Intern-AI theo 2 giao thức OpenAI và Native"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        openai_base_url: Optional[str] = None,
        native_base_url: Optional[str] = None,
    ):
        self.api_key = api_key or AIClientConfig.get_api_key()
        self.model = model or AIClientConfig.get_model()
        self.openai_base_url = openai_base_url or AIClientConfig.get_openai_base_url()
        self.native_base_url = native_base_url or AIClientConfig.get_native_base_url()

        # Khởi tạo OpenAI SDK Client nếu có thư viện
        self._openai_client = None
        try:
            from openai import OpenAI
            self._openai_client = OpenAI(
                api_key=self.api_key,
                base_url=self.openai_base_url,
            )
        except ImportError:
            pass

    # --------------------------------------------------------------------------
    # 1. Giao thức OpenAI (Dùng OpenAI SDK chính thức hoặc fallback requests)
    # --------------------------------------------------------------------------
    def chat_openai(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Gửi yêu cầu qua Giao thức OpenAI (Base URL: https://discovery-api.intern-ai.org.cn/v1)
        """
        target_model = model or self.model
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        if self._openai_client:
            response = self._openai_client.chat.completions.create(
                model=target_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            choice = response.choices[0]
            content = choice.message.content or ""
            # Một số model DeepSeek hỗ trợ trường reasoning_content
            reasoning = getattr(choice.message, "reasoning_content", None)
            return {
                "protocol": "OpenAI (SDK)",
                "content": content,
                "reasoning": reasoning,
                "raw_response": response,
            }
        else:
            # Fallback HTTP nếu chưa cài openai sdk
            endpoint = f"{self.openai_base_url}/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": target_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            res = requests.post(endpoint, headers=headers, json=payload, timeout=60)
            res.raise_for_status()
            data = res.json()
            choice = data["choices"][0]["message"]
            return {
                "protocol": "OpenAI (HTTP)",
                "content": choice.get("content", ""),
                "reasoning": choice.get("reasoning_content", None),
                "raw_response": data,
            }

    # --------------------------------------------------------------------------
    # 2. Giao thức Nhân sinh / Native (Gửi REST HTTP trực tiếp tới Base URL)
    # --------------------------------------------------------------------------
    def chat_native(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Gửi yêu cầu qua Giao thức Nhân sinh (Native Base URL: https://discovery-api.intern-ai.org.cn)
        """
        target_model = model or self.model
        endpoint = f"{self.native_base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        res = requests.post(endpoint, headers=headers, json=payload, timeout=60)
        res.raise_for_status()
        data = res.json()
        choice = data["choices"][0]["message"]
        return {
            "protocol": "Native HTTP",
            "content": choice.get("content", ""),
            "reasoning": choice.get("reasoning_content", None),
            "raw_response": data,
        }

    # --------------------------------------------------------------------------
    # Giao diện tổng hợp chung
    # --------------------------------------------------------------------------
    def ask(
        self,
        prompt: str,
        protocol: str = "openai",
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1000,
    ) -> str:
        """
        Hàm tiện ích gửi prompt và nhận lại nội dung trả lời (text).
        :param protocol: 'openai' hoặc 'native'
        """
        if protocol.lower() == "native":
            result = self.chat_native(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        else:
            result = self.chat_openai(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        content = result.get("content")
        # Nếu model trả lời nằm trong reasoning (như một số phiên bản thinking/reasoning model)
        if not content and result.get("reasoning"):
            return f"[Suy luận / Reasoning]: {result['reasoning']}"
        return content or ""


def test_connection():
    """Hàm chạy kiểm tra tự động cả 2 giao thức"""
    print("=" * 60)
    print(" BẮT ĐẦU KIỂM TRA KẾT NỐI API INTERN-AI")
    print("=" * 60)

    try:
        client = InternAIClient()
        print(f"[*] API Key         : {client.api_key[:6]}...{client.api_key[-4:]}")
        print(f"[*] Model           : {client.model}")
        print(f"[*] OpenAI Base URL : {client.openai_base_url}")
        print(f"[*] Native Base URL : {client.native_base_url}")
        print("-" * 60)

        test_prompt = "Xin chào! Bạn có thể xác nhận kết nối thành công bằng 1 câu ngắn gọn không?"

        # 1. Kiểm tra Giao thức OpenAI
        print("\n[1] Đang kiểm tra GIAO THỨC OPENAI...")
        res_openai = client.chat_openai(prompt=test_prompt, max_tokens=150)
        print("-> Phản hồi từ Giao thức OpenAI:")
        if res_openai.get("content"):
            print(f"   {res_openai['content'].strip()}")
        if res_openai.get("reasoning"):
            print(f"   (Reasoning: {res_openai['reasoning'].strip()})")
        print("   => [THÀNH CÔNG]")

        # 2. Kiểm tra Giao thức Nhân sinh / Native
        print("\n[2] Đang kiểm tra GIAO THỨC NHÂN SINH (NATIVE)...")
        res_native = client.chat_native(prompt=test_prompt, max_tokens=150)
        print("-> Phản hồi từ Giao thức Nhân sinh:")
        if res_native.get("content"):
            print(f"   {res_native['content'].strip()}")
        if res_native.get("reasoning"):
            print(f"   (Reasoning: {res_native['reasoning'].strip()})")
        print("   => [THÀNH CÔNG]")

        print("\n" + "=" * 60)
        print(" TẤT CẢ KẾT NỐI ĐỀU HOẠT ĐỘNG HOÀN HẢO!")
        print("=" * 60)

    except Exception as e:
        print(f"\n[!] LỖI KHI KIỂM TRA KẾT NỐI: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_connection()
