import os
import re
import subprocess
import sys
import time
from pathlib import Path

# 1. Download cloudflared binary nếu chưa có
cloudflared_bin = Path("/tmp/cloudflared")
if not cloudflared_bin.exists():
    print("[1/3] Đang tải Cloudflare Tunnel (cloudflared)...")
    cmd = "curl -L --output /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /tmp/cloudflared"
    subprocess.run(cmd, shell=True, check=True)
else:
    print("[1/3] Cloudflare Tunnel đã sẵn sàng.")

# 2. Khởi chạy Cloudflare tunnel tới cổng 7860
print("[2/3] Đang khởi tạo đường truyền Cloudflare Tunnel tới localhost:7860...")
log_file = open("/tmp/cloudflared.log", "w")
cf_proc = subprocess.Popen(
    ["/tmp/cloudflared", "tunnel", "--url", "http://127.0.0.1:7860"],
    stdout=log_file,
    stderr=subprocess.STDOUT,
)

# 3. Quét log tìm link https://*.trycloudflare.com
public_url = None
for _ in range(30):
    time.sleep(1)
    if Path("/tmp/cloudflared.log").exists():
        content = Path("/tmp/cloudflared.log").read_text(errors="ignore")
        match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", content)
        if match:
            public_url = match.group(0)
            break

print("=" * 60)
if public_url:
    print(f"🎉 BACKEND PUBLIC URL CỦA BẠN:")
    print(f"👉 {public_url}")
    print("=" * 60)
    print("👉 Hãy dán URL trên vào ô 'Cài đặt URL Backend' trên giao diện Web (Vercel)!")
    print(f"👉 Kiểm tra trạng thái: {public_url}/health")
else:
    print("⚠️ Không lấy được URL tự động. Hãy xem log tại /tmp/cloudflared.log")
print("=" * 60)
