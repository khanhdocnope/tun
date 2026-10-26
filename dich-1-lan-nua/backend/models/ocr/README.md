# OCR Models

Bundled ONNX weights used by `app/services/ocr/rapidocr_engine.py`.

| File | Purpose | Source |
| --- | --- | --- |
| `ch_PP-OCRv3_det_infer.onnx` | Text-line detection (DB) | [RapidOCR](https://github.com/RapidAI/RapidOCR) / PaddleOCR, Apache-2.0 |
| `ch_PP-OCRv5_rec_mobile.onnx` | Multilingual recognition (includes Japanese kana) | [RapidOCR](https://github.com/RapidAI/RapidOCR) / PaddleOCR, Apache-2.0 |

The detection model is run with `limit_type=max` at `limit_side_len=1600`
instead of the RapidOCR default (`min`, 736).  On the sample manga page in
`raw-test/` this alone raises recall from 7 to ~35 text lines.  Vertical
columns are rotated 90 degrees counter-clockwise before recognition, and the
PP-OCRv5 recognition model replaces the Chinese-only v3 dictionary.

`app/services/ocr/model_store.py` can re-download the files if they are missing;
set `DISABLE_OCR_MODEL_DOWNLOAD=1` for fully offline deployments.
