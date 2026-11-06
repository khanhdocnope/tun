"""
Bộ kiểm thử toàn diện cho Manga Source Connectors & WAF Bypass (Project MoeJect).
Kiểm thử BaseMangaSource, MangaDexSource, CuutruyenSource, ComixSource, browser_runner và Factory registry.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from src.api.base import BaseMangaSource
from src.api.browser_runner import CloudflareBypassRunner
from src.api.comix import ComixSource
from src.api.cuutruyen import CuutruyenSource
from src.api.mangadex import MangaDexSource
from src.api import get_source, list_sources, register_source
from src.core.models import Chapter, MangaInfo, MangaSearchResult


def test_base_source_cannot_be_instantiated():
    """Đảm bảo BaseMangaSource không thể khởi tạo trực tiếp vì chứa abstract methods."""
    with pytest.raises(TypeError):
        BaseMangaSource()


def test_registry_list_sources():
    """Kiểm tra registry trả về đúng danh sách 3 sources mặc định: mangadex, cuutruyen, comix."""
    sources = list_sources()
    assert "mangadex" in sources
    assert "cuutruyen" in sources
    assert "comix" in sources


def test_get_source_factory():
    """Kiểm tra hàm get_source khởi tạo đúng class tương ứng."""
    md = get_source("mangadex")
    assert isinstance(md, MangaDexSource)
    assert md.source_id == "mangadex"

    ct = get_source("cuutruyen")
    assert isinstance(ct, CuutruyenSource)
    assert ct.source_id == "cuutruyen"

    cx = get_source("comix")
    assert isinstance(cx, ComixSource)
    assert cx.source_id == "comix"

    with pytest.raises(ValueError):
        get_source("non_existent_source")


def test_custom_source_registration():
    """Kiểm tra khả năng mở rộng (Open/Closed Principle) qua register_source."""
    class DummySource(BaseMangaSource):
        source_id = "dummy"
        source_name = "Dummy"
        base_url = "https://dummy.org"
        needs_browser_bypass = False

        async def search(self, query: str, page: int = 1):
            return []

        async def get_manga_details(self, manga_id_or_url: str):
            return MangaInfo(id="1", title="Dummy", url="https://dummy.org/1")

        async def get_chapter_pages(self, chapter_id_or_url: str):
            return []

    register_source(DummySource)
    assert "dummy" in list_sources()
    inst = get_source("dummy")
    assert isinstance(inst, DummySource)


@pytest.mark.asyncio
async def test_mangadex_search_parsing():
    """Kiểm tra parser kết quả tìm kiếm của MangaDex."""
    mock_response_data = {
        "data": [
            {
                "id": "e0b82eb6-788e-4a67-8e6b-a25e2e8e04e9",
                "attributes": {
                    "title": {"en": "Mock Manga Title"},
                    "description": {"en": "This is a mock description"},
                    "lastChapter": "100",
                    "tags": [
                        {
                            "attributes": {
                                "group": "genre",
                                "name": {"en": "Action"},
                            }
                        }
                    ],
                },
                "relationships": [
                    {
                        "type": "cover_art",
                        "attributes": {"fileName": "mock_cover.jpg"},
                    },
                    {
                        "type": "author",
                        "attributes": {"name": "Mock Author"},
                    },
                ],
            }
        ]
    }

    source = MangaDexSource()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_response_data

    with patch.object(source, "_request", AsyncMock(return_value=mock_resp)):
        results = await source.search("Mock")
        assert len(results) == 1
        item = results[0]
        assert item.id == "e0b82eb6-788e-4a67-8e6b-a25e2e8e04e9"
        assert item.title == "Mock Manga Title"
        assert "mock_cover.jpg" in item.cover_url
        assert "Mock Author" in item.authors
        assert "Action" in item.genres
        assert item.latest_chapter == "100"

    await source.close()


@pytest.mark.asyncio
async def test_mangadex_chapter_pages_athome():
    """Kiểm tra trích xuất link ảnh qua endpoint @home của MangaDex."""
    source = MangaDexSource()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "baseUrl": "https://cmdxd98sb0x3yprd.mangadex.network",
        "chapter": {
            "hash": "abc123hash",
            "data": ["page1.png", "page2.png"],
        },
    }

    with patch.object(source, "_request", AsyncMock(return_value=mock_resp)):
        pages = await source.get_chapter_pages("e0b82eb6-788e-4a67-8e6b-a25e2e8e04e9")
        assert len(pages) == 2
        assert pages[0] == "https://cmdxd98sb0x3yprd.mangadex.network/data/abc123hash/page1.png"
        assert pages[1] == "https://cmdxd98sb0x3yprd.mangadex.network/data/abc123hash/page2.png"

    await source.close()


@pytest.mark.asyncio
async def test_cuutruyen_details_and_pages():
    """Kiểm tra parser chi tiết truyện và danh sách ảnh của Cuutruyen."""
    source = CuutruyenSource()

    mock_manga_resp = MagicMock()
    mock_manga_resp.status_code = 200
    mock_manga_resp.json.return_value = {
        "data": {
            "id": 1106,
            "name": "One-Punch Man",
            "cover_url": "https://storage.example.com/cover.jpg",
            "full_description": "Mo ta chi tiet truyen",
            "author": {"name": "ONE"},
            "tags": [{"name": "Action"}, {"name": "Comedy"}],
        }
    }

    mock_chapters_resp = MagicMock()
    mock_chapters_resp.status_code = 200
    mock_chapters_resp.json.return_value = {
        "data": [
            {"id": 101, "number": "1", "name": "Chuong khoi dau"},
            {"id": 102, "number": "2", "name": "Chuong tiep theo"},
        ]
    }

    mock_pages_resp = MagicMock()
    mock_pages_resp.status_code = 200
    mock_pages_resp.json.return_value = {
        "data": {
            "pages": [
                {"order": 1, "image_url": "https://cdn.example.com/p2.jpg"},
                {"order": 0, "image_url": "https://cdn.example.com/p1.jpg"},
            ]
        }
    }

    async def mock_request_side_effect(method, endpoint, **kwargs):
        if "/chapters/" in endpoint:
            return mock_pages_resp
        elif "/chapters" in endpoint:
            return mock_chapters_resp
        else:
            return mock_manga_resp

    with patch.object(source, "_request", AsyncMock(side_effect=mock_request_side_effect)):
        info = await source.get_manga_details("1106")
        assert info.id == "1106"
        assert info.title == "One-Punch Man"
        assert info.authors == ["ONE"]
        assert info.genres == ["Action", "Comedy"]
        assert len(info.chapters) == 2
        assert info.chapters[0].chapter_number == "1"

        pages = await source.get_chapter_pages("101")
        assert len(pages) == 2
        assert pages[0] == "https://cdn.example.com/p1.jpg"
        assert pages[1] == "https://cdn.example.com/p2.jpg"

    await source.close()


def test_comix_extract_manga_code():
    """Kiểm tra trích xuất manga code từ URL hoặc string trên ComixSource."""
    assert ComixSource.extract_manga_code("https://comix.to/title/93q1r-the-summoner") == "93q1r"
    assert ComixSource.extract_manga_code("https://comix.to/title/z0l20") == "z0l20"
    assert ComixSource.extract_manga_code("z0l20-some-slug") == "z0l20"
    assert ComixSource.extract_manga_code("z0l20") == "z0l20"


@pytest.mark.asyncio
async def test_comix_search_and_details_parsing():
    """Kiểm tra parser tìm kiếm và chi tiết truyện của Comix.to."""
    source = ComixSource()

    mock_search_resp = MagicMock()
    mock_search_resp.status_code = 200
    mock_search_resp.json.return_value = {
        "status": "ok",
        "result": {
            "items": [
                {
                    "hid": "z0l20",
                    "title": "God-level Assassin",
                    "poster": {"large": "https://img.comix.to/poster.jpg"},
                    "latestChapter": "15",
                    "synopsis": "An epic assassin story",
                }
            ]
        },
    }

    detail_payload = {
        "queries": {
            "[\"manga\",\"detail\",{\"manga_code\":\"z0l20\"}]": {
                "id": 1234,
                "hid": "z0l20",
                "title": "God-level Assassin",
                "poster": {"large": "https://img.comix.to/poster.jpg"},
                "synopsis": "An epic assassin story",
                "genres": [{"title": "Action"}, {"title": "Fantasy"}],
                "authors": [{"name": "Author A"}],
            }
        }
    }

    mock_detail_html = f"""
    <html>
        <script id="initial-data">
        {{json_str}}
        </script>
        <body>
            <ul class="chapter-list">
                <li class="mchap-item">
                    <a class="mchap-row__primary" href="/title/god-level-assassin/5678-chapter-1"></a>
                    <span class="mchap-row__title">Prologue</span>
                    <span class="mchap-row__group"><span>ScanGroup</span></span>
                </li>
            </ul>
        </body>
    </html>
    """.replace("{json_str}", json.dumps(detail_payload))

    mock_detail_resp = MagicMock()
    mock_detail_resp.status_code = 200
    mock_detail_resp.text = mock_detail_html

    with patch.object(source, "_request", AsyncMock(return_value=mock_search_resp)):
        results = await source.search("Assassin")
        assert len(results) == 1
        item = results[0]
        assert item.id == "z0l20"
        assert item.title == "God-level Assassin"
        assert item.cover_url == "https://img.comix.to/poster.jpg"
        assert item.latest_chapter == "15"

    with patch.object(source, "_request", AsyncMock(return_value=mock_detail_resp)):
        info = await source.get_manga_details("z0l20")
        assert info.id == "z0l20"
        assert info.title == "God-level Assassin"
        assert info.authors == ["Author A"]
        assert info.genres == ["Action", "Fantasy"]
        assert len(info.chapters) == 1
        assert info.chapters[0].id == "5678"
        assert info.chapters[0].chapter_number == "1"
        assert info.chapters[0].scanlator == "ScanGroup"

    await source.close()


def test_browser_runner_challenge_detection():
    """Kiểm tra logic nhận diện Cloudflare / WAF challenge (cf_clearance và waf_pass)."""
    cookie_cf = MagicMock()
    cookie_cf.name = "cf_clearance"
    cookie_cf.value = "val"

    cookie_waf = MagicMock()
    cookie_waf.name = "waf_pass"
    cookie_waf.value = "waf_val"

    cookie_other = MagicMock()
    cookie_other.name = "_ga"
    cookie_other.value = "ga_val"

    # 1. Có cookie cf_clearance -> True
    assert CloudflareBypassRunner._is_challenge_resolved(
        [cookie_cf, cookie_other], "Just a moment...", "https://cuutruyen.net"
    )

    # 2. Có cookie waf_pass (Comix.to) -> True
    assert CloudflareBypassRunner._is_challenge_resolved(
        [cookie_waf, cookie_other], "Just a moment...", "https://comix.to/@waf/challenge"
    )

    # 3. Yêu cầu đúng required_cookie='waf_pass' -> True khi có, False khi không có
    assert CloudflareBypassRunner._is_challenge_resolved(
        [cookie_waf], "", "https://comix.to", required_cookie="waf_pass"
    )
    assert not CloudflareBypassRunner._is_challenge_resolved(
        [cookie_cf], "", "https://comix.to", required_cookie="waf_pass"
    )

    # 4. Không có cookie hợp lệ nhưng đang ở trang Just a moment... -> False
    assert not CloudflareBypassRunner._is_challenge_resolved(
        [cookie_other], "Just a moment...", "https://cuutruyen.net"
    )

    # 5. Tiêu đề bình thường, không ở challenge-platform -> True
    assert CloudflareBypassRunner._is_challenge_resolved(
        [cookie_other], "Cứu Truyện - Trang chủ", "https://cuutruyen.net/"
    )


@pytest.mark.asyncio
async def test_browser_runner_aclose_safe_termination():
    """
    Kiểm tra cơ chế đóng an toàn CDP connection của comix-downloader:
    Gọi await browser.aclose() với timeout 3s trước khi gọi browser.stop().
    """
    runner = CloudflareBypassRunner()
    mock_browser = MagicMock()
    mock_browser._process = None
    mock_browser.aclose = AsyncMock()
    mock_browser.stop = MagicMock()

    await runner._terminate_browser(mock_browser)

    mock_browser.aclose.assert_awaited_once()
    mock_browser.stop.assert_called_once()
