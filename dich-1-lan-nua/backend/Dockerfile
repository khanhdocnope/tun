FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860

# OpenCV needs libGL/libglib even in the headless build.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# CPU-only torch: the CUDA stack would add ~2.5 GB to the image for nothing.
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu

COPY . .

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD curl -fsS http://127.0.0.1:7860/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers"]
