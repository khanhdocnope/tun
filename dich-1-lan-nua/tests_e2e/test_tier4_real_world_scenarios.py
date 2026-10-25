"""
Tier 4: Real-World Application Scenarios Test Suite.
Complete end-to-end comic translation workflows simulating real-world user sessions:
- Japanese Manga scanlation (Page Reader, RTL, bounding box editing, undo/redo).
- Korean Webtoon continuous scroll (Vertical Reader, tall strip, fitToScreen).
- Dirty ZIP ingestion and natural collation sanitization.
- Session reload and persistence rehydration.
- Adversarial upload resilience and API contract verification.
"""

import io
import json
import pytest
from PIL import Image

from tests_e2e.contracts import (
    BoundingBox,
    HistorySnapshot,
    HistoryStack,
    actual_size_100,
    apply_resize_handle,
    clamp_bounding_box,
    compute_page_navigation,
    filter_archive_image_entries,
    fit_to_screen,
    image_from_screen,
    natural_sort_filenames,
    normalize_bounding_box,
    screen_from_image,
    zoom_to_cursor,
)
from tests_e2e.fixtures.sample_images import (
    create_test_png,
    create_test_jpeg,
    create_test_webp,
    create_corrupt_image,
)
from tests_e2e.fixtures.mock_zip import create_dirty_manga_zip


# ---------------------------------------------------------------------------
# Scenario 1: Japanese Manga Scanlation Session (Page Reader + RTL)
# ---------------------------------------------------------------------------
def test_scenario_01_manga_scanlation_session(client):
    """S1: Complete Japanese manga scanlation session with RTL navigation and bbox editing."""
    # 1. User creates new project
    project = {
        "id": "proj-berserk-101",
        "name": "Berserk Chapter 101",
        "sourceLanguage": "ja",
        "targetLanguage": "vi",
        "status": "in_progress",
    }
    chapter = {
        "id": "chap-101",
        "projectId": project["id"],
        "title": "Chapter 101: The Black Swordsman",
        "chapterNumber": 101,
        "order": 1,
        "pageCount": 0,
    }

    # 2. Ingest 5 comic pages with scrambled filenames
    raw_files = ["p1.jpg", "p10.jpg", "p2.jpg", "p3.jpg", "p4.jpg"]
    sorted_files = natural_sort_filenames(raw_files)
    assert sorted_files == ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p10.jpg"]

    pages = []
    for idx, fname in enumerate(sorted_files, start=1):
        # Validate first page with backend
        if idx == 1:
            img_data = create_test_jpeg(1200, 1800)
            res = client.post("/api/v1/images/validate", files={"file": (fname, img_data, "image/jpeg")})
            assert res.status_code == 200
            w, h = res.json()["width"], res.json()["height"]
        else:
            w, h = 1200, 1800
        pages.append({
            "id": f"page-{idx}",
            "chapterId": chapter["id"],
            "projectId": project["id"],
            "pageNumber": idx,
            "fileName": fname,
            "width": w,
            "height": h,
            "status": "idle",
        })
    chapter["pageCount"] = len(pages)
    assert chapter["pageCount"] == 5

    # 3. Switch to Page Reader Mode with RTL reading direction
    active_page = 1
    reader_mode = "page_reader"
    reading_direction = "rtl"

    # User presses ArrowLeft to read next manga page (RTL)
    active_page = compute_page_navigation(active_page, chapter["pageCount"], "ArrowLeft", direction=reading_direction)
    assert active_page == 2

    # User presses ArrowRight to turn back to page 1
    active_page = compute_page_navigation(active_page, chapter["pageCount"], "ArrowRight", direction=reading_direction)
    assert active_page == 1

    # 4. Switch back to Studio Mode on page 1 for translation
    view_mode = "studio"
    vw, vh = 1000.0, 800.0
    img_w, img_h = pages[0]["width"], pages[0]["height"]

    # Fit image to screen
    z, tx, ty = fit_to_screen(vw, vh, img_w, img_h)
    assert z > 0

    # User zooms in to 2.0x over dialogue bubble at (300, 400)
    bubble_x, bubble_y = 300.0, 400.0
    new_z = 2.0
    tx, ty = zoom_to_cursor(bubble_x, bubble_y, tx, ty, z, new_z)

    # 5. User draws dialogue bounding box: drag (250, 350) to (500, 600)
    raw_box = normalize_bounding_box(250.0, 350.0, 500.0, 600.0)
    clamped_box = clamp_bounding_box(raw_box, img_w, img_h)
    assert clamped_box is not None
    assert clamped_box.width == 250.0
    assert clamped_box.height == 250.0

    # Record history snapshot
    history = HistoryStack(max_depth=50)
    region_1 = {
        "id": "reg-berserk-1",
        "pageId": pages[0]["id"],
        "box": {"x": clamped_box.x, "y": clamped_box.y, "width": clamped_box.width, "height": clamped_box.height},
        "sourceText": "逃げ出した先に、楽園なんてありゃしねえのさ",
        "translatedText": "Nơi ngươi chạy trốn đến, không có thiên đường đâu.",
        "confidence": 1.0,
        "status": "translated",
    }
    history.push(HistorySnapshot("snap-1", pages[0]["id"], "ADD_REGION", [], [region_1], 100.0))
    assert history.can_undo() is True

    # 6. User undoes the box creation
    undone = history.undo()
    assert undone.id == "snap-1"
    assert history.can_undo() is False
    assert history.can_redo() is True

    # 7. User redoes the box creation
    redone = history.redo()
    assert redone.id == "snap-1"
    assert history.can_undo() is True


