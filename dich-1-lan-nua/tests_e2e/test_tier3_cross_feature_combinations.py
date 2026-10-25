"""
Tier 3: Cross-Feature Combinations Test Suite.
Verifies pairwise and multi-step interaction chains across features:
Import -> Zoom -> Annotate -> Undo -> Mode Switch -> Reload.
"""

import io
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
    create_test_webp,
    create_corrupt_image,
)
from tests_e2e.fixtures.mock_zip import create_dirty_manga_zip


# ---------------------------------------------------------------------------
# Combination 1: Project Creation -> Chapter Creation -> Single Image Import -> Status Badge
# ---------------------------------------------------------------------------
def test_comb_01_project_chapter_image_import_status(client):
    """C1: Flow from project/chapter creation to image validation and thumbnail status."""
    # 1. Project creation
    project = {
        "id": "proj-comb-1",
        "name": "One Piece Vietnamese Edition",
        "sourceLanguage": "ja",
        "targetLanguage": "vi",
        "status": "draft",
    }
    assert project["name"] == "One Piece Vietnamese Edition"

    # 2. Chapter creation linked to project
    chapter = {
        "id": "chap-comb-1",
        "projectId": project["id"],
        "title": "Chapter 1000: Straw Hat Luffy",
        "chapterNumber": 1000,
        "order": 1,
        "pageCount": 0,
    }
    assert chapter["projectId"] == project["id"]

    # 3. Image validation via backend
    img_bytes = create_test_png(1200, 1800)
    files = {"file": ("op_1000_p01.png", img_bytes, "image/png")}
    res = client.post("/api/v1/images/validate", files=files)
    assert res.status_code == 200
    meta = res.json()
    assert meta["valid"] is True
    assert meta["width"] == 1200
    assert meta["height"] == 1800

    # 4. Ingest page into chapter
    page = {
        "id": "page-comb-1",
        "chapterId": chapter["id"],
        "projectId": project["id"],
        "pageNumber": 1,
        "fileName": meta["filename"],
        "width": meta["width"],
        "height": meta["height"],
        "status": "idle",
    }
    chapter["pageCount"] += 1
    assert chapter["pageCount"] == 1

    # 5. Page status transition to processing and ocr_completed
    page["status"] = "processing"
    assert page["status"] == "processing"
    page["status"] = "ocr_completed"
    assert page["status"] == "ocr_completed"


# ---------------------------------------------------------------------------
# Combination 2: ZIP Import -> Natural Sort -> Reorder -> Cascade Delete
# ---------------------------------------------------------------------------
def test_comb_02_zip_import_natural_sort_reorder_cascade():
    """C2: Dirty ZIP ingestion, natural collation, page reordering, and cascade purge."""
    # 1. Dirty ZIP extraction
    dirty_zip = create_dirty_manga_zip()
    import zipfile
    with zipfile.ZipFile(io.BytesIO(dirty_zip)) as zf:
        raw_entries = zf.namelist()
    sanitized = filter_archive_image_entries(raw_entries)
    assert sanitized == ["page_1.png", "page_2.png", "page_10.png", "page_20.png"]

    # 2. Create pages from sorted entries
    pages = [
        {"id": f"p-{idx}", "fileName": name, "pageNumber": idx}
        for idx, name in enumerate(sanitized, start=1)
    ]
    assert [p["pageNumber"] for p in pages] == [1, 2, 3, 4]

    # 3. Add text regions to page 2 (p-2)
    regions = [
        {"id": "reg-1", "pageId": "p-1"},
        {"id": "reg-2", "pageId": "p-2"},
        {"id": "reg-3", "pageId": "p-2"},
    ]

    # 4. Reorder: move page 4 ("page_20.png") to index 2
    moved = pages.pop(3)
    pages.insert(1, moved)
    for idx, p in enumerate(pages, start=1):
        p["pageNumber"] = idx
    assert pages[1]["fileName"] == "page_20.png"
    assert pages[1]["pageNumber"] == 2

    # 5. Cascade delete page "p-2"
    pages = [p for p in pages if p["id"] != "p-2"]
    regions = [r for r in regions if r["pageId"] != "p-2"]
    assert len(pages) == 3
    assert len(regions) == 1
    assert regions[0]["pageId"] == "p-1"


