"""Unit tests for job_engine.py."""
import asyncio
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "colab-backend"))

from job_engine import MangaJobEngine, JobStatus


def test_job_lifecycle():
    engine = MangaJobEngine(max_concurrent_gpu=1)

    # 1. Create Job
    pages_data = [
        {"page_id": "page_001", "imageBase64": "mock_b64_1"},
        {"page_id": "page_002", "imageBase64": "mock_b64_2"},
        {"page_id": "page_003", "imageBase64": "mock_b64_3"},
    ]
    job = engine.create_job(pages_data, default_options={"cleanSFX": True})

    assert job.status == JobStatus.QUEUED
    assert job.total_pages == 3
    assert len(job.pages) == 3

    # Summary snapshot
    summary = job.to_summary_dict()
    assert summary["job_id"] == job.job_id
    assert summary["total_pages"] == 3
    assert summary["completed_pages"] == 0
    assert summary["progress_percent"] == 0.0

    # 2. Get Job
    retrieved = engine.get_job(job.job_id)
    assert retrieved is not None
    assert retrieved.job_id == job.job_id

    # 3. Cancel Job
    cancelled = engine.cancel_job(job.job_id)
    assert cancelled is True
    assert job.status == JobStatus.CANCELLED


async def test_sse_subscription():
    engine = MangaJobEngine(max_concurrent_gpu=1)
    pages_data = [{"page_id": "p1", "imageBase64": "mock"}]
    job = engine.create_job(pages_data)

    # Subscribe to SSE
    stream = engine.subscribe_stream(job.job_id)
    first_event = await anext(stream)

    assert "event: init" in first_event
    assert job.job_id in first_event

    engine.cancel_job(job.job_id)


if __name__ == "__main__":
    test_job_lifecycle()
    asyncio.run(test_sse_subscription())
    print("All Python Job Engine tests passed successfully!")
