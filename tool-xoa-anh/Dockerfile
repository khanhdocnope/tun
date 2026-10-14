FROM python:3.10-slim

# Ngăn Python ghi file .pyc và buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PORT=7860 \
    HOME=/home/user

# Cài đặt thư viện hệ thống cần thiết cho OpenCV, PaddleOCR và xử lý ảnh trên CPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập user non-root theo tiêu chuẩn Hugging Face Spaces (UID 1000)
RUN useradd -m -u 1000 user
WORKDIR /app

# Copy requirements và cài đặt dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ source code
COPY --chown=user:user . /app

# Tạo thư mục cache và cấp quyền
RUN mkdir -p /app/outputs /app/weights /app/models /home/user/.cache && \
    chown -R user:user /app /home/user

USER user

# Download / verify models
RUN python download_models.py || true

EXPOSE 7860

# Khởi chạy FastAPI App kèm Gradio UI và Swagger Docs (/docs)
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
