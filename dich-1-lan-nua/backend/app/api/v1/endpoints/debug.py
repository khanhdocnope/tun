import os
from fastapi import APIRouter

router = APIRouter(tags=["Debug"])


@router.get("/debug/lama")
async def debug_lama():
    info = {}
    try:
        import torch
        info["torch"] = torch.__version__
        info["cuda"] = torch.cuda.is_available()
    except Exception as e:
        info["torch_error"] = str(e)
    try:
        from app.services.inpainting.lama_engine import is_available, _ensure_model, ANIME_LAMA_PATH, TORCH_AVAILABLE, LAST_ERROR, MODEL_DIR, BASE_DIR
        info["torch_available_flag"] = TORCH_AVAILABLE
        info["base_dir"] = str(BASE_DIR)
        info["model_dir"] = str(MODEL_DIR)
        info["model_dir_exists"] = MODEL_DIR.exists()
        info["model_dir_contents"] = [p.name for p in MODEL_DIR.iterdir()] if MODEL_DIR.exists() else []
        info["weights_dir_exists"] = (BASE_DIR / "weights").exists()
        info["target_path"] = str(ANIME_LAMA_PATH)
        # Try download with explicit error capture
        try:
            p = _ensure_model()
            info["model_path"] = str(p) if p else None
            info["model_exists"] = (p is not None and p.is_file())
            if p and p.is_file():
                info["model_size_mb"] = round(p.stat().st_size / (1024*1024), 1)
        except Exception as e:
            info["ensure_error"] = str(e)
        info["last_error"] = LAST_ERROR
        info["lama_available"] = is_available()
    except Exception as e:
        info["lama_error"] = str(e)
    return info