"""
Web App Backend (Flask) cho Chat UI tối giản & quản lý danh sách mô hình từ model_list.txt
Hỗ trợ cả 2 giao thức: OpenAI Protocol và Giao thức Nhân sinh (Native)
"""

import os
import sys
import json
import time
from typing import Generator, Dict, Any, List
from flask import Flask, render_template, request, Response, jsonify, stream_with_context
from dotenv import load_dotenv
import requests

# Đảm bảo UTF-8 cho stdout/stderr
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

load_dotenv()

app = Flask(__name__, template_folder="templates", static_folder="static")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_LIST_FILE = os.path.join(BASE_DIR, "model_list.txt")
ENV_FILE = os.path.join(BASE_DIR, ".env")


def get_env_config():
    """Lấy cấu hình hiện tại từ .env"""
    load_dotenv(override=True)
    return {
        "api_key": (os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY") or os.getenv("API-KEY") or "").strip(),
        "model": (os.getenv("MODEL") or os.getenv("MODEL_NAME") or "deepseek-v4-flash-0731").strip(),
        "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://discovery-api.intern-ai.org.cn/v1").strip().rstrip("/"),
        "native_base_url": os.getenv("NATIVE_BASE_URL", "https://discovery-api.intern-ai.org.cn").strip().rstrip("/"),
    }


def parse_model_list(filepath=MODEL_LIST_FILE):
    """Phân tích danh sách mô hình từ file model_list.txt"""
    if not os.path.exists(filepath):
        return []

    with open(filepath, "r", encoding="utf-8") as f:
        raw_text = f.read()

    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    models = []
    
    i = 0
    while i < len(lines):
        display_name = lines[i]
        model_id = lines[i+1] if i + 1 < len(lines) else display_name
        metadata = lines[i+2] if i + 2 < len(lines) else ""
        
        parts = [p.strip() for p in metadata.split("\t") if p.strip()]
        if not parts and "\t" in model_id:
            parts = [p.strip() for p in model_id.split("\t") if p.strip()]
            model_id = display_name
            i += 2
        else:
            i += 3
            
        m_type = parts[0] if len(parts) > 0 else "大语言模型"
        modalities = parts[1] if len(parts) > 1 else "文本"
        context = parts[2] if len(parts) > 2 else "1M"
        features = parts[3] if len(parts) > 3 else ""
        protocols = parts[4] if len(parts) > 4 else "OpenAI Chat"
        
        # Nhận diện tính năng
        is_vision = ("图像" in modalities) or ("vision" in model_id.lower())
        has_deep_think = ("深度思考" in features) or ("deepseek" in model_id.lower())
        has_tools = "工具调用" in features

        models.append({
            "id": model_id,
            "name": display_name,
            "type": m_type,
            "modalities": modalities,
            "context": context,
            "features": features,
            "protocols": protocols,
            "is_vision": is_vision,
            "has_deep_think": has_deep_think,
            "has_tools": has_tools,
        })
        
    return models


@app.route("/")
def index():
    """Trang chủ giao diện Chat Web UI"""
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    """Trả về cấu hình và trạng thái hiện tại"""
    cfg = get_env_config()
    models = parse_model_list()
    return jsonify({
        "status": "online",
        "current_model": cfg["model"],
        "openai_base_url": cfg["openai_base_url"],
        "native_base_url": cfg["native_base_url"],
        "has_api_key": bool(cfg["api_key"]),
        "total_models": len(models),
    })


@app.route("/api/models", methods=["GET"])
def list_models():
    """Trả về danh sách tất cả các mô hình được phân tích từ model_list.txt"""
    models = parse_model_list()
    cfg = get_env_config()
    return jsonify({
        "models": models,
        "current_model": cfg["model"]
    })


