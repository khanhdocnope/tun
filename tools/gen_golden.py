"""
Sinh golden fixtures cho các module vision của Rust (app_tauri/src-tauri/src/vision).

- classify_cases.json: kết quả của đúng hàm classify_text_region trong
  hf_spaces_manga_cleaner/app.py (trích bằng ast, không cần torch/gradio).
- morph_cases.json: kết quả của OpenCV (dilate ellipse/rect, connectedComponentsWithStats)
  để kiểm tra bản Rust tự viết (không phụ thuộc opencv).

Chạy:  python tools/gen_golden.py     (cần numpy, opencv-python-headless)
Rust test đọc các file này bằng include_str!. Sinh lại khi đổi logic ở app.py.
"""
import ast
import base64
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
APP_PY = ROOT / "hf_spaces_manga_cleaner" / "app.py"
OUT = ROOT / "app_tauri" / "src-tauri" / "tests" / "golden"


def load_classify():
    tree = ast.parse(APP_PY.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "classify_text_region")
    mod = ast.Module(body=[fn], type_ignores=[])
    ns = {"cv2": cv2, "np": np, "Any": object}
    exec(compile(ast.fix_missing_locations(mod), "app.py", "exec"), ns)
    return ns["classify_text_region"]


class Region:
    def __init__(self, xywh):
        self.xywh = xywh


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def classify_cases(rng):
    classify = load_classify()
    cases = []

    def add(img, xywh):
        exp = classify(Region(xywh), img)
        h, w = img.shape[:2]
        cases.append({"w": w, "h": h, "rgb": b64(img), "xywh": list(xywh), "expected": exp})

    for i in range(70):
        h, w = int(rng.integers(24, 48)), int(rng.integers(24, 48))
        kind = i % 7
        if kind == 0:  # bóng thoại trắng + chữ đen
            img = np.full((h, w, 3), 255, np.uint8)
            for _ in range(int(rng.integers(3, 12))):
                x, y = int(rng.integers(5, w - 10)), int(rng.integers(5, h - 10))
                img[y:y + int(rng.integers(2, 8)), x:x + int(rng.integers(1, 4))] = 0
        elif kind == 1:  # trắng có screentone xám
            img = np.full((h, w, 3), 235, np.uint8)
            img[::3, ::3] = int(rng.integers(120, 200))
        elif kind == 2:  # bóng thoại đen + chữ trắng
            img = np.full((h, w, 3), 8, np.uint8)
            for _ in range(int(rng.integers(3, 10))):
                x, y = int(rng.integers(5, w - 10)), int(rng.integers(5, h - 10))
                img[y:y + 5, x:x + 2] = 250
        elif kind == 3:  # nền màu bão hòa
            base = rng.integers(0, 256, 3)
            img = np.tile(base.astype(np.uint8), (h, w, 1))
            img = np.clip(img.astype(int) + rng.integers(-20, 20, (h, w, 3)), 0, 255).astype(np.uint8)
        elif kind == 4:  # xám trung tính tối giữa
            img = np.full((h, w, 3), int(rng.integers(60, 180)), np.uint8)
            img += rng.integers(0, 6, (h, w, 3)).astype(np.uint8)
        elif kind == 5:  # gần ngưỡng bão hòa: trắng pha chút màu
            tint = int(rng.integers(0, 40))
            img = np.full((h, w, 3), 240, np.uint8)
            img[..., 2] = np.clip(240 - tint, 0, 255)
        else:  # nhiễu ngẫu nhiên
            img = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)

        # xywh có thể vượt ảnh / âm / bằng 0 để kiểm tra clamp
        mode = int(rng.integers(0, 5))
        if mode == 0:
            xywh = (0, 0, w, h)
        elif mode == 1:
            xywh = (int(rng.integers(0, w // 2)), int(rng.integers(0, h // 2)), int(rng.integers(5, w)), int(rng.integers(5, h)))
        elif mode == 2:
            xywh = (w - 3, h - 3, 50, 50)
        elif mode == 3:
            xywh = (w + 20, h + 20, 10, 10)
        else:
            xywh = (int(rng.integers(0, w // 2)), int(rng.integers(0, h // 2)), 0, -4)
        add(img, xywh)

    return cases


def structuring(kind, k):
    return cv2.getStructuringElement(kind, (k, k))


def morph_cases(rng):
    out = {"ellipse_kernels": {}, "dilate": [], "cc": []}
    for k in (3, 5, 7, 9, 11):
        out["ellipse_kernels"][str(k)] = structuring(cv2.MORPH_ELLIPSE, k).flatten().tolist()

    for i in range(24):
        h, w = int(rng.integers(12, 40)), int(rng.integers(12, 40))
        density = float(rng.choice([0.02, 0.08, 0.2, 0.5]))
        m = ((rng.random((h, w)) < density) * 255).astype(np.uint8)
        case = {"w": w, "h": h, "mask": b64(m), "results": {}}
        for k in (3, 5, 7, 9):
            case["results"][f"ellipse{k}"] = b64(cv2.dilate(m, structuring(cv2.MORPH_ELLIPSE, k)))
        for k in (3, 5, 11):
            case["results"][f"rect{k}"] = b64(cv2.dilate(m, structuring(cv2.MORPH_RECT, k)))
        out["dilate"].append(case)

    for i in range(24):
        h, w = int(rng.integers(10, 40)), int(rng.integers(10, 40))
        density = float(rng.choice([0.1, 0.3, 0.5, 0.65]))
        m = ((rng.random((h, w)) < density) * 255).astype(np.uint8)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        out["cc"].append({
            "w": w, "h": h, "mask": b64(m), "num_labels": int(n),
            "labels": b64(labels.astype(np.uint32)),
            "stats": stats.astype(int).tolist(),  # [x, y, w, h, area]
        })
    return out


def geom_cases(rng):
    """Điểm ngẫu nhiên (tọa độ nguyên) -> convexHull / minAreaRect của OpenCV."""
    out = {"rect": [], "otsu": []}
    for i in range(40):
        n = int(rng.integers(3, 60))
        kind = i % 4
        if kind == 0:      # đám mây tròn
            pts = rng.normal(0, rng.integers(3, 30), (n, 2))
        elif kind == 1:    # dải mảnh xoay
            t = rng.uniform(-40, 40, n)
            ang = rng.uniform(0, np.pi)
            pts = np.stack([t * np.cos(ang), t * np.sin(ang)], 1) + rng.normal(0, 2, (n, 2))
        elif kind == 2:    # hình chữ nhật đầy
            pts = np.stack([rng.integers(0, 50, n), rng.integers(0, 12, n)], 1).astype(float)
        else:              # đám mây lệch
            pts = rng.normal(0, 1, (n, 2)) * [25, 6] + [100, 50]
        pts = np.unique(np.round(pts).astype(np.int32), axis=0)
        if len(pts) < 3:
            continue
        hull = cv2.convexHull(pts)
        (cx, cy), (w, h), _ = cv2.minAreaRect(pts)
        out["rect"].append({
            "pts": pts.tolist(),
            "hull_area": float(cv2.contourArea(hull)),
            "center": [float(cx), float(cy)],
            "rect_area": float(w) * float(h),
        })
    for i in range(30):
        h, w = int(rng.integers(8, 40)), int(rng.integers(8, 40))
        if i % 3 == 0:      # hai mức xám rõ rệt
            g = np.where(rng.random((h, w)) < 0.3, rng.integers(0, 70, (h, w)), rng.integers(180, 256, (h, w)))
        elif i % 3 == 1:    # nhiễu đều
            g = rng.integers(0, 256, (h, w))
        else:               # xám hẹp
            g = rng.integers(90, 160, (h, w))
        g = g.astype(np.uint8)
        t, _ = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        out["otsu"].append({"w": w, "h": h, "gray": b64(g), "threshold": int(t)})
    return out


def main():
    rng = np.random.default_rng(20261108)
    OUT.mkdir(parents=True, exist_ok=True)
    cases = classify_cases(rng)
    (OUT / "classify_cases.json").write_text(json.dumps(cases), encoding="utf-8")
    counts = {}
    for c in cases:
        counts[c["expected"]] = counts.get(c["expected"], 0) + 1
    print("classify:", len(cases), counts)
    (OUT / "morph_cases.json").write_text(json.dumps(morph_cases(rng)), encoding="utf-8")
    (OUT / "geom_cases.json").write_text(json.dumps(geom_cases(rng)), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
