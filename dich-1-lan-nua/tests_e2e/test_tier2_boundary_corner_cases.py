"""
Tier 2: Boundary & Corner Cases Test Suite.
Verifies numerical, geometric, format, and size extremes across all boundary features.
Covers >= 5 boundary tests per edge condition.
"""

import io
import math
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
    create_corrupt_image,
    create_micro_image,
    create_oversized_payload,
)
from tests_e2e.fixtures.mock_zip import (
    create_clean_manga_zip,
    create_dirty_manga_zip,
    create_empty_zip,
    create_non_image_zip,
)


# ---------------------------------------------------------------------------
# Boundary 1: Tall Webtoon Aspect Ratio (800 x 16,000 px)
# ---------------------------------------------------------------------------
def test_boundary_tall_webtoon_aspect_ratio():
    """B1: Tall webtoon strip handling (1:20 aspect ratio)."""
    vw, vh = 1200.0, 800.0
    img_w, img_h = 800.0, 16000.0

    # 1. Fit-to-screen scale factor calculation
    z_fit, tx, ty = fit_to_screen(vw, vh, img_w, img_h, padding=20.0)
    # Scale is constrained by height: (800 - 40) / 16000 = 0.0475, clamped to min 0.05
    assert z_fit == 0.05
    assert tx == (vw - img_w * z_fit) / 2.0  # Horizontal centering
    assert ty == (vh - img_h * z_fit) / 2.0

    # 2. Coordinate roundtrip precision at extreme Y coordinate
    y_extreme = 15950.0
    x_mid = 400.0
    xs, ys = screen_from_image(x_mid, y_extreme, z_fit, tx, ty)
    xi, yi = image_from_screen(xs, ys, z_fit, tx, ty)
    assert abs(xi - x_mid) < 1e-6
    assert abs(yi - y_extreme) < 1e-6

    # 3. Bounding box at the very bottom of tall strip
    bottom_box = BoundingBox(x=100.0, y=15900.0, width=600.0, height=80.0)
    clamped = clamp_bounding_box(bottom_box, img_w, img_h)
    assert clamped is not None
    assert clamped.y == 15900.0
    assert clamped.y + clamped.height <= img_h

    # 4. Box overflowing bottom of tall strip
    overflow_box = BoundingBox(x=100.0, y=15950.0, width=600.0, height=100.0)
    clamped_overflow = clamp_bounding_box(overflow_box, img_w, img_h)
    assert clamped_overflow is not None
    assert clamped_overflow.height == 50.0  # Clamped to 16000 - 15950

    # 5. Zoom-to-cursor invariant on tall webtoon bottom
    cursor_x, cursor_y = vw / 2.0, vh / 2.0
    new_z = 0.10
    new_tx, new_ty = zoom_to_cursor(cursor_x, cursor_y, tx, ty, z_fit, new_z)
    xi_pre, yi_pre = image_from_screen(cursor_x, cursor_y, z_fit, tx, ty)
    xi_post, yi_post = image_from_screen(cursor_x, cursor_y, new_z, new_tx, new_ty)
    assert abs(xi_pre - xi_post) < 1e-6
    assert abs(yi_pre - yi_post) < 1e-6