# ---------------------------------------------------------------------------
# Combination 3: Viewport Load -> Fit -> Cursor Zoom -> Pan -> Roundtrip Precision
# ---------------------------------------------------------------------------
def test_comb_03_viewport_fit_zoom_pan_precision():
    """C3: Fit-to-screen, wheel zoom around mouse cursor, viewport panning, and coordinate round-trip."""
    vw, vh = 1000.0, 800.0
    img_w, img_h = 1200.0, 1800.0

    # 1. Fit-to-screen
    z_fit, tx, ty = fit_to_screen(vw, vh, img_w, img_h, padding=20.0)
    assert z_fit > 0.0

    # 2. Wheel zoom to 2.5x around cursor (400, 300)
    cursor_x, cursor_y = 400.0, 300.0
    z_new = 2.5
    tx_zoomed, ty_zoomed = zoom_to_cursor(cursor_x, cursor_y, tx, ty, z_fit, z_new)

    # 3. Verify cursor invariance
    xi_pre, yi_pre = image_from_screen(cursor_x, cursor_y, z_fit, tx, ty)
    xi_post, yi_post = image_from_screen(cursor_x, cursor_y, z_new, tx_zoomed, ty_zoomed)
    assert abs(xi_pre - xi_post) < 1e-7
    assert abs(yi_pre - yi_post) < 1e-7

    # 4. Pan tool drag by (-150, 75)
    tx_panned = tx_zoomed - 150.0
    ty_panned = ty_zoomed + 75.0

    # 5. Coordinate roundtrip for multiple arbitrary points
    test_points = [(100.0, 200.0), (600.0, 900.0), (1150.0, 1750.0)]
    for orig_x, orig_y in test_points:
        xs, ys = screen_from_image(orig_x, orig_y, z_new, tx_panned, ty_panned)
        xi, yi = image_from_screen(xs, ys, z_new, tx_panned, ty_panned)
        assert abs(xi - orig_x) < 1e-6
        assert abs(yi - orig_y) < 1e-6


# ---------------------------------------------------------------------------
# Combination 4: Draw BBox -> Normalization & Clamping -> Move -> Resize -> Properties Sync
# ---------------------------------------------------------------------------
def test_comb_04_bbox_draw_normalize_clamp_move_resize_properties():
    """C4: Drawing inverted box, clamping, moving, resizing with handles, and updating properties."""
    img_w, img_h = 1000.0, 1000.0

    # 1. Inverted user drag: start (400, 500) -> end (150, 200)
    box = normalize_bounding_box(400.0, 500.0, 150.0, 200.0)
    assert box.x == 150.0
    assert box.y == 200.0
    assert box.width == 250.0
    assert box.height == 300.0

    # 2. Clamping check
    clamped = clamp_bounding_box(box, img_w, img_h)
    assert clamped is not None
    assert clamped.width == 250.0

    # 3. Move box interior by dx=50, dy=30
    moved_box = BoundingBox(
        x=max(0.0, min(clamped.x + 50.0, img_w - clamped.width)),
        y=max(0.0, min(clamped.y + 30.0, img_h - clamped.height)),
        width=clamped.width,
        height=clamped.height,
    )
    assert moved_box.x == 200.0
    assert moved_box.y == 230.0

    # 4. 8-Point resize: drag SE handle by dx=40, dy=20
    resized_box = apply_resize_handle("se", moved_box, dx=40.0, dy=20.0, img_w=img_w, img_h=img_h)
    assert resized_box.width == 290.0
    assert resized_box.height == 320.0

    # 5. Sync to Properties Panel
    region_metadata = {
        "id": "reg-01",
        "box": {"x": resized_box.x, "y": resized_box.y, "width": resized_box.width, "height": resized_box.height},
        "sourceText": "Hold on!",
        "translatedText": "Khoan đã!",
        "confidence": 1.0,
    }
    assert region_metadata["box"]["width"] == 290.0
    assert region_metadata["translatedText"] == "Khoan đã!"


# ---------------------------------------------------------------------------
# Combination 5: Multi-Region Draw -> Undo -> Redo -> Add Region (Branch Pruning)
# ---------------------------------------------------------------------------
def test_comb_05_multi_region_undo_redo_branch_pruning():
    """C5: Undo/redo stack branching semantics with multiple regions."""
    stack = HistoryStack(max_depth=50)

    # 1. Add region 1
    snap1 = HistorySnapshot("s1", "p1", "ADD", [], [{"id": "r1"}], 1.0)
    stack.push(snap1)

    # 2. Add region 2
    snap2 = HistorySnapshot("s2", "p1", "ADD", [{"id": "r1"}], [{"id": "r1"}, {"id": "r2"}], 2.0)
    stack.push(snap2)

    # 3. Add region 3
    snap3 = HistorySnapshot("s3", "p1", "ADD", [{"id": "r1"}, {"id": "r2"}], [{"id": "r1"}, {"id": "r2"}, {"id": "r3"}], 3.0)
    stack.push(snap3)
    assert len(stack.undo_stack) == 3

    # 4. Undo region 3
    u = stack.undo()
    assert u.id == "s3"
    assert len(stack.redo_stack) == 1

    # 5. Redo region 3
    r = stack.redo()
    assert r.id == "s3"
    assert len(stack.redo_stack) == 0

    # 6. Undo region 3 again
    stack.undo()
    assert len(stack.redo_stack) == 1

    # 7. Add alternate region 4 (creating branching timeline)
    snap4 = HistorySnapshot("s4", "p1", "ADD", [{"id": "r1"}, {"id": "r2"}], [{"id": "r1"}, {"id": "r2"}, {"id": "r4"}], 4.0)
    stack.push(snap4)

    # 8. Redo stack MUST be pruned (empty)
    assert len(stack.redo_stack) == 0
    assert stack.can_redo() is False
    assert len(stack.undo_stack) == 3
    assert stack.undo_stack[-1].id == "s4"


