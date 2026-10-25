"""
Authoritative specification models and mathematical contracts for Comic Translation Studio Phase 1.
Derived strictly from ORIGINAL_REQUEST.md, PROJECT.md, and spec_miner_survey_3/handoff.md.
"""

from dataclasses import dataclass, field
import math
import re
from typing import Any, Literal, Optional


# ---------------------------------------------------------------------------
# 1. Coordinate Transformation Formulas
# ---------------------------------------------------------------------------

def screen_from_image(x_img: float, y_img: float, zoom: float, pan_x: float, pan_y: float) -> tuple[float, float]:
    """
    Forward affine transformation: P_screen = P_img * Z + T.
    """
    x_screen = x_img * zoom + pan_x
    y_screen = y_img * zoom + pan_y
    return (x_screen, y_screen)


def image_from_screen(x_screen: float, y_screen: float, zoom: float, pan_x: float, pan_y: float) -> tuple[float, float]:
    """
    Inverse affine transformation: P_img = (P_screen - T) / Z.
    """
    if zoom <= 0:
        raise ValueError("Zoom scale must be positive and non-zero")
    x_img = (x_screen - pan_x) / zoom
    y_img = (y_screen - pan_y) / zoom
    return (x_img, y_img)


def zoom_to_cursor(cursor_x: float, cursor_y: float, old_pan_x: float, old_pan_y: float,
                   old_zoom: float, new_zoom: float) -> tuple[float, float]:
    """
    Calculate updated pan offset (Tx_new, Ty_new) keeping the point under cursor invariant:
    T_new = C - (C - T_old) * (Z_new / Z_old)
    """
    if old_zoom <= 0 or new_zoom <= 0:
        raise ValueError("Zoom scales must be positive")
    ratio = new_zoom / old_zoom
    new_pan_x = cursor_x - (cursor_x - old_pan_x) * ratio
    new_pan_y = cursor_y - (cursor_y - old_pan_y) * ratio
    return (new_pan_x, new_pan_y)


def fit_to_screen(viewport_w: float, viewport_h: float, img_w: float, img_h: float, padding: float = 20.0) -> tuple[float, float, float]:
    """
    Calculate fit-to-screen zoom factor and centering pan:
    Z_fit = min((Vw - 2p) / W_img, (Vh - 2p) / H_img)
    Tx_fit = (Vw - W_img * Z_fit) / 2
    Ty_fit = (Vh - H_img * Z_fit) / 2
    """
    if img_w <= 0 or img_h <= 0 or viewport_w <= 2 * padding or viewport_h <= 2 * padding:
        raise ValueError("Invalid dimensions for fit-to-screen")
    scale_x = (viewport_w - 2 * padding) / img_w
    scale_y = (viewport_h - 2 * padding) / img_h
    z_fit = min(scale_x, scale_y)

    # Clamp zoom factor to [0.05, 20.0]
    z_fit = max(0.05, min(z_fit, 20.0))

    tx_fit = (viewport_w - img_w * z_fit) / 2.0
    ty_fit = (viewport_h - img_h * z_fit) / 2.0
    return (z_fit, tx_fit, ty_fit)


def actual_size_100(viewport_w: float, viewport_h: float, img_w: float, img_h: float) -> tuple[float, float, float]:
    """
    Calculate 100% actual size (Z = 1.0) and center image in viewport:
    Z = 1.0
    Tx = (Vw - W_img) / 2
    Ty = (Vh - H_img) / 2
    """
    z = 1.0
    tx = (viewport_w - img_w) / 2.0
    ty = (viewport_h - img_h) / 2.0
    return (z, tx, ty)


# ---------------------------------------------------------------------------
# 2. Bounding Box Normalization, Clamping, and Resize Handles
# ---------------------------------------------------------------------------

@dataclass
class BoundingBox:
    x: float
    y: float
    width: float
    height: float


def normalize_bounding_box(x1: float, y1: float, x2: float, y2: float) -> BoundingBox:
    """
    Normalize drag endpoints (X1, Y1) to (X2, Y2) to always produce positive dimensions:
    X_min = min(X1, X2), Y_min = min(Y1, Y2)
    W_raw = |X2 - X1|, H_raw = |Y2 - Y1|
    """
    xmin = min(x1, x2)
    ymin = min(y1, y2)
    w = abs(x2 - x1)
    h = abs(y2 - y1)
    return BoundingBox(x=xmin, y=ymin, width=w, height=h)


def clamp_bounding_box(box: BoundingBox, img_w: float, img_h: float, min_size: float = 4.0) -> Optional[BoundingBox]:
    """
    Constrains box position and dimensions within source image bounds [0, img_w] x [0, img_h].
    Discards box if resulting clamped width or height < min_size (default 4px).
    """
    if img_w <= 0 or img_h <= 0:
        return None

    # Calculate intersection interval with [0, img_w] and [0, img_h]
    left = max(0.0, min(box.x, img_w))
    right = max(0.0, min(box.x + box.width, img_w))
    top = max(0.0, min(box.y, img_h))
    bottom = max(0.0, min(box.y + box.height, img_h))

    w_clamped = right - left
    h_clamped = bottom - top

    if w_clamped < min_size or h_clamped < min_size:
        return None

    return BoundingBox(x=left, y=top, width=w_clamped, height=h_clamped)