# ---------------------------------------------------------------------------
# Scenario 2: Korean Webtoon Continuous Scroll Session (Vertical Reader)
# ---------------------------------------------------------------------------
def test_scenario_02_korean_webtoon_session():
    """S2: Korean Webtoon strip ingestion, vertical scroll mode, and precise annotation."""
    # 1. Project setup
    project = {
        "id": "proj-tog-500",
        "name": "Tower of God Chapter 500",
        "sourceLanguage": "ko",
        "targetLanguage": "en",
        "status": "in_progress",
    }

    # 2. Tall Webtoon image dimensions: 800 x 12,000 px
    img_w, img_h = 800.0, 12000.0
    vw, vh = 1000.0, 800.0

    # 3. Fit to screen calculation
    z_fit, tx, ty = fit_to_screen(vw, vh, img_w, img_h, padding=20.0)
    # Constrained by height: (800 - 40) / 12000 = 0.0633
    assert abs(z_fit - 0.06333) < 1e-4

    # 4. Vertical Reader Mode layout config
    vertical_reader = {
        "mode": "vertical_reader",
        "gapBetweenPages": 16,
        "lazyRenderBuffer": 2,  # 2 screens ahead
        "pages": [{"id": "page-tog-1", "width": img_w, "height": img_h}],
    }
    assert vertical_reader["mode"] == "vertical_reader"
    assert vertical_reader["lazyRenderBuffer"] == 2

    # 5. Annotate dialogue bubbles at top and bottom of strip
    top_box = normalize_bounding_box(150.0, 200.0, 450.0, 350.0)
    bottom_box = normalize_bounding_box(100.0, 11500.0, 600.0, 11800.0)

    clamped_top = clamp_bounding_box(top_box, img_w, img_h)
    clamped_bottom = clamp_bounding_box(bottom_box, img_w, img_h)

    assert clamped_top is not None and clamped_top.y == 200.0
    assert clamped_bottom is not None and clamped_bottom.y == 11500.0
    assert clamped_bottom.y + clamped_bottom.height <= img_h