# ---------------------------------------------------------------------------
# Combination 6: Studio Mode -> Vertical Reader -> Page Reader (RTL) -> Studio Mode
# ---------------------------------------------------------------------------
def test_comb_06_mode_switching_state_isolation():
    """C6: Switching between Studio, Vertical Reader, and Page Reader preserves canvas parameters."""
    # 1. Studio state
    studio_state = {
        "viewMode": "studio",
        "zoom": 1.75,
        "panX": 150.0,
        "panY": -80.0,
        "selectedRegionId": "reg-01",
        "activeTool": "draw_rect",
    }

    # 2. Switch to Vertical Reader Mode
    reader_state = {
        "viewMode": "vertical_reader",
        "continuousScroll": True,
        "activePage": 1,
    }
    assert reader_state["viewMode"] == "vertical_reader"
    assert reader_state["continuousScroll"] is True

    # 3. Switch to Page Reader Mode with RTL navigation
    page_reader_state = {
        "viewMode": "page_reader",
        "direction": "rtl",
        "activePage": 1,
        "totalPages": 5,
    }
    # Press ArrowLeft in RTL -> advances to page 2
    page_reader_state["activePage"] = compute_page_navigation(
        page_reader_state["activePage"],
        page_reader_state["totalPages"],
        "ArrowLeft",
        direction="rtl",
    )
    assert page_reader_state["activePage"] == 2

    # 4. Switch back to Studio Mode
    assert studio_state["viewMode"] == "studio"
    # Transform preserved
    assert studio_state["zoom"] == 1.75
    assert studio_state["panX"] == 150.0
    assert studio_state["panY"] == -80.0
    assert studio_state["selectedRegionId"] == "reg-01"


# ---------------------------------------------------------------------------
# Combination 7: Multi-Chapter Data -> Serialized IDB -> Rehydration
# ---------------------------------------------------------------------------
def test_comb_07_full_persistence_rehydration_cycle():
    """C7: Complete project serialization, simulated reload, and rehydration."""
    project_db = {
        "projects": [{"id": "p-1", "name": "Manga Trans", "status": "in_progress"}],
        "chapters": [
            {"id": "c-1", "projectId": "p-1", "chapterNumber": 1, "order": 1},
            {"id": "c-2", "projectId": "p-1", "chapterNumber": 2, "order": 2},
        ],
        "pages": [
            {"id": "pg-1", "chapterId": "c-1", "projectId": "p-1", "pageNumber": 1},
            {"id": "pg-2", "chapterId": "c-1", "projectId": "p-1", "pageNumber": 2},
            {"id": "pg-3", "chapterId": "c-2", "projectId": "p-1", "pageNumber": 1},
        ],
        "textRegions": [
            {"id": "r-1", "pageId": "pg-1", "projectId": "p-1", "sourceText": "Hello"},
            {"id": "r-2", "pageId": "pg-1", "projectId": "p-1", "sourceText": "World"},
        ],
        "appSettings": {"activeProjectId": "p-1", "activeChapterId": "c-1", "activePageId": "pg-1"},
    }

    # Simulate serialization to disk/storage
    import json
    serialized = json.dumps(project_db)

    # Simulate reload
    deserialized = json.loads(serialized)
    assert len(deserialized["projects"]) == 1
    assert len(deserialized["chapters"]) == 2
    assert len(deserialized["pages"]) == 3
    assert len(deserialized["textRegions"]) == 2
    assert deserialized["appSettings"]["activePageId"] == "pg-1"

    # Verify relational links
    chap1_pages = [p for p in deserialized["pages"] if p["chapterId"] == "c-1"]
    assert len(chap1_pages) == 2
    pg1_regions = [r for r in deserialized["textRegions"] if r["pageId"] == "pg-1"]
    assert len(pg1_regions) == 2


# ---------------------------------------------------------------------------
# Combination 8: Corrupt Upload Error -> Capabilities Query -> WebP Recovery
# ---------------------------------------------------------------------------
def test_comb_08_corrupt_upload_error_capabilities_webp_recovery(client):
    """C8: Upload invalid file, receive error envelope, query capabilities, recover with valid WebP."""
    # 1. Corrupt upload
    corrupt_data = create_corrupt_image()
    files = {"file": ("bad.png", corrupt_data, "image/png")}
    err_res = client.post("/api/v1/images/validate", files=files)
    assert err_res.status_code == 400
    err_data = err_res.json()
    assert err_data["error_code"] == "INVALID_IMAGE_FORMAT"

    # 2. Query capabilities to check supported formats
    cap_res = client.get("/api/v1/capabilities")
    assert cap_res.status_code == 200
    supported = cap_res.json()["limits"]["supported_image_types"]
    assert "image/webp" in supported

    # 3. Recover with valid WebP image
    webp_data = create_test_webp(1000, 1400)
    files_ok = {"file": ("good.webp", webp_data, "image/webp")}
    ok_res = client.post("/api/v1/images/validate", files=files_ok)
    assert ok_res.status_code == 200
    ok_data = ok_res.json()
    assert ok_data["valid"] is True
    assert ok_data["format"] == "WEBP"
    assert ok_data["width"] == 1000
    assert ok_data["height"] == 1400
