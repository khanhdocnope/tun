import io
from typing import AsyncGenerator
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Provide an asynchronous HTTP client configured with ASGITransport for the FastAPI app."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def generate_test_image(
    format: str = "PNG",
    width: int = 100,
    height: int = 100,
    color: tuple = (255, 0, 0),
) -> bytes:
    """Generate in-memory valid image bytes for testing."""
    img = Image.new("RGB", (width, height), color=color)
    buffer = io.BytesIO()
    img.save(buffer, format=format)
    return buffer.getvalue()


@pytest.fixture
def valid_png_bytes() -> bytes:
    """Fixture providing valid PNG image bytes (120x180)."""
    return generate_test_image(format="PNG", width=120, height=180, color=(20, 120, 220))


@pytest.fixture
def valid_jpeg_bytes() -> bytes:
    """Fixture providing valid JPEG image bytes (150x200)."""
    return generate_test_image(format="JPEG", width=150, height=200, color=(200, 50, 50))


@pytest.fixture
def valid_webp_bytes() -> bytes:
    """Fixture providing valid WebP image bytes (80x120)."""
    return generate_test_image(format="WEBP", width=80, height=120, color=(50, 200, 50))


@pytest.fixture
def corrupt_image_bytes() -> bytes:
    """Fixture providing corrupt image bytes with a broken PNG header."""
    return b"\x89PNG\r\n\x1a\n" + b"CORRUPTED_PAYLOAD_NOT_A_REAL_IMAGE" * 10


@pytest.fixture
def text_file_bytes() -> bytes:
    """Fixture providing plain text bytes disguised as an image."""
    return b"Hello world! This is definitely not an image file."