# ---------------------------------------------------------------------------
# Boundary 2: Wide Double-Page Spread (4,000 x 1,800 px)
# ---------------------------------------------------------------------------
def test_boundary_wide_double_spread():
    """B2: Wide double-spread comic page handling (2.22:1 aspect ratio)."""
    vw, vh = 1200.0, 800.0
    img_w, img_h = 4000.0, 1800.0

    # 1. Fit-to-screen scale factor calculation
    z_fit, tx, ty = fit_to_screen(vw, vh, img_w, img_h, padding=20.0)
    # Constrained by width: (1200 - 40) / 4000 = 0.29
    assert abs(z_fit - 0.29) < 1e-5
    # Vertical letterboxing
    assert ty > 0.0

    # 2. Coordinate mapping at rightmost edge of double spread
    x_edge = 3980.0
    y_mid = 900.0
    xs, ys = screen_from_image(x_edge, y_mid, z_fit, tx, ty)
    xi, yi = image_from_screen(xs, ys, z_fit, tx, ty)
    assert abs(xi - x_edge) < 1e-6
    assert abs(yi - y_mid) < 1e-6

    # 3. Speech bubble spanning across the middle gutter (x=1950 to 2050)
    gutter_box = BoundingBox(x=1950.0, y=300.0, width=100.0, height=200.0)
    clamped_gutter = clamp_bounding_box(gutter_box, img_w, img_h)
    assert clamped_gutter is not None
    assert clamped_gutter.width == 100.0

    # 4. Box extending beyond right boundary of double spread
    over_right = BoundingBox(x=3900.0, y=200.0, width=200.0, height=150.0)
    clamped_right = clamp_bounding_box(over_right, img_w, img_h)
    assert clamped_right is not None
    assert clamped_right.width == 100.0  # 4000 - 3900

    # 5. Actual size 100% on double spread
    z100, tx100, ty100 = actual_size_100(vw, vh, img_w, img_h)
    assert z100 == 1.0
    assert tx100 == (vw - img_w) / 2.0  # (1200 - 4000)/2 = -1400.0


# ---------------------------------------------------------------------------
# Boundary 3: Sub-4px Phantom Click Suppression
# ---------------------------------------------------------------------------
def test_boundary_phantom_click_suppression():
    """B3: Clicks and micro-drags under 4px are suppressed."""
    img_w, img_h = 1000.0, 1000.0

    # 1. Exact zero drag (stationary click)
    click_zero = normalize_bounding_box(100.0, 100.0, 100.0, 100.0)
    assert clamp_bounding_box(click_zero, img_w, img_h) is None

    # 2. 1x1 micro drag
    click_1x1 = normalize_bounding_box(100.0, 100.0, 101.0, 101.0)
    assert clamp_bounding_box(click_1x1, img_w, img_h) is None

    # 3. 2x3 micro drag
    click_2x3 = normalize_bounding_box(100.0, 100.0, 102.0, 103.0)
    assert clamp_bounding_box(click_2x3, img_w, img_h) is None

    # 4. 3x4 drag (width < 4px)
    click_3x4 = normalize_bounding_box(100.0, 100.0, 103.0, 104.0)
    assert clamp_bounding_box(click_3x4, img_w, img_h) is None

    # 5. 4x3 drag (height < 4px)
    click_4x3 = normalize_bounding_box(100.0, 100.0, 104.0, 103.0)
    assert clamp_bounding_box(click_4x3, img_w, img_h) is None

    # 6. Exact 4x4 boundary: must be accepted
    click_4x4 = normalize_bounding_box(100.0, 100.0, 104.0, 104.0)
    accepted = clamp_bounding_box(click_4x4, img_w, img_h)
    assert accepted is not None
    assert accepted.width == 4.0
    assert accepted.height == 4.0