@app.route("/api/models/raw", methods=["GET"])
def get_raw_model_list():
    """Đọc nội dung thô của model_list.txt để quản lý/chỉnh sửa"""
    if not os.path.exists(MODEL_LIST_FILE):
        return jsonify({"content": ""})
    with open(MODEL_LIST_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    return jsonify({"content": content})


@app.route("/api/models/raw", methods=["POST"])
def save_raw_model_list():
    """Lưu cập nhật trực tiếp vào file model_list.txt"""
    data = request.get_json() or {}
    new_content = data.get("content", "")
    try:
        with open(MODEL_LIST_FILE, "w", encoding="utf-8") as f:
            f.write(new_content)
        parsed = parse_model_list()
        return jsonify({
            "success": True,
            "message": f"Đã lưu thành công {len(parsed)} mô hình vào model_list.txt",
            "models": parsed
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/models/select", methods=["POST"])
def select_model():
    """Chọn mô hình mặc định mới và cập nhật file .env"""
    data = request.get_json() or {}
    model_id = data.get("model_id")
    if not model_id:
        return jsonify({"success": False, "error": "Thiếu model_id"}), 400

    cfg = get_env_config()
    cfg["model"] = model_id
    
    # Cập nhật trong file .env nếu có
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, "r", encoding="utf-8") as f:
                env_text = f.read()
            lines = env_text.splitlines()
            new_lines = []
            model_set = False
            for line in lines:
                if line.startswith("MODEL=") or line.startswith("MODEL_NAME="):
                    if not model_set:
                        new_lines.append(f"MODEL={model_id}")
                        new_lines.append(f"MODEL_NAME={model_id}")
                        model_set = True
                else:
                    new_lines.append(line)
            if not model_set:
                new_lines.append(f"MODEL={model_id}")
                new_lines.append(f"MODEL_NAME={model_id}")
            with open(ENV_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(new_lines) + "\n")
        except Exception as e:
            print("Cảnh báo khi ghi .env:", e)

    return jsonify({"success": True, "selected_model": model_id})


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Endpoint chat với Server-Sent Events (SSE) Streaming.
    Hỗ trợ cả Giao thức OpenAI và Giao thức Nhân sinh (Native).
    """
    data = request.get_json() or {}
    messages = data.get("messages", [])
    model = data.get("model") or get_env_config()["model"]
    protocol = data.get("protocol", "openai").lower()  # 'openai' hoặc 'native'
    temperature = float(data.get("temperature", 0.7))
    max_tokens = int(data.get("max_tokens", 2048))

    cfg = get_env_config()
    api_key = cfg["api_key"]

    if not api_key:
        return jsonify({"error": "Chưa thiết lập API Key trong file .env"}), 400

    def generate_stream() -> Generator[str, None, None]:
        try:
            # Chọn Base URL theo giao thức
            if protocol == "native":
                base_url = cfg["native_base_url"]
                endpoint = f"{base_url}/v1/chat/completions"
            else:
                base_url = cfg["openai_base_url"]
                endpoint = f"{base_url}/chat/completions"

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
            }

            # Gửi HTTP Streaming request
            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                stream=True,
                timeout=120,
            )

            if response.status_code != 200:
                err_text = response.text
                yield f"data: {json.dumps({'error': f'Lỗi API ({response.status_code}): {err_text}'}, ensure_ascii=False)}\n\n"
                return

            for line in response.iter_lines():
                if not line:
                    continue
                line_str = line.decode("utf-8")
                if line_str.startswith("data: "):
                    raw_data = line_str[6:].strip()
                    if raw_data == "[DONE]":
                        yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"
                        break
                    try:
                        chunk = json.loads(raw_data)
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        
                        # Nội dung suy luận (Reasoning token)
                        reasoning_token = delta.get("reasoning_content")
                        if reasoning_token:
                            yield f"data: {json.dumps({'reasoning': reasoning_token}, ensure_ascii=False)}\n\n"
                        
                        # Nội dung trả lời (Content token)
                        content_token = delta.get("content")
                        if content_token:
                            yield f"data: {json.dumps({'content': content_token}, ensure_ascii=False)}\n\n"

                    except json.JSONDecodeError:
                        continue

            yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

        except Exception as ex:
            yield f"data: {json.dumps({'error': str(ex)}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Khởi động Web UI tại: http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
