"""Unit tests for manga_schema.py."""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "colab-backend"))

from manga_schema import (
    to_normalized_box,
    to_pixel_bounds,
    sort_reading_order,
    MangaLayer,
    LayerGeometry,
    LayerTypography,
    LayerContent,
    MangaPageResponse,
    MangaPageMeta,
    MangaPageAssets,
    ImageDimensions,
    compute_sha256,
)


def test_normalized_conversions():
    w, h = 1000, 2000
    norm = to_normalized_box(100, 200, 300, 600, w, h)
    assert norm == [100, 100, 300, 300]

    pb = to_pixel_bounds(norm, w, h)
    assert pb.x == 100
    assert pb.y == 200
    assert pb.width == 200
    assert pb.height == 400


def test_manga_reading_order_rtl():
    layers = [
        MangaLayer(
            id="left",
            order_index=0,
            type="speech_bubble",
            box_2d=[100, 100, 200, 300],
            pixel_bounds=to_pixel_bounds([100, 100, 200, 300], 1000, 1000),
        ),
        MangaLayer(
            id="right",
            order_index=0,
            type="speech_bubble",
            box_2d=[100, 700, 200, 900],
            pixel_bounds=to_pixel_bounds([100, 700, 200, 900], 1000, 1000),
        ),
    ]

    sorted_layers = sort_reading_order(layers, reading_direction="rtl", height=1000)
    assert sorted_layers[0].id == "right"
    assert sorted_layers[0].order_index == 1
    assert sorted_layers[1].id == "left"
    assert sorted_layers[1].order_index == 2


def test_sha256():
    h = compute_sha256(b"hello manga")
    assert len(h) == 64


if __name__ == "__main__":
    test_normalized_conversions()
    test_manga_reading_order_rtl()
    test_sha256()
    print("All Python schema tests passed successfully!")
