"""
Hệ thống Smart DNS & DoH (DNS-over-HTTPS) Resolver cho MoeJect.
Tự động phát hiện và vượt qua cơ chế DNS Poisoning của các nhà mạng (ISP) tại Việt Nam
khi truy cập các nguồn manga như MangaDex, Cứu Truyện (tránh lỗi 127.0.0.1 / WinError 10061).
"""

import logging
import socket
import threading
from typing import Dict, List, Optional
import urllib.request
import json

logger = logging.getLogger(__name__)

_dns_lock = threading.Lock()
_dns_cache: Dict[str, List[str]] = {
    # Fallback IP tĩnh được kiểm chứng an toàn cho các CDN/Domain chính
    "api.mangadex.org": ["45.129.229.1", "45.129.229.2"],
    "mangadex.org": ["45.129.229.1", "45.129.229.2"],
    "uploads.mangadex.org": ["45.129.229.1", "45.129.229.2"],
    "cuutruyen.net": ["172.67.182.143", "104.21.40.80"],
    "hetcuutruyen.net": ["172.67.182.143", "104.21.40.80"],
    "comix.to": ["104.21.49.220", "172.67.152.235"],
}
_is_patched = False
_orig_getaddrinfo = socket.getaddrinfo


def resolve_doh(host: str, timeout: float = 3.0) -> List[str]:
    """
    Phân giải tên miền qua Cloudflare DNS-over-HTTPS (1.1.1.1).
    """
    if host in _dns_cache and _dns_cache[host]:
        return _dns_cache[host]

    url = f"https://1.1.1.1/dns-query?name={host}&type=A"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/dns-json",
            "User-Agent": "MoeJect-DNS/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
            answers = data.get("Answer", [])
            ips = [ans["data"] for ans in answers if ans.get("type") == 1]
            if ips:
                with _dns_lock:
                    _dns_cache[host] = ips
                return ips
    except Exception as e:
        logger.debug(f"[SmartDNS] DoH query thất bại cho {host}: {e}")

    # Fallback cache nếu có
    return _dns_cache.get(host, [])


def _smart_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """
    Hàm thay thế cho socket.getaddrinfo.
    Nếu DNS hệ thống trả về 127.0.0.1 hoặc ::1 cho các domain manga (bị ISP chặn),
    hàm sẽ dùng IP thực từ DoH.
    """
    # Chuẩn hóa host nếu là bytes
    norm_host = host
    if isinstance(norm_host, (bytes, bytearray)):
        norm_host = norm_host.decode("utf-8", errors="ignore")
    elif norm_host is not None:
        norm_host = str(norm_host)

    try:
        res = _orig_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror:
        res = []

    # Kiểm tra xem có bị trỏ về localhost / loopback do ISP chặn không
    is_poisoned = False
    if res:
        is_poisoned = all(item[4][0] in ("127.0.0.1", "::1", "0.0.0.0") for item in res)
    else:
        is_poisoned = True

    if is_poisoned and norm_host and norm_host not in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        ips = resolve_doh(norm_host)
        if ips:
            custom_res = []
            for ip in ips:
                # Trả về định dạng getaddrinfo chuẩn (AF_INET, SOCK_STREAM, proto, canonname, (ip, port))
                custom_res.append(
                    (socket.AF_INET, type or socket.SOCK_STREAM, proto or 6, "", (ip, port))
                )
            return custom_res

    if res:
        return res
    raise socket.gaierror(f"Không thể phân giải tên miền: {host}")


def enable_smart_dns() -> None:
    """Kích hoạt smart DNS resolver bảo vệ tầng socket toàn cục."""
    global _is_patched
    if not _is_patched:
        with _dns_lock:
            if not _is_patched:
                socket.getaddrinfo = _smart_getaddrinfo
                _is_patched = True
                logger.info("[SmartDNS] Đã kích hoạt cơ chế Smart DoH Resolver chống chặn ISP.")


def get_chrome_dns_args() -> List[str]:
    """
    Tạo các cờ dòng lệnh cho Chromium / nodriver nhằm vượt chặn DNS của ISP.
    """
    # Xây dựng danh sách host mapping cho Chrome
    mappings = []
    for host, ips in _dns_cache.items():
        if ips:
            mappings.append(f"MAP {host} {ips[0]}")
            mappings.append(f"MAP *.{host} {ips[0]}")

    rules_str = ", ".join(mappings)
    return [
        f"--host-resolver-rules={rules_str}",
        "--enable-features=DnsOverHttps",
        "--dns-over-https-templates=https://chrome.cloudflare-dns.com/dns-query",
    ]
