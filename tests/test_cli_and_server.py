"""
Bộ kiểm thử toàn diện cho module CLI (Typer/Rich) và REST API Server (FastAPI).
Project MoeJect.
"""

import asyncio
from pathlib import Path
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from src.cli.main import app as cli_app
from src.core.models import Chapter, DownloadReport, MangaInfo, MangaSearchResult, OutputFormat
from src.server.app import app as api_app, task_manager
from src.utils.chapter_filter import filter_chapters

runner = CliRunner(env={"COLUMNS": "160"})
client = TestClient(api_app)


# ==========================================
# FIXTURES & DUMMY DATA
# ==========================================


@pytest.fixture
def dummy_manga_info():
    """Tạo đối tượng MangaInfo mẫu để phục vụ kiểm thử."""
    chapters = [
        Chapter(
            id="ch-01",
            title="Khởi đầu",
            chapter_number="1",
            url="https://mangadex.org/chapter/ch-01",
            scanlator="MangaPlus",
            pages=["https://uploads.mangadex.org/data/p1.webp", "https://uploads.mangadex.org/data/p2.webp"],
        ),
        Chapter(
            id="ch-02",
            title="Đồng đội",
            chapter_number="2",
            url="https://mangadex.org/chapter/ch-02",
            scanlator="MangaPlus",
            pages=["https://uploads.mangadex.org/data/p3.webp"],
        ),
        Chapter(
            id="ch-03",
            title="Chiến đấu",
            chapter_number="3",
            url="https://mangadex.org/chapter/ch-03",
            scanlator="MangaPlus",
            pages=["https://uploads.mangadex.org/data/p4.webp"],
        ),
    ]
    return MangaInfo(
        id="manga-uuid-1234",
        title="Manga Mẫu Siêu Đẳng",
        url="https://mangadex.org/title/manga-uuid-1234",
        cover_url="https://uploads.mangadex.org/covers/cover.jpg",
        description="Mô tả nội dung truyện tranh mẫu dùng cho Unit Test.",
        authors=["Tác Giả A", "Họa Sĩ B"],
        genres=["Action", "Adventure"],
        chapters=chapters,
    )


@pytest.fixture
def dummy_search_results():
    """Tạo danh sách kết quả tìm kiếm mẫu."""
    return [
        MangaSearchResult(
            id="manga-uuid-1234",
            title="Manga Mẫu Siêu Đẳng",
            url="https://mangadex.org/title/manga-uuid-1234",
            cover_url="https://uploads.mangadex.org/covers/cover.jpg",
            latest_chapter="3",
            description="Mô tả ngắn truyện tranh.",
            authors=["Tác Giả A"],
            genres=["Action"],
        ),
        MangaSearchResult(
            id="manga-uuid-5678",
            title="Truyện Tranh Kỳ Diệu",
            url="https://mangadex.org/title/manga-uuid-5678",
            cover_url=None,
            latest_chapter="10",
            description="Mô tả truyện thứ hai.",
            authors=["Tác Giả C"],
            genres=["Comedy"],
        ),
    ]


# ==========================================
# 1. UNIT TESTS CHO CHAPTER FILTER UTILS
# ==========================================


def test_filter_chapters_range(dummy_manga_info):
    """Kiểm tra lọc chapters theo biểu thức dải '1-2'."""
    chs = filter_chapters(dummy_manga_info.chapters, selection="1-2")
    assert len(chs) == 2
    assert [c.chapter_number for c in chs] == ["1", "2"]


def test_filter_chapters_single_and_comma(dummy_manga_info):
    """Kiểm tra lọc chapters kết hợp dấu phẩy '1, 3'."""
    chs = filter_chapters(dummy_manga_info.chapters, selection="1, 3")
    assert len(chs) == 2
    assert [c.chapter_number for c in chs] == ["1", "3"]


def test_filter_chapters_all(dummy_manga_info):
    """Kiểm tra lọc với 'all' hoặc rỗng trả về toàn bộ chapters."""
    assert len(filter_chapters(dummy_manga_info.chapters, selection="all")) == 3
    assert len(filter_chapters(dummy_manga_info.chapters, selection=None)) == 3


def test_filter_chapters_explicit_ids(dummy_manga_info):
    """Kiểm tra lọc theo danh sách ID cụ thể."""
    chs = filter_chapters(dummy_manga_info.chapters, explicit_ids=["ch-02"])
    assert len(chs) == 1
    assert chs[0].id == "ch-02"


# ==========================================
# 2. KIỂM THỬ GIAO DIỆN DÒNG LỆNH (CLI TESTS)
# ==========================================


def test_cli_help():
    """Kiểm tra lệnh help của Typer CLI."""
    result = runner.invoke(cli_app, ["--help"])
    assert result.exit_code == 0
    assert "sources" in result.output
    assert "search" in result.output
    assert "info" in result.output
    assert "download" in result.output


