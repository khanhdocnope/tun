"""
Unit test suite for Contour-Preserving Dilation, Dual-Gate Bubble Filter, and Flat-Fill Bypass.
"""

import unittest
import cv2
import numpy as np
from mask_logic import (
    Det,
    CLS_TEXT_BUBBLE,
    CLS_TEXT_FREE,
    build_masks,
    extract_contour_barrier,
    contour_preserving_dilate,
    flat_fill_uniform_paper,
    _ellipse,
)


class TestContourPreservingDilation(unittest.TestCase):
    def setUp(self):
        self.img1 = cv2.imread("examples/sample1.jpg")
        self.img2 = cv2.imread("examples/sample2.jpg")
        self.assertIsNotNone(self.img1, "sample1.jpg must exist")
        self.assertIsNotNone(self.img2, "sample2.jpg must exist")

    def test_zero_leakage_sample1_oval_bubble(self):
        h, w = self.img1.shape[:2]
        gray = cv2.cvtColor(self.img1, cv2.COLOR_BGR2GRAY)
        
        # Upper left dialogue bubble
        x1, y1, x2, y2 = 100, 70, 420, 340
        chat_text = np.zeros((h, w), np.uint8)
        chat_text[y1:y2, x1:x2] = ((gray[y1:y2, x1:x2] < 80).astype(np.uint8)) * 255

        barrier = extract_contour_barrier(gray, chat_text, barrier_grow=2)

        # Bubble outline reference
        crop_border = (gray[50:360, 80:440] < 80).astype(np.uint8) * 255
        crop_border[chat_text[50:360, 80:440] > 0] = 0

        # Even with high dilation (10px), overlap with bubble border must be 0
        erased = contour_preserving_dilate(chat_text, barrier, dilation_px=10)
        overlap = cv2.bitwise_and(erased[50:360, 80:440], crop_border)
        leakage_px = np.count_nonzero(overlap)
        
        self.assertEqual(leakage_px, 0, f"Expected 0px border leakage, got {leakage_px}px")

    def test_zero_leakage_sample2_jagged_bubble(self):
        h, w = self.img2.shape[:2]
        gray = cv2.cvtColor(self.img2, cv2.COLOR_BGR2GRAY)

        # Large shout bubble with sharp lightning spikes (text extends to y=850)
        x1, y1, x2, y2 = 660, 260, 960, 850
        chat_text = np.zeros((h, w), np.uint8)
        chat_text[y1:y2, x1:x2] = ((gray[y1:y2, x1:x2] < 80).astype(np.uint8)) * 255

        barrier = extract_contour_barrier(gray, chat_text, barrier_grow=2)

        bubble_border = (gray[230:860, 630:980] < 80).astype(np.uint8) * 255
        bubble_border[chat_text[230:860, 630:980] > 0] = 0

        erased = contour_preserving_dilate(chat_text, barrier, dilation_px=8)
        overlap = cv2.bitwise_and(erased[230:860, 630:980], bubble_border)
        leakage_px = np.count_nonzero(overlap)

        self.assertEqual(leakage_px, 0, f"Jagged shout bubble leaked {leakage_px}px onto contour")

    def test_dual_gate_sfx_protection(self):
        h, w = self.img1.shape[:2]
        gray = cv2.cvtColor(self.img1, cv2.COLOR_BGR2GRAY)

        dets = [
            Det(CLS_TEXT_BUBBLE, 0.95, (100, 70, 420, 340)),
            Det(CLS_TEXT_FREE, 0.90, (700, 70, 870, 220)),  # SFX ガッ on the sky
        ]

        seg = np.zeros((h, w), np.float32)
        for d in dets:
            bx1, by1, bx2, by2 = [int(v) for v in d.box]
            seg[by1:by2, bx1:bx2] = (gray[by1:by2, bx1:bx2] < 80).astype(np.float32)

        ms = build_masks(self.img1, seg, dets, dilation_px=4)

        # Chat erase must contain pixels
        self.assertGreater(np.count_nonzero(ms.chat_erase), 1000)
        # SFX erase must contain SFX pixels
        self.assertGreater(np.count_nonzero(ms.sfx_erase), 500)

        # In default mode (clean_sfx=False), chat_erase must NOT touch SFX region
        sfx_box_mask = np.zeros((h, w), np.uint8)
        sfx_box_mask[70:220, 700:870] = 255
        overlap_chat_with_sfx = cv2.bitwise_and(ms.chat_erase, sfx_box_mask)
        self.assertEqual(np.count_nonzero(overlap_chat_with_sfx), 0, "Chat erase must not touch free SFX area")

    def test_flat_fill_paper(self):
        h, w = self.img1.shape[:2]
        gray = cv2.cvtColor(self.img1, cv2.COLOR_BGR2GRAY)
        boxes = [(100, 70, 420, 340)]
        
        chat_text = np.zeros((h, w), np.uint8)
        chat_text[70:340, 100:420] = ((gray[70:340, 100:420] < 80).astype(np.uint8)) * 255
        barrier = extract_contour_barrier(gray, chat_text, barrier_grow=2)
        chat_erase = contour_preserving_dilate(chat_text, barrier, dilation_px=4)

        filled_img, done = flat_fill_uniform_paper(self.img1, chat_erase, boxes, max_std=8.5)
        filled_count = np.count_nonzero(done)
        self.assertGreater(filled_count, 1000, "Flat-fill should have filled dialogue strokes on uniform white paper")


if __name__ == "__main__":
    unittest.main()
