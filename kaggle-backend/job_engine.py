"""
job_engine.py - Hệ thống điều phối Async Job Engine & Server-Sent Events (SSE).
Hỗ trợ xử lý Batch hàng chục trang truyện manga mà không bao giờ bị nghẽn (No-Timeout, Resumable).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional
from PIL import Image

logger = logging.getLogger("manga_cleaner.job_engine")


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class JobPageItem:
    page_id: str
    index: int
    image_base64: Optional[str] = None
    image_url: Optional[str] = None
    options: Dict[str, Any] = field(default_factory=dict)
    status: str = "pending"  # "pending" | "processing" | "done" | "error"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    duration_ms: float = 0.0


@dataclass
class MangaJob:
    job_id: str
    status: JobStatus = JobStatus.QUEUED
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    total_pages: int = 0
    completed_pages: int = 0
    failed_pages: int = 0
    pages: List[JobPageItem] = field(default_factory=list)
    subscribers: List[asyncio.Queue] = field(default_factory=list)

    def to_summary_dict(self) -> Dict[str, Any]:
        """Tóm tắt trạng thái tiến độ nhẹ để client poll hoặc theo dõi."""
        pct = round((self.completed_pages / max(1, self.total_pages)) * 100, 1)
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "total_pages": self.total_pages,
            "completed_pages": self.completed_pages,
            "failed_pages": self.failed_pages,
            "progress_percent": pct,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "elapsed_seconds": round(time.time() - self.created_at, 1),
        }

    def to_full_dict(self) -> Dict[str, Any]:
        """Dữ liệu chi tiết toàn bộ các trang và kết quả (Layers + Cleaned Image)."""
        summary = self.to_summary_dict()
        summary["pages"] = [
            {
                "page_id": p.page_id,
                "index": p.index,
                "status": p.status,
                "duration_ms": p.duration_ms,
                "error": p.error,
                "result": p.result,
            }
            for p in self.pages
        ]
        return summary


class MangaJobEngine:
    def __init__(self, max_concurrent_gpu: int = 1):
        self.jobs: Dict[str, MangaJob] = {}
        self.semaphore = asyncio.Semaphore(max_concurrent_gpu)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task] = None
        self._is_running = False

    def start(self):
        """Khởi động background worker loop."""
        if not self._is_running:
            self._is_running = True
            self._worker_task = asyncio.create_task(self._worker_loop())
            logger.info("Async Job Engine worker loop started.")

    async def stop(self):
        """Dừng an toàn engine."""
        self._is_running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

    def create_job(
        self,
        pages_data: List[Dict[str, Any]],
        default_options: Optional[Dict[str, Any]] = None,
    ) -> MangaJob:
        """Tạo một Job mới chứa danh sách các trang và xếp vào hàng đợi."""
        job_id = f"job_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        default_options = default_options or {}

        page_items: List[JobPageItem] = []
        for idx, item in enumerate(pages_data, start=1):
            opts = {**default_options, **(item.get("options") or {})}
            page_id = item.get("page_id") or f"page_{idx:03d}"
            page_items.append(
                JobPageItem(
                    page_id=page_id,
                    index=idx,
                    image_base64=item.get("imageBase64") or item.get("image"),
                    image_url=item.get("imageUrl"),
                    options=opts,
                )
            )

        job = MangaJob(
            job_id=job_id,
            total_pages=len(page_items),
            pages=page_items,
        )
        self.jobs[job_id] = job
        self._queue.put_nowait(job_id)
        logger.info("Created job %s with %d pages", job_id, len(page_items))
        return job

    def get_job(self, job_id: str) -> Optional[MangaJob]:
        return self.jobs.get(job_id)

    def cancel_job(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job:
            return False
        if job.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
            job.status = JobStatus.CANCELLED
            job.updated_at = time.time()
            self._broadcast(job, "job_cancelled", {"job_id": job_id})
            return True
        return False

    def _broadcast(self, job: MangaJob, event_name: str, payload: Dict[str, Any]):
        """Bắn sự kiện Server-Sent Event tới toàn bộ subscriber đang lắng nghe."""
        raw_msg = f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
        dead_subscribers = []
        for q in job.subscribers:
            try:
                q.put_nowait(raw_msg)
            except asyncio.QueueFull:
                dead_subscribers.append(q)

        for d in dead_subscribers:
            if d in job.subscribers:
                job.subscribers.remove(d)

    async def subscribe_stream(self, job_id: str) -> AsyncGenerator[str, None]:
        """Tạo stream SSE cho client kết nối theo thời gian thực."""
        job = self.jobs.get(job_id)
        if not job:
            yield f"event: error\ndata: {json.dumps({'error': 'Job not found'})}\n\n"
            return

        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        job.subscribers.append(q)

        # Gửi sự kiện ban đầu
        yield f"event: init\ndata: {json.dumps(job.to_summary_dict(), ensure_ascii=False)}\n\n"

        # Nếu job đã xong trước khi client kết nối
        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            yield f"event: job_completed\ndata: {json.dumps(job.to_full_dict(), ensure_ascii=False)}\n\n"
            job.subscribers.remove(q)
            return

        try:
            while True:
                msg = await q.get()
                yield msg
                if "job_completed" in msg or "job_cancelled" in msg:
                    break
        finally:
            if q in job.subscribers:
                job.subscribers.remove(q)

    async def _worker_loop(self):
        """Vòng lặp tiêu thụ Job theo hàng đợi tuần tự bảo vệ VRAM GPU."""
        from manga_cleaner import cleaner_pipeline

        while self._is_running:
            job_id = await self._queue.get()
            job = self.jobs.get(job_id)
            if not job or job.status == JobStatus.CANCELLED:
                self._queue.task_done()
                continue

            job.status = JobStatus.PROCESSING
            job.updated_at = time.time()
            self._broadcast(job, "job_started", job.to_summary_dict())

            async with self.semaphore:
                for page_item in job.pages:
                    if job.status == JobStatus.CANCELLED:
                        break

                    page_item.status = "processing"
                    self._broadcast(
                        job,
                        "page_processing",
                        {"page_id": page_item.page_id, "index": page_item.index},
                    )

                    t_start = time.perf_counter()
                    try:
                        # 1. Giải mã ảnh PIL
                        raw_b64 = page_item.image_base64 or ""
                        if not raw_b64 and page_item.image_url:
                            # Tải từ URL nếu cần
                            import httpx
                            async with httpx.AsyncClient(timeout=30) as client:
                                r = await client.get(page_item.image_url)
                                raw_bytes = r.content
                        elif raw_b64:
                            clean_b64 = raw_b64.split(",", 1)[1] if "," in raw_b64 else raw_b64
                            import base64
                            raw_bytes = base64.b64decode(clean_b64)
                        else:
                            raise ValueError("Không tìm thấy dữ liệu ảnh.")

                        from PIL import Image, ImageOps
                        img_pil = Image.open(io.BytesIO(raw_bytes))
                        img_pil = ImageOps.exif_transpose(img_pil).convert("RGB")

                        opts = page_item.options
                        cleaned_pil, color_mask_pil, stats = await asyncio.to_thread(
                            cleaner_pipeline.clean_image,
                            image_input=img_pil,
                            clean_sfx=bool(opts.get("cleanSFX", False)),
                            dilation_px=int(opts.get("dilationPx", 4)),
                            det_threshold=float(opts.get("detThreshold", 0.20)),
                            inpaint_model=str(opts.get("inpaintModel", "anime-lama")),
                            reading_direction=str(opts.get("readingDirection", "rtl")),
                        )

                        # Chuyển đổi kết quả sang base64
                        import base64
                        buf_clean = io.BytesIO()
                        cleaned_pil.save(buf_clean, format="PNG", compress_level=1)
                        clean_b64 = base64.b64encode(buf_clean.getvalue()).decode("ascii")

                        buf_mask = io.BytesIO()
                        color_mask_pil.save(buf_mask, format="PNG", compress_level=1)
                        mask_b64 = base64.b64encode(buf_mask.getvalue()).decode("ascii")

                        duration_ms = round((time.perf_counter() - t_start) * 1000.0, 1)
                        page_item.status = "done"
                        page_item.duration_ms = duration_ms
                        page_item.result = {
                            "cleanedImageBase64": f"data:image/png;base64,{clean_b64}",
                            "colorMaskBase64": f"data:image/png;base64,{mask_b64}",
                            "layers": stats.get("layers", []),
                            "stats": stats,
                        }
                        job.completed_pages += 1

                        self._broadcast(
                            job,
                            "page_done",
                            {
                                "page_id": page_item.page_id,
                                "index": page_item.index,
                                "duration_ms": duration_ms,
                                "layers_count": len(stats.get("layers", [])),
                                "progress": job.to_summary_dict(),
                            },
                        )
                    except Exception as exc:
                        logger.exception("Error processing page %s in job %s", page_item.page_id, job_id)
                        page_item.status = "error"
                        page_item.error = str(exc)
                        page_item.duration_ms = round((time.perf_counter() - t_start) * 1000.0, 1)
                        job.failed_pages += 1

                        self._broadcast(
                            job,
                            "page_error",
                            {
                                "page_id": page_item.page_id,
                                "index": page_item.index,
                                "error": str(exc),
                                "progress": job.to_summary_dict(),
                            },
                        )

                    job.updated_at = time.time()

            if job.status != JobStatus.CANCELLED:
                job.status = JobStatus.COMPLETED if job.failed_pages == 0 else JobStatus.COMPLETED
                job.updated_at = time.time()
                self._broadcast(job, "job_completed", job.to_summary_dict())

            self._queue.task_done()


# Global Singleton instance
job_engine = MangaJobEngine(max_concurrent_gpu=1)