def test_cli_sources():
    """Kiểm tra lệnh 'sources' hiển thị danh sách các nguồn manga khả dụng."""
    result = runner.invoke(cli_app, ["sources"])
    assert result.exit_code == 0
    assert "MangaDex" in result.output
    assert "Cuutruyen" in result.output
    assert "mangadex" in result.output
    assert "cuutruyen" in result.output


def test_cli_search_success(dummy_search_results):
    """Kiểm tra lệnh 'search' hiển thị bảng Rich Table khi có kết quả."""
    mock_source = MagicMock()
    mock_source.source_name = "MangaDex"
    mock_source.search = AsyncMock(return_value=dummy_search_results)
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    with patch("src.cli.main.get_source", return_value=mock_source):
        result = runner.invoke(cli_app, ["search", "Manga Mẫu", "--source", "mangadex"])
        assert result.exit_code == 0
        assert "Manga Mẫu Siêu Đẳng" in result.output
        assert "manga-uuid-1234" in result.output
        assert "Tác Giả A" in result.output


def test_cli_search_empty():
    """Kiểm tra lệnh 'search' khi không tìm thấy kết quả nào."""
    mock_source = MagicMock()
    mock_source.source_name = "MangaDex"
    mock_source.search = AsyncMock(return_value=[])
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    with patch("src.cli.main.get_source", return_value=mock_source):
        result = runner.invoke(cli_app, ["search", "KhôngTồnTại123", "--source", "mangadex"])
        assert result.exit_code == 0
        assert "Không tìm thấy kết quả nào" in result.output


def test_cli_search_invalid_source():
    """Kiểm tra lệnh 'search' với nguồn không hợp lệ."""
    result = runner.invoke(cli_app, ["search", "Test", "--source", "invalid_source"])
    assert result.exit_code != 0
    assert "không hợp lệ" in result.output.lower() or "lỗi" in result.output.lower()


def test_cli_info_success(dummy_manga_info):
    """Kiểm tra lệnh 'info' hiển thị panel chi tiết và bảng danh sách chapter."""
    mock_source = MagicMock()
    mock_source.source_name = "MangaDex"
    mock_source.get_manga_details = AsyncMock(return_value=dummy_manga_info)
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    with patch("src.cli.main.get_source", return_value=mock_source):
        result = runner.invoke(cli_app, ["info", "manga-uuid-1234", "--source", "mangadex"])
        assert result.exit_code == 0
        assert "Manga Mẫu Siêu Đẳng" in result.output
        assert "Khởi đầu" in result.output
        assert "ch-01" in result.output
        assert "MangaPlus" in result.output


def test_cli_download_command(dummy_manga_info, tmp_path):
    """Kiểm tra lệnh 'download' tải và đóng gói CBZ thành công với Rich Progress bar."""
    mock_source = MagicMock()
    mock_source.source_name = "MangaDex"
    mock_source.get_manga_details = AsyncMock(return_value=dummy_manga_info)
    mock_source.get_chapter_pages = AsyncMock(return_value=["https://test.com/1.jpg", "https://test.com/2.jpg"])
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    # Mock download_chapter để trả về DownloadReport thành công
    dummy_report = DownloadReport(
        chapter_id="ch-01",
        total_pages=2,
        downloaded_pages=[(0, b"fake_bytes"), (1, b"fake_bytes")],
        output_path=tmp_path / "Ch.1 - Khởi đầu.cbz",
    )

    with patch("src.cli.main.get_source", return_value=mock_source), \
         patch("src.cli.main.ConcurrentMangaDownloader.download_chapter", return_value=dummy_report):
        result = runner.invoke(
            cli_app,
            [
                "download",
                "manga-uuid-1234",
                "--source",
                "mangadex",
                "--chapters",
                "1",
                "--format",
                "cbz",
                "--output-dir",
                str(tmp_path),
            ],
        )
        assert result.exit_code == 0
        assert "TẢI HOÀN TẤT" in result.output or "Thành công" in result.output


def test_cli_download_invalid_format():
    """Kiểm tra lệnh 'download' báo lỗi khi truyền định dạng không hỗ trợ."""
    result = runner.invoke(cli_app, ["download", "123", "--format", "unsupported_fmt"])
    assert result.exit_code != 0
    assert "không được hỗ trợ" in result.output.lower()


# ==========================================
# 3. KIỂM THỬ REST API SERVER (FASTAPI TESTS)
# ==========================================