def apply_resize_handle(handle: Literal["nw", "n", "ne", "e", "se", "s", "sw", "w"],
                        box: BoundingBox, dx: float, dy: float,
                        img_w: float, img_h: float, min_size: float = 4.0) -> BoundingBox:
    """
    Adjust bounding box via one of 8 resize handles fixing the opposite anchor,
    enforcing minimum dimensions min_size and clamping within image bounds.
    """
    left = box.x
    top = box.y
    right = box.x + box.width
    bottom = box.y + box.height

    if "w" in handle:
        new_left = min(right - min_size, max(0.0, left + dx))
        left = new_left
    if "e" in handle:
        new_right = max(left + min_size, min(img_w, right + dx))
        right = new_right
    if "n" in handle:
        new_top = min(bottom - min_size, max(0.0, top + dy))
        top = new_top
    if "s" in handle:
        new_bottom = max(top + min_size, min(img_h, bottom + dy))
        bottom = new_bottom

    return BoundingBox(x=left, y=top, width=right - left, height=bottom - top)


# ---------------------------------------------------------------------------
# 3. Canvas Undo/Redo History Stack
# ---------------------------------------------------------------------------

@dataclass
class HistorySnapshot:
    id: str
    page_id: str
    action_type: str
    regions_before: list[dict]
    regions_after: list[dict]
    timestamp: float


class HistoryStack:
    """
    Per-page undo/redo command stack supporting at least 50 operations.
    Maintains undo stack, redo stack, and prunes forward redo history on new actions.
    """
    def __init__(self, max_depth: int = 50):
        self.max_depth = max_depth
        self.undo_stack: list[HistorySnapshot] = []
        self.redo_stack: list[HistorySnapshot] = []

    def push(self, snapshot: HistorySnapshot) -> None:
        """Push new action to undo stack and clear redo stack."""
        self.undo_stack.append(snapshot)
        if len(self.undo_stack) > self.max_depth:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def can_undo(self) -> bool:
        return len(self.undo_stack) > 0

    def can_redo(self) -> bool:
        return len(self.redo_stack) > 0

    def undo(self) -> Optional[HistorySnapshot]:
        if not self.can_undo():
            return None
        snapshot = self.undo_stack.pop()
        self.redo_stack.append(snapshot)
        return snapshot

    def redo(self) -> Optional[HistorySnapshot]:
        if not self.can_redo():
            return None
        snapshot = self.redo_stack.pop()
        self.undo_stack.append(snapshot)
        return snapshot


# ---------------------------------------------------------------------------
# 4. Natural Alphanumeric Collation & ZIP Filtering
# ---------------------------------------------------------------------------

def natural_sort_key(s: str) -> list[Any]:
    """
    Splits string into numeric and non-numeric chunks for natural collation sorting
    so 'page_2.jpg' precedes 'page_10.jpg'.
    """
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]


def natural_sort_filenames(filenames: list[str]) -> list[str]:
    """Sort filenames using natural alphanumeric collation."""
    return sorted(filenames, key=natural_sort_key)


def filter_archive_image_entries(namelist: list[str]) -> list[str]:
    """
    Filter ZIP entries to valid images:
    - Must match extension: png, jpg, jpeg, webp
    - Must NOT be in __MACOSX/ resource forks
    - Must NOT be .DS_Store, Thumbs.db, desktop.ini
    """
    valid_exts = (".png", ".jpg", ".jpeg", ".webp")
    filtered = []
    for name in namelist:
        # Check hidden / OS metadata files
        if "__MACOSX" in name or name.startswith("._"):
            continue
        basename = name.split("/")[-1].split("\\")[-1]
        if basename in (".DS_Store", "Thumbs.db", "desktop.ini"):
            continue
        if basename.startswith("."):
            continue
        if any(name.lower().endswith(ext) for ext in valid_exts):
            filtered.append(name)

    return natural_sort_filenames(filtered)


# ---------------------------------------------------------------------------
# 5. Reader Mode Navigation Mapping
# ---------------------------------------------------------------------------

def compute_page_navigation(current_page: int, total_pages: int, key: str,
                            direction: Literal["ltr", "rtl"] = "ltr") -> int:
    """
    Compute next/previous page based on key press ('ArrowLeft', 'ArrowRight')
    and reading direction ('ltr' vs 'rtl'), clamped between 1 and total_pages.
    """
    if total_pages <= 0:
        return 1

    step = 0
    if direction == "ltr":
        if key == "ArrowRight":
            step = 1
        elif key == "ArrowLeft":
            step = -1
    elif direction == "rtl":
        if key == "ArrowLeft":
            step = 1
        elif key == "ArrowRight":
            step = -1

    new_page = current_page + step
    return max(1, min(new_page, total_pages))


# ---------------------------------------------------------------------------
# 6. Dark Creative Studio UI Design Tokens
# ---------------------------------------------------------------------------

STUDIO_THEME = {
    "background": "#121316",
    "sidebar": "#141518",
    "toolbar": "#1a1b20",
    "card": "#18191d",
    "border": "#272930",
    "primary": "#3b82f6",
    "primary_hover": "#2563eb",
    "muted": "#94a3b8",
    "text": "#f1f5f9",
    "min_sidebar_width": 240,
}

STUDIO_QUADRANTS = [
    "TopToolbar",
    "ProjectSidebar",
    "MainCanvas",
    "PropertiesPanel",
]