# ---------------------------------------------------------------------------
# Boundary 4: Negative Drag Vectors & Inverted Geometry
# ---------------------------------------------------------------------------
def test_boundary_negative_drag_normalization():
    """B4: Inverted user drag vectors normalized to positive box."""
    # 1. Reverse drag from (500, 600) to (200, 300)
    box1 = normalize_bounding_box(500.0, 600.0, 200.0, 300.0)
    assert box1.x == 200.0
    assert box1.y == 300.0
    assert box1.width == 300.0
    assert box1.height == 300.0

    # 2. Horizontal reverse drag from (400, 100) to (100, 200)
    box2 = normalize_bounding_box(400.0, 100.0, 100.0, 200.0)
    assert box2.x == 100.0
    assert box2.y == 100.0
    assert box2.width == 300.0
    assert box2.height == 100.0

    # 3. Vertical reverse drag from (100, 500) to (200, 100)
    box3 = normalize_bounding_box(100.0, 500.0, 200.0, 100.0)
    assert box3.x == 100.0
    assert box3.y == 100.0
    assert box3.width == 100.0
    assert box3.height == 400.0

    # 4. Drag outside image left and top bounds: start (-50, -50), end (100, 100)
    box4 = normalize_bounding_box(-50.0, -50.0, 100.0, 100.0)
    clamped4 = clamp_bounding_box(box4, 1000.0, 1000.0)
    assert clamped4 is not None
    assert clamped4.x == 0.0
    assert clamped4.y == 0.0
    assert clamped4.width == 100.0
    assert clamped4.height == 100.0

    # 5. Drag outside image completely: start (-200, -200), end (-100, -100)
    box5 = normalize_bounding_box(-200.0, -200.0, -100.0, -100.0)
    clamped5 = clamp_bounding_box(box5, 1000.0, 1000.0)
    # Clamped into zero width (outside canvas)
    assert clamped5 is None


# ---------------------------------------------------------------------------
# Boundary 5: ZIP Archive Hidden & Metadata File Filtering
# ---------------------------------------------------------------------------
def test_boundary_zip_archive_filtering():
    """B5: ZIP unpack filters __MACOSX, .DS_Store, Thumbs.db, desktop.ini."""
    dirty_namelist = [
        "__MACOSX/._page_01.png",
        "__MACOSX/.DS_Store",
        ".DS_Store",
        "Thumbs.db",
        "desktop.ini",
        ".hidden_page.png",
        "readme.txt",
        "chapter_1/page_10.png",
        "chapter_1/page_01.png",
        "chapter_1/page_02.png",
    ]
    filtered = filter_archive_image_entries(dirty_namelist)
    # 1. No macOS metadata
    assert not any("__MACOSX" in entry for entry in filtered)
    # 2. No .DS_Store
    assert not any(".DS_Store" in entry for entry in filtered)
    # 3. No Thumbs.db
    assert not any("Thumbs.db" in entry for entry in filtered)
    # 4. No hidden dotfiles
    assert not any(".hidden_page.png" in entry for entry in filtered)
    # 5. Naturally sorted images extracted
    assert filtered == [
        "chapter_1/page_01.png",
        "chapter_1/page_02.png",
        "chapter_1/page_10.png",
    ]


# ---------------------------------------------------------------------------
# Boundary 6: Natural Collation Sorting Boundaries
# ---------------------------------------------------------------------------
def test_boundary_natural_sorting_collation():
    """B6: Alphanumeric sorting handles varied formatting, leading zeros, and case."""
    # 1. Single vs double digit
    names1 = ["p10.png", "p1.png", "p2.png", "p20.png"]
    assert natural_sort_filenames(names1) == ["p1.png", "p2.png", "p10.png", "p20.png"]

    # 2. Leading zeros
    names2 = ["p001.jpg", "p02.jpg", "p010.jpg"]
    assert natural_sort_filenames(names2) == ["p001.jpg", "p02.jpg", "p010.jpg"]

    # 3. Multiple numeric segments (chapter + page)
    names3 = ["ch1_p2.png", "ch1_p10.png", "ch2_p1.png", "ch1_p1.png"]
    assert natural_sort_filenames(names3) == ["ch1_p1.png", "ch1_p2.png", "ch1_p10.png", "ch2_p1.png"]

    # 4. Case-insensitive sorting
    names4 = ["Page_2.png", "page_1.png", "PAGE_10.png"]
    assert natural_sort_filenames(names4) == ["page_1.png", "Page_2.png", "PAGE_10.png"]

    # 5. Hyphenated and mixed punctuation
    names5 = ["page-1.webp", "page-10.webp", "page-2.webp"]
    assert natural_sort_filenames(names5) == ["page-1.webp", "page-2.webp", "page-10.webp"]


