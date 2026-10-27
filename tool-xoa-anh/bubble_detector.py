"""
Region detector: ogkalu/comic-text-and-bubble-detector (RT-DETR-v2, Apache-2.0).

Classes: 0 bubble (empty outline) | 1 text_bubble (dialogue) | 2 text_free (SFX / narration).
This model, not colour/ray-casting heuristics, decides Chat vs SFX.
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

import cv2
import numpy as np
import torch

from mask_logic import CLS_BUBBLE, CLS_TEXT_BUBBLE, CLS_TEXT_FREE, Det

logger = logging.getLogger("manga_cleaner.bubble")

REPO_ID = os.getenv("BUBBLE_DETECTOR_REPO", "ogkalu/comic-text-and-bubble-detector")
INPUT_SIZE = 640          # training size; images were *stretched* to 640x640
TALL_RATIO = 2.0          # h/w above this -> treat as webtoon strip and tile


class BubbleTextDetector:
    def __init__(self) -> None:
        self.model = None
        self.ready = False
        self.error: Optional[str] = None
        self._ids = {CLS_BUBBLE: 0, CLS_TEXT_BUBBLE: 1, CLS_TEXT_FREE: 2}

    # ---------------------------------------------------------------- loading
    def load(self) -> bool:
        if self.model is not None:
            return True
        try:
            from transformers import RTDetrV2ForObjectDetection  # needs transformers>=4.50

            model = RTDetrV2ForObjectDetection.from_pretrained(REPO_ID).eval()
            id2label = {int(k): str(v).lower() for k, v in model.config.id2label.items()}
            by_name = {v: k for k, v in id2label.items()}
            if {"text_bubble", "text_free"} <= set(by_name):
                self._ids = {
                    CLS_BUBBLE: by_name.get("bubble", 0),
                    CLS_TEXT_BUBBLE: by_name["text_bubble"],
                    CLS_TEXT_FREE: by_name["text_free"],
                }
            self.model = model
            self.ready = True
            logger.info("Bubble/text detector loaded: %s (ids=%s)", REPO_ID, self._ids)
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            logger.error("Cannot load bubble detector: %s", exc)
        return self.ready

    # -------------------------------------------------------------- inference
    @torch.inference_mode()
    def _run(self, img_rgb: np.ndarray, device: str, thr: float) -> List[Det]:
        h, w = img_rgb.shape[:2]
        x = cv2.resize(img_rgb, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
        x = torch.from_numpy(x.astype(np.float32) / 255.0).permute(2, 0, 1).unsqueeze(0).to(device)
        out = self.model(pixel_values=x)
        scores_all = out.logits.sigmoid()[0]                 # [Q, C]
        scores, labels = scores_all.max(dim=-1)              # best class per query
        cx, cy, bw, bh = out.pred_boxes[0].unbind(-1)        # normalised cxcywh
        boxes = torch.stack([(cx - bw / 2) * w, (cy - bh / 2) * h,
                             (cx + bw / 2) * w, (cy + bh / 2) * h], dim=-1)
        inv = {v: k for k, v in self._ids.items()}
        dets: List[Det] = []
        for s, l, b in zip(scores.tolist(), labels.tolist(), boxes.tolist()):
            if s >= thr and l in inv:
                x1, y1, x2, y2 = b
                dets.append(Det(inv[l], float(s), (max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2))))
        return dets

    def predict_boxes(self, img_rgb: np.ndarray, device: str = "cpu", thr: float = 0.30) -> List[Det]:
        """
        Detect without touching the device: the caller keeps the model on `device` for a whole
        ZeroGPU window (`manga_cleaner._gpu_page_job`), so moving it here would defeat that.
        """
        if not self.load():
            return []
        h, w = img_rgb.shape[:2]
        if h / max(w, 1) <= TALL_RATIO:
            return self._run(img_rgb, device, thr)

        tile_h = int(w * 1.5)
        step = int(tile_h * 0.85)
        dets: List[Det] = []
        y = 0
        while y < h:
            y2 = min(h, y + tile_h)
            for d in self._run(img_rgb[y:y2], device, thr):
                x1, y1, x2, yy2 = d.box
                dets.append(Det(d.cls, d.score, (x1, y1 + y, x2, yy2 + y)))
            if y2 >= h:
                break
            y += step
        return self._merge(dets)

    def detect(self, img_rgb: np.ndarray, device: str = "cpu", thr: float = 0.30) -> List[Det]:
        """Returns Det list in full-page pixel coordinates. Tiles tall webtoon strips."""
        if not self.load():
            return []
        self.model.to(device)
        try:
            return self.predict_boxes(img_rgb, device, thr)
        finally:
            if device != "cpu":
                self.model.to("cpu")
                torch.cuda.empty_cache()

    @staticmethod
    def _merge(dets: List[Det]) -> List[Det]:
        """Per-class NMS to merge duplicates from overlapping tiles."""
        merged: List[Det] = []
        for cls in (CLS_BUBBLE, CLS_TEXT_BUBBLE, CLS_TEXT_FREE):
            group = [d for d in dets if d.cls == cls]
            if not group:
                continue
            xywh = [[d.box[0], d.box[1], d.box[2] - d.box[0], d.box[3] - d.box[1]] for d in group]
            keep = cv2.dnn.NMSBoxes(xywh, [d.score for d in group], 0.0, 0.5)
            merged += [group[int(i)] for i in np.array(keep).flatten()]
        return merged
