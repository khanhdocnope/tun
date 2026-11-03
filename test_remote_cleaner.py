import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import time
import json
import requests
from dotenv import load_dotenv

load_dotenv('d:\\MoeJect\\.env')
token = os.getenv('HF_TOKEN')
headers = {'Authorization': f'Bearer {token}'} if token else {}
space_url = 'https://dobietdc-manga-text-cleaner.hf.space'

test_image_path = 'd:\\MoeJect\\image-test\\0.webp'
print(f"Uploading image to /gradio_api/upload: {test_image_path}")

with open(test_image_path, 'rb') as f:
    files = {'files': ('0.webp', f, 'image/webp')}
    up_resp = requests.post(f'{space_url}/gradio_api/upload', headers=headers, files=files)
    print(f"Upload HTTP status: {up_resp.status_code}")
    uploaded_files = up_resp.json()
    print(f"Server response file paths: {uploaded_files}")

file_data = {
    'path': uploaded_files[0],
    'meta': {'_type': 'gradio.FileData'}
}

session_hash = f"moeject_{int(time.time())}"
payload = {
    'data': [
        file_data,       # Image input
        'default',       # Detector: 'default' (hoặc 'ctd')
        'aot',           # Inpainter: 'aot' (hoặc 'lama_large')
        0                # Dilation Offset: 0
    ],
    'fn_index': 0,
    'session_hash': session_hash
}

print(f"Joining Gradio queue at /gradio_api/queue/join (session_hash: {session_hash})...")
# Thử cả /gradio_api/queue/join và /queue/join
q_resp = requests.post(f'{space_url}/gradio_api/queue/join', headers=headers, json=payload)
if q_resp.status_code != 200:
    print(f"/gradio_api/queue/join failed ({q_resp.status_code}), fallback to /queue/join")
    q_resp = requests.post(f'{space_url}/queue/join', headers=headers, json=payload)
    queue_data_base = f"{space_url}/queue/data"
else:
    queue_data_base = f"{space_url}/gradio_api/queue/data"

print(f"Queue join status: {q_resp.status_code}")
event_id = q_resp.json().get('event_id')
print(f"Event ID: {event_id}")

stream_url = f"{queue_data_base}?session_hash={session_hash}"
print(f"Connecting to stream: {stream_url}")
with requests.get(stream_url, headers=headers, stream=True, timeout=120) as s_resp:
    for line in s_resp.iter_lines():
        if line:
            decoded = line.decode('utf-8')
            if decoded.startswith('data: '):
                msg = json.loads(decoded[6:])
                msg_type = msg.get('msg')
                print(f"-> Msg event: {msg_type}")
                if msg_type == 'process_completed':
                    if msg.get('success'):
                        out = msg.get('output', {}).get('data', [])
                        print("\n==========================================")
                        print("XỬ LÝ THÀNH CÔNG RỰC RỠ TRÊN SPACE!")
                        print(f"Thời gian xử lý: {out[2] if len(out) > 2 else ''}")
                        print(f"Thống kê chi tiết: {out[3] if len(out) > 3 else ''}")
                        
                        # Tải ảnh sạch về máy
                        cleaned_info = out[0]
                        if isinstance(cleaned_info, dict):
                            img_path = cleaned_info.get('path') or cleaned_info.get('url')
                            if img_path:
                                download_url = f"{space_url}/gradio_api/file={img_path}" if not img_path.startswith('http') else img_path
                                img_resp = requests.get(download_url, headers=headers)
                                if img_resp.status_code != 200:
                                    download_url = f"{space_url}/file={img_path}"
                                    img_resp = requests.get(download_url, headers=headers)
                                
                                output_file = 'd:\\MoeJect\\image-test\\0_cleaned.webp'
                                with open(output_file, 'wb') as out_f:
                                    out_f.write(img_resp.content)
                                print(f"-> ĐÃ LƯU ẢNH SẠCH CHỮ VỀ: {output_file} (Kích thước: {len(img_resp.content)} bytes)")
                        print("==========================================\n")
                    else:
                        print(f"Lỗi từ server: {msg.get('output', {}).get('error')}")
                    break
