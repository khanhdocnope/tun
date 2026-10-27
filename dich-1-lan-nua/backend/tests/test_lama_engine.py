import numpy as np
import pytest

from app.services.inpainting import lama_engine
from app.services.inpainting.lama_engine import LamaEngine, _crop_boxes
from app.services.inpainting.manager import inpainting_manager

requires_lama = pytest.mark.skipif(
    not lama_engine.is_available(), reason="torch or the LaMa checkpoint is missing"
)


def test_crop_boxes_merges_nearby_glyphs_and_keeps_bubbles_apart():
    mask = np.zeros((400, 600), dtype=np.uint8)
    # one line of glyphs (40 px apart) and a distant second bubble
    for x in (50, 90, 130):
        mask[100:140, x : x + 20] = 255
    mask[300:340, 500:520] = 255

    boxes = _crop_boxes(mask, margin=24)
    assert len(boxes) == 2

    (x1, y1, x2, y2), (x3, y3, x4, y4) = boxes
    assert x1 == 50 - 24 and x2 == 150 + 24
    assert y1 == 100 - 24 and y2 == 140 + 24
    assert (x3, y3, x4, y4) == (500 - 24, 300 - 24, 520 + 24, 340 + 24)


def test_crop_boxes_are_clipped_to_the_image():
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[0:10, 0:10] = 255
    (x1, y1, x2, y2) = _crop_boxes(mask, margin=100)[0]
    assert (x1, y1) == (0, 0)
    assert (x2, y2) == (100, 100)


def test_empty_mask_returns_an_untouched_copy():
    image = np.full((32, 32, 3), 128, dtype=np.uint8)
    mask = np.zeros((32, 32), dtype=np.uint8)
    out = LamaEngine().inpaint(image, mask)
    assert np.array_equal(out, image)
    assert out is not image


def test_manager_only_registers_lama_when_it_can_run():
    engines = inpainting_manager.get_available_engines()
    assert "opencv_telea" in engines
    assert ("lama" in engines) is lama_engine.is_available()


@requires_lama
def test_inpaint_replaces_masked_pixels_only():
    image = np.full((96, 96, 3), 240, dtype=np.uint8)
    image[40:56, 40:56] = 20  # a dark blob to erase
    mask = np.zeros((96, 96), dtype=np.uint8)
    mask[38:58, 38:58] = 255

    out = LamaEngine().inpaint(image, mask, margin=16, max_side=96)
    assert out.shape == image.shape and out.dtype == np.uint8
    assert not np.array_equal(out[40:56, 40:56], image[40:56, 40:56])
    # unmasked pixels stay bit-identical
    assert np.array_equal(out[~mask.astype(bool)], image[~mask.astype(bool)])