def test_api_health():
    """Kiểm tra endpoint /api/health trả về trạng thái ok."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "MoeJect REST API" in data["service"]
    assert "timestamp" in data


def test_api_sources():
    """Kiểm tra endpoint /api/sources trả về danh sách các nguồn truyện."""
    response = client.get("/api/sources")
    assert response.status_code == 200
    data = response.json()
    assert "sources" in data
    source_ids = [s["id"] for s in data["sources"]]
    assert "mangadex" in source_ids
    assert "cuutruyen" in source_ids


def test_api_cors_middleware():
    """Kiểm tra CORS headers cho phép gọi từ Frontend clients."""
    response = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") in ("*", "http://localhost:3000")


def test_api_search_success(dummy_search_results):
    """Kiểm tra GET /api/search trả về kết quả tìm kiếm chuẩn hóa."""
    mock_source = MagicMock()
    mock_source.search = AsyncMock(return_value=dummy_search_results)
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    with patch("src.server.app.get_source", return_value=mock_source):
        response = client.get("/api/search", params={"source": "mangadex", "q": "One Piece", "page": 1})
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "mangadex"
        assert data["query"] == "One Piece"
        assert data["total"] == 2
        assert len(data["results"]) == 2
        assert data["results"][0]["id"] == "manga-uuid-1234"
        assert data["results"][0]["title"] == "Manga Mẫu Siêu Đẳng"


def test_api_search_invalid_source():
    """Kiểm tra GET /api/search báo lỗi 400 khi truyền nguồn không hợp lệ."""
    response = client.get("/api/search", params={"source": "invalid_source", "q": "Test"})
    assert response.status_code == 400
    assert "không hợp lệ" in response.json()["detail"].lower()


def test_api_manga_detail_success(dummy_manga_info):
    """Kiểm tra GET /api/manga/{source}/{manga_id} trả về thông tin chi tiết và danh sách chapters."""
    mock_source = MagicMock()
    mock_source.get_manga_details = AsyncMock(return_value=dummy_manga_info)
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    with patch("src.server.app.get_source", return_value=mock_source):
        response = client.get("/api/manga/mangadex/manga-uuid-1234")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "manga-uuid-1234"
        assert data["title"] == "Manga Mẫu Siêu Đẳng"
        assert data["total_chapters"] == 3
        assert len(data["chapters"]) == 3
        assert data["chapters"][0]["chapter_number"] == "1"


def test_api_manga_detail_invalid_source():
    """Kiểm tra GET /api/manga/{source}/{manga_id} với nguồn không hợp lệ trả về 400."""
    response = client.get("/api/manga/invalid_source/12345")
    assert response.status_code == 400


def test_api_download_task_lifecycle(dummy_manga_info, tmp_path):
    """Kiểm tra quy trình tạo tác vụ ngầm POST /api/download và kiểm tra tiến độ GET /api/download/{task_id}."""
    payload = {
        "source": "mangadex",
        "manga_id": "manga-uuid-1234",
        "chapters": "1",
        "format": "cbz",
        "output_dir": str(tmp_path),
    }

    mock_source = MagicMock()
    mock_source.get_manga_details = AsyncMock(return_value=dummy_manga_info)
    mock_source.get_chapter_pages = AsyncMock(return_value=["https://img.com/1.jpg"])
    mock_source.__aenter__ = AsyncMock(return_value=mock_source)
    mock_source.__aexit__ = AsyncMock(return_value=None)

    dummy_report = DownloadReport(
        chapter_id="ch-01",
        total_pages=1,
        downloaded_pages=[(0, b"data")],
        output_path=tmp_path / "Ch.1.cbz",
    )

    with patch("src.server.app.get_source", return_value=mock_source), \
         patch("src.server.app.ConcurrentMangaDownloader.download_chapter", return_value=dummy_report):
        post_resp = client.post("/api/download", json=payload)
        assert post_resp.status_code == 202
        post_data = post_resp.json()
        assert "task_id" in post_data
        assert post_data["status"] == "pending"
        task_id = post_data["task_id"]

        # Tra cứu trạng thái tác vụ qua GET /api/download/{task_id}
        get_resp = client.get(f"/api/download/{task_id}")
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert get_data["task_id"] == task_id
        assert get_data["source"] == "mangadex"
        assert get_data["manga_id"] == "manga-uuid-1234"
        assert "progress" in get_data
        assert "results" in get_data


def test_api_download_task_not_found():
    """Kiểm tra GET /api/download/{task_id} trả về 404 với ID không tồn tại."""
    response = client.get("/api/download/non-existent-task-id-999")
    assert response.status_code == 404
    assert "không tìm thấy" in response.json()["detail"].lower()


def test_api_download_invalid_format():
    """Kiểm tra POST /api/download báo lỗi 400 với format không hợp lệ."""
    payload = {
        "source": "mangadex",
        "manga_id": "123",
        "format": "invalid_extension",
    }
    response = client.post("/api/download", json=payload)
    assert response.status_code == 400
    assert "định dạng" in response.json()["detail"].lower()
