import os
import sys
from pathlib import Path
from huggingface_hub import HfApi, CommitOperationDelete

def get_hf_token() -> str:
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        return token
    for env_dir in (Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent):
        env_file = env_dir / ".env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line.startswith("HF_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

TARGET_SPACE = "dobietdc/manga-text-cleaner"
BASE_DIR = Path(__file__).resolve().parent / "manga-image-translator-ref"

def sync_and_clean():
    token = get_hf_token()
    if not token:
        print("[!] HF_TOKEN not found in environment or .env file.")
        sys.exit(1)
    api = HfApi(token=token)
    print(f"[*] Target Space: {TARGET_SPACE}")
    print(f"[*] Local source: {BASE_DIR}")

    # 1. Identify local files
    local_files = set()
    for p in BASE_DIR.rglob("*"):
        if p.is_file():
            rel = p.relative_to(BASE_DIR).as_posix()
            if not rel.startswith(".git") and not "__pycache__" in rel and not rel.endswith(".pyc"):
                local_files.add(rel)

    # 2. Identify remote files to delete
    print("[*] Fetching remote file list...")
    remote_files = set(api.list_repo_files(TARGET_SPACE, repo_type="space"))
    to_delete = sorted([
        f for f in remote_files
        if f not in local_files and f != ".gitattributes"
    ])

    if to_delete:
        print(f"[*] Deleting {len(to_delete)} orphan files from Space...")
        # HF create_commit supports batch deletion
        delete_ops = [CommitOperationDelete(path_in_repo=f) for f in to_delete]
        api.create_commit(
            repo_id=TARGET_SPACE,
            repo_type="space",
            operations=delete_ops,
            commit_message=f"Clean {len(to_delete)} redundant files from Space",
        )
        print(f"[+] Successfully deleted {len(to_delete)} redundant files from Space!")
    else:
        print("[+] No orphan files found on Space.")

    # 3. Upload clean local folder
    print("[*] Uploading clean local directory...")
    api.upload_folder(
        folder_path=str(BASE_DIR),
        repo_id=TARGET_SPACE,
        repo_type="space",
        ignore_patterns=[
            ".git*",
            "__pycache__/*",
            "*.pyc",
        ],
        commit_message="Sync clean lightweight manga-image-translator",
    )
    print(f"[+] Sync complete! Space: https://huggingface.co/spaces/{TARGET_SPACE}")

    # 4. Check status
    runtime = api.get_space_runtime(TARGET_SPACE)
    print(f"[*] Current Space Stage: {runtime.stage}")

if __name__ == "__main__":
    sync_and_clean()
