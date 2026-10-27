from fastapi import APIRouter

router = APIRouter(tags=["Debug"])


@router.get("/debug/lama")
async def debug_lama():
    """Report LaMa engine availability (model path, torch build, load state)."""

    info = {}
    try:
        import torch

        info["torch"] = torch.__version__
        info["cuda"] = torch.cuda.is_available()
        info["threads"] = torch.get_num_threads()
    except Exception as e:
        info["torch_error"] = str(e)
    try:
        from app.services.inpainting import lama_engine

        info.update(lama_engine.status())
        info["model_dir_exists"] = lama_engine.MODEL_DIR.exists()
        info["lama_available"] = lama_engine.is_available()
    except Exception as e:
        info["lama_error"] = str(e)
    return info
