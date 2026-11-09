"""
Chuẩn bị 2 model ONNX cho LocalCleaner (Rust):

  <out>/detector.onnx   PP-OCR text detector (DB), lấy từ gói rapidocr_onnxruntime đã cài
  <out>/lama.onnx       LaMa fp16 (g-ronimo/lama trên Hugging Face, như hf_spaces_manga_cleaner/lama_onnx.py)

Dùng:
    pip install rapidocr_onnxruntime huggingface_hub
    python tools/fetch_models.py --out ./models
rồi trỏ "Thư mục model local" trong Cài đặt tới thư mục đó (build app với --features local-ort).

Lưu ý: detector PP-OCR không được huấn luyện riêng cho manga (khác CTD). Muốn chất lượng cao hơn,
export CTD/DBNet của manga-image-translator sang ONNX có output bản đồ xác suất [1,1,H,W] và đặt tên
detector.onnx; hậu xử lý Rust dùng được nguyên.
"""
import argparse
import shutil
import sys
from pathlib import Path

LAMA_REPO = "g-ronimo/lama"
LAMA_FILE = "lama_fp16.onnx"


def find_det_model() -> Path:
    import rapidocr_onnxruntime

    models = Path(rapidocr_onnxruntime.__file__).parent / "models"
    cands = sorted(models.glob("*det*.onnx"))
    if not cands:
        sys.exit(f"Không thấy model det trong {models}. Kiểm tra phiên bản rapidocr_onnxruntime.")
    return cands[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="models")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    det = find_det_model()
    shutil.copyfile(det, out / "detector.onnx")
    print("detector.onnx <-", det)

    from huggingface_hub import hf_hub_download

    lama = hf_hub_download(repo_id=LAMA_REPO, filename=LAMA_FILE)
    shutil.copyfile(lama, out / "lama.onnx")
    print("lama.onnx     <-", lama)

    try:
        import onnxruntime as ort

        for name in ("detector.onnx", "lama.onnx"):
            s = ort.InferenceSession(str(out / name), providers=["CPUExecutionProvider"])
            print(name, "inputs:", [(i.name, i.type, i.shape) for i in s.get_inputs()],
                  "outputs:", [(o.name, o.type, o.shape) for o in s.get_outputs()])
        print("\nKiểm tra: input/output phải là tensor(float); lama có 2 input (ảnh, mask).")
    except Exception as e:  # noqa: BLE001
        print("Bỏ qua bước kiểm tra:", e)


if __name__ == "__main__":
    main()
