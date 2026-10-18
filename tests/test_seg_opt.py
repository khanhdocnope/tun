"""
test_seg_opt.py  –  Unit tests for ComicTextDetectorEngine and thread optimizations.

Checks:
1. _detect_cpu_threads() detects cgroup/system limits and bounds thread count.
2. ComicTextDetectorEngine interface contract (seg_map output shape, dtype, bounds).
"""
import sys, pathlib, os
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tool-xoa-anh"))

HAS_TORCH = True
try:
    import torch  # noqa: F401
    from manga_cleaner import _detect_cpu_threads, ComicTextDetectorEngine
except ImportError:
    HAS_TORCH = False


def test_detect_cpu_threads():
    threads = _detect_cpu_threads()
    assert isinstance(threads, int), f"threads must be int, got {type(threads)}"
    assert 1 <= threads <= 8, f"threads {threads} out of expected range [1, 8]"
    print(f"PASS: _detect_cpu_threads returned {threads}")


def test_cpu_threads_env_override(monkeypatch=None):
    old_env = os.environ.get("CPU_THREADS")
    try:
        os.environ["CPU_THREADS"] = "3"
        assert _detect_cpu_threads() == 3
        print("PASS: CPU_THREADS env override works")
    finally:
        if old_env is not None:
            os.environ["CPU_THREADS"] = old_env
        else:
            os.environ.pop("CPU_THREADS", None)


def test_ctd_engine_interface():
    engine = ComicTextDetectorEngine()
    # Even if onnx weights aren't present locally, engine must safely handle seg_map calls
    img = np.zeros((300, 400, 3), dtype=np.uint8)
    seg = engine.seg_map(img, size=1024)
    assert seg.shape == (300, 400), f"Expected shape (300, 400), got {seg.shape}"
    assert seg.dtype == np.float32 or seg.dtype == np.float64, f"Expected float, got {seg.dtype}"
    assert 0.0 <= float(seg.min()) and float(seg.max()) <= 1.0, f"Values out of bounds: [{seg.min()}, {seg.max()}]"
    print("PASS: ComicTextDetectorEngine interface contract")


if __name__ == "__main__":
    if not HAS_TORCH:
        print("[WARNING] torch not installed locally; run on HF Space for full coverage.")
    else:
        test_detect_cpu_threads()
        test_cpu_threads_env_override()
        test_ctd_engine_interface()
        print("\n[OK] All seg optimization tests passed!")