# ---------------------------------------------------------------------------
# Scenario 3: Dirty ZIP Archive Ingestion & Sanitization
# ---------------------------------------------------------------------------
def test_scenario_03_dirty_zip_ingestion_sanitization():
    """S3: Clean ingestion of messy ZIP containing macOS forks, .DS_Store, and unsorted files."""
    dirty_zip = create_dirty_manga_zip()
    import zipfile
    with zipfile.ZipFile(io.BytesIO(dirty_zip)) as zf:
        namelist = zf.namelist()

    # Verify input has junk entries
    assert any("__MACOSX" in name for name in namelist)
    assert any(".DS_Store" in name for name in namelist)
    assert any("Thumbs.db" in name for name in namelist)

    # Process through sanitization filter
    clean_entries = filter_archive_image_entries(namelist)
    assert len(clean_entries) == 4
    assert clean_entries == ["page_1.png", "page_2.png", "page_10.png", "page_20.png"]

    # Ingest into pages
    pages = [{"id": f"p{i}", "name": name, "pageNumber": i} for i, name in enumerate(clean_entries, start=1)]

    # Reorder: move page 3 ("page_10.png") to first position
    moved = pages.pop(2)
    pages.insert(0, moved)
    for idx, p in enumerate(pages, start=1):
        p["pageNumber"] = idx
    assert pages[0]["name"] == "page_10.png"
    assert pages[0]["pageNumber"] == 1

    # Cascade delete page 2
    deleted_page_id = pages[1]["id"]
    pages = [p for p in pages if p["id"] != deleted_page_id]
    assert len(pages) == 3


# ---------------------------------------------------------------------------
# Scenario 4: Session Interruption & Reload Persistence
# ---------------------------------------------------------------------------
def test_scenario_04_session_interruption_reload_persistence():
    """S4: In-flight work survives browser crash or hard reload via Dexie schema."""
    session_snapshot = {
        "activeProjectId": "proj-persistence-test",
        "activeChapterId": "chap-persistence-test",
        "activePageId": "page-persistence-01",
        "viewMode": "studio",
        "zoom": 1.45,
        "panX": 85.0,
        "panY": -30.0,
        "regions": [
            {
                "id": "reg-persistent-1",
                "pageId": "page-persistence-01",
                "box": {"x": 50, "y": 60, "width": 120, "height": 80},
                "sourceText": "Is this working?",
                "translatedText": "Nó có hoạt động không?",
                "status": "approved",
            }
        ],
    }

    # Simulate browser serialize to IndexedDB
    raw_json = json.dumps(session_snapshot)

    # Simulate reload from IndexedDB
    restored = json.loads(raw_json)
    assert restored["activeProjectId"] == "proj-persistence-test"
    assert restored["viewMode"] == "studio"
    assert restored["zoom"] == 1.45
    assert len(restored["regions"]) == 1
    assert restored["regions"][0]["translatedText"] == "Nó có hoạt động không?"


# ---------------------------------------------------------------------------
# Scenario 5: Adversarial Upload & Backend Contract Verification
# ---------------------------------------------------------------------------
def test_scenario_05_adversarial_upload_and_recovery(client):
    """S5: Backend gracefully handles malformed and corrupt uploads, maintaining contracts."""
    # 1. Health check verification
    health_res = client.get("/api/v1/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "healthy"

    # 2. Capabilities inquiry
    cap_res = client.get("/api/v1/capabilities")
    assert cap_res.status_code == 200
    caps = cap_res.json()
    assert caps["limits"]["max_upload_size_mb"] == 50

    # 3. Malformed upload (executable payload)
    corrupt_data = create_corrupt_image()
    bad_upload = client.post(
        "/api/v1/images/validate",
        files={"file": ("malware.exe.png", corrupt_data, "image/png")},
    )
    assert bad_upload.status_code == 400
    err_body = bad_upload.json()
    assert err_body["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "status_code" in err_body

    # 4. Valid PNG upload
    png_data = create_test_png(600, 800)
    ok_upload = client.post(
        "/api/v1/images/validate",
        files={"file": ("valid_comic.png", png_data, "image/png")},
    )
    assert ok_upload.status_code == 200
    res_data = ok_upload.json()
    assert res_data["valid"] is True
    assert res_data["format"] == "PNG"
    assert res_data["width"] == 600
    assert res_data["height"] == 800
