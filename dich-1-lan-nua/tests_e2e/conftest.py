"""
Pytest configuration and shared fixtures for E2E testing suite.
"""

import sys
from pathlib import Path
import pytest
import httpx
from starlette.testclient import TestClient

# Ensure backend directory is in sys.path
WORKSPACE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = WORKSPACE_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app
from tests_e2e.fixtures.sample_images import (
    create_test_png,
    create_test_jpeg,
    create_test_webp,
    create_corrupt_image,
    create_micro_image,
)
from tests_e2e.fixtures.mock_zip import (
    create_clean_manga_zip,
    create_dirty_manga_zip,
    create_empty_zip,
    create_non_image_zip,
)


@pytest.fixture(scope="session")
def client():
    """Synchronous test client wired to the FastAPI app."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def async_client():
    """Asynchronous test client wired to the FastAPI app."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def sample_png_bytes():
    return create_test_png(800, 1200)


@pytest.fixture
def sample_jpeg_bytes():
    return create_test_jpeg(1000, 1500)


@pytest.fixture
def sample_webp_bytes():
    return create_test_webp(1200, 1800)


@pytest.fixture
def corrupt_image_bytes():
    return create_corrupt_image()


@pytest.fixture
def micro_image_bytes():
    return create_micro_image()


@pytest.fixture
def clean_zip_bytes():
    return create_clean_manga_zip()


@pytest.fixture
def dirty_zip_bytes():
    return create_dirty_manga_zip()
