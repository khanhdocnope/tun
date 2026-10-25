"""
Sample image generators for E2E testing.
Generates valid PNG, JPEG, WebP, corrupt bytes, micro images, and oversized payloads.
"""

import io
from PIL import Image


def create_test_png(width: int = 100, height: int = 100, color: tuple = (255, 0, 0)) -> bytes:
    """Create a valid PNG image in bytes."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def create_test_jpeg(width: int = 100, height: int = 100, color: tuple = (0, 255, 0)) -> bytes:
    """Create a valid JPEG image in bytes."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def create_test_webp(width: int = 100, height: int = 100, color: tuple = (0, 0, 255)) -> bytes:
    """Create a valid WebP image in bytes."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format="WEBP", quality=90)
    return buffer.getvalue()


def create_micro_image(width: int = 1, height: int = 1) -> bytes:
    """Create a micro image (1x1 pixel)."""
    return create_test_png(width=width, height=height, color=(128, 128, 128))


def create_corrupt_image(mime: str = "image/png") -> bytes:
    """Create corrupt non-image bytes pretending to be an image."""
    # PE Header / Plain text disguised as image
    return b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00This is definitely not an image file!"


def create_oversized_payload(size_mb: int = 51) -> bytes:
    """Generate payload exceeding the 50MB limit."""
    # Generates a buffer larger than 50MB
    return b"X" * (size_mb * 1024 * 1024)