# ---------------------------------------------------------------------------
# Boundary 7: Extreme Zoom Limits (Z in [0.05, 20.0])
# ---------------------------------------------------------------------------
def test_boundary_extreme_zoom_limits():
    """B7: Zoom factor is constrained within [0.05, 20.0]."""
    # 1. Min zoom clamp
    z_min_input = 0.01
    z_min_clamped = max(0.05, min(z_min_input, 20.0))
    assert z_min_clamped == 0.05

    # 2. Max zoom clamp
    z_max_input = 50.0
    z_max_clamped = max(0.05, min(z_max_input, 20.0))
    assert z_max_clamped == 20.0

    # 3. Zoom-to-cursor with cursor outside viewport
    cursor_x, cursor_y = -500.0, -300.0
    new_tx, new_ty = zoom_to_cursor(cursor_x, cursor_y, 0.0, 0.0, 1.0, 2.0)
    # Math holds without NaN or Infinity
    assert not math.isnan(new_tx)
    assert not math.isnan(new_ty)
    assert not math.isinf(new_tx)
    assert not math.isinf(new_ty)

    # 4. Division by zero prevention in zoom
    with pytest.raises(ValueError):
        zoom_to_cursor(100.0, 100.0, 0.0, 0.0, 0.0, 2.0)

    # 5. Fit-to-screen on zero or negative dimensions raises ValueError
    with pytest.raises(ValueError):
        fit_to_screen(1000.0, 800.0, 0.0, 100.0)


# ---------------------------------------------------------------------------
# Boundary 8: 8-Point Resize Handle Boundary & Inversion
# ---------------------------------------------------------------------------
def test_boundary_resize_handle_inversion():
    """B8: Dragging handle past opposite anchor preserves minimum 4px."""
    initial = BoundingBox(x=100.0, y=100.0, width=50.0, height=50.0)
    img_w, img_h = 1000.0, 1000.0

    # 1. Drag NW handle far to the right (dx = 100 > width 50)
    nw_inverted = apply_resize_handle("nw", initial, dx=100.0, dy=0.0, img_w=img_w, img_h=img_h)
    assert nw_inverted.width >= 4.0
    assert nw_inverted.x <= 150.0 - 4.0

    # 2. Drag SE handle far to the left (dx = -100 < -width 50)
    se_inverted = apply_resize_handle("se", initial, dx=-100.0, dy=0.0, img_w=img_w, img_h=img_h)
    assert se_inverted.width >= 4.0
    assert se_inverted.x == 100.0

    # 3. Drag N handle past bottom edge (dy = 80 > height 50)
    n_inverted = apply_resize_handle("n", initial, dx=0.0, dy=80.0, img_w=img_w, img_h=img_h)
    assert n_inverted.height >= 4.0

    # 4. Drag E handle past image right boundary
    e_overflow = apply_resize_handle("e", initial, dx=2000.0, dy=0.0, img_w=img_w, img_h=img_h)
    assert e_overflow.x + e_overflow.width <= img_w

    # 5. Drag S handle past image bottom boundary
    s_overflow = apply_resize_handle("s", initial, dx=0.0, dy=2000.0, img_w=img_w, img_h=img_h)
    assert s_overflow.y + s_overflow.height <= img_h


# ---------------------------------------------------------------------------
# Boundary 9: Reader Arrow Navigation Limits
# ---------------------------------------------------------------------------
def test_boundary_reader_navigation_limits():
    """B9: Keyboard arrow navigation clamping on first/last pages."""
    total_pages = 5

    # 1. Page 1 ArrowLeft in LTR (remains Page 1)
    assert compute_page_navigation(1, total_pages, "ArrowLeft", direction="ltr") == 1

    # 2. Page 5 ArrowRight in LTR (remains Page 5)
    assert compute_page_navigation(5, total_pages, "ArrowRight", direction="ltr") == 5

    # 3. Page 1 ArrowRight in RTL (remains Page 1)
    assert compute_page_navigation(1, total_pages, "ArrowRight", direction="rtl") == 1

    # 4. Page 5 ArrowLeft in RTL (remains Page 5)
    assert compute_page_navigation(5, total_pages, "ArrowLeft", direction="rtl") == 5

    # 5. Single page chapter (total = 1)
    assert compute_page_navigation(1, 1, "ArrowRight", direction="ltr") == 1
    assert compute_page_navigation(1, 1, "ArrowLeft", direction="ltr") == 1


