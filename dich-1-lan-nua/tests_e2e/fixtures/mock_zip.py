"""
Mock ZIP generators for E2E testing.
Creates clean archives, dirty archives containing macOS metadata and Thumbs.db,
empty archives, and non-image archives.
"""

import io
import zipfile
from tests_e2e.fixtures.sample_images import create_test_jpeg, create_test_png


def create_clean_manga_zip(filenames: list[str] = None) -> bytes:
    """Create a clean ZIP archive with valid manga page images."""
    if filenames is None:
        filenames = ["page_01.jpg", "page_02.jpg", "page_03.jpg"]

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname in filenames:
            if fname.lower().endswith((".jpg", ".jpeg")):
                data = create_test_jpeg(800, 1200)
            else:
                data = create_test_png(800, 1200)
            zf.writestr(fname, data)
    return buffer.getvalue()


def create_dirty_manga_zip() -> bytes:
    """
    Create a realistic dirty ZIP archive containing:
    - macOS resource fork directory: __MACOSX/._page_01.png
    - macOS desktop service store: .DS_Store
    - Windows thumbnail cache: Thumbs.db
    - Non-image metadata: info.txt, metadata.xml
    - Comic pages in unordered filename sequence: page_10.png, page_1.png, page_2.png
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. macOS resource forks
        zf.writestr("__MACOSX/._page_01.png", b"\x00\x05\x16\x07Mac OS X Resource Fork")
        zf.writestr("__MACOSX/.DS_Store", b"\x00\x00\x00\x01")

        # 2. Hidden system files
        zf.writestr(".DS_Store", b"\x00\x00\x00\x01Bud1\x00")
        zf.writestr("Thumbs.db", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")

        # 3. Non-image metadata
        zf.writestr("info.txt", b"Manga Chapter 1 by Studio")
        zf.writestr("metadata.xml", b"<comic><title>Chapter 1</title></comic>")

        # 4. Actual manga images in shuffled sequence
        zf.writestr("page_10.png", create_test_png(800, 1200, (10, 10, 10)))
        zf.writestr("page_1.png", create_test_png(800, 1200, (1, 1, 1)))
        zf.writestr("page_2.png", create_test_png(800, 1200, (2, 2, 2)))
        zf.writestr("page_20.png", create_test_png(800, 1200, (20, 20, 20)))

    return buffer.getvalue()


def create_empty_zip() -> bytes:
    """Create an empty ZIP archive."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as zf:
        pass
    return buffer.getvalue()


def create_non_image_zip() -> bytes:
    """Create a ZIP archive with no supported image files."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as zf:
        zf.writestr("read_me.txt", b"No images in this archive.")
        zf.writestr("script.py", b"print('hello world')")
    return buffer.getvalue()