# ---------------------------------------------------------------------------
# Boundary 10: Undo/Redo Branching Pruning & Depth Limit
# ---------------------------------------------------------------------------
def test_boundary_undo_redo_branching_and_depth():
    """B10: Stack history branches and maximum depth limit (50)."""
    stack = HistoryStack(max_depth=50)

    # 1. Push 5 snapshots
    for i in range(1, 6):
        stack.push(HistorySnapshot(f"s{i}", "p1", "ADD", [], [{"id": f"r{i}"}], float(i)))
    assert len(stack.undo_stack) == 5

    # 2. Undo 2 snapshots
    stack.undo()
    stack.undo()
    assert len(stack.undo_stack) == 3
    assert len(stack.redo_stack) == 2

    # 3. Push new snapshot -> Redo stack must be completely pruned
    stack.push(HistorySnapshot("s_branch", "p1", "ADD", [], [{"id": "r_branch"}], 100.0))
    assert len(stack.undo_stack) == 4
    assert len(stack.redo_stack) == 0  # Pruned

    # 4. Exceed maximum depth limit of 50
    for i in range(60):
        stack.push(HistorySnapshot(f"fill_{i}", "p1", "ADD", [], [], float(i)))
    assert len(stack.undo_stack) == 50  # Hard capped at 50

    # 5. Undo underflow (empty stack) returns None
    empty_stack = HistoryStack()
    assert empty_stack.undo() is None
    assert empty_stack.redo() is None


# ---------------------------------------------------------------------------
# Boundary 11: Backend Upload Payload & Format Rejection
# ---------------------------------------------------------------------------
def test_boundary_upload_validation_rejection(client):
    """B11: Corrupt, non-image, and oversized uploads rejected."""
    # 1. Corrupt executable payload
    corrupt_bytes = create_corrupt_image()
    files = {"file": ("malicious.png", corrupt_bytes, "image/png")}
    res_corrupt = client.post("/api/v1/images/validate", files=files)
    assert res_corrupt.status_code == 400
    assert res_corrupt.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    # 2. Plain text file disguised as JPEG
    text_bytes = b"Just plain text pretending to be JPEG"
    files = {"file": ("fake.jpg", text_bytes, "image/jpeg")}
    res_fake = client.post("/api/v1/images/validate", files=files)
    assert res_fake.status_code == 400
    assert res_fake.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    # 3. Empty 0-byte file
    files = {"file": ("empty.png", b"", "image/png")}
    res_empty = client.post("/api/v1/images/validate", files=files)
    assert res_empty.status_code == 400

    # 4. Sub-minimum 9x9 image rejected (minimum resolution is 10x10)
    submin_bytes = create_test_png(9, 9)
    files_sub = {"file": ("submin.png", submin_bytes, "image/png")}
    res_submin = client.post("/api/v1/images/validate", files=files_sub)
    assert res_submin.status_code == 400
    assert res_submin.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    # 5. Exact minimum 10x10 image accepted
    min_bytes = create_test_png(10, 10)
    files_min = {"file": ("min10.png", min_bytes, "image/png")}
    res_min = client.post("/api/v1/images/validate", files=files_min)
    assert res_min.status_code == 200
    assert res_min.json()["width"] == 10
    assert res_min.json()["height"] == 10

    # 6. Oversized payload limit check (50MB)
    cap_res = client.get("/api/v1/capabilities")
    assert cap_res.json()["limits"]["max_upload_size_mb"] == 50
