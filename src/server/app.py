"""
REST API Server chính thức của dự án MoeJect xây dựng trên FastAPI.
Cung cấp endpoints tìm kiếm, xem chi tiết manga, và quản lý tác vụ tải ngầm (Background Tasks)
cho các Frontend client (Flutter Mobile, Desktop GUI, Web).
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
from pathlib import Path
import threading
import time
from typing import Any, Dict, List, Optional
import uuid

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from src.server.web_app import WEB_APP_HTML

from src.api import (
    AVAILABLE_SOURCES,
    get_all_sources_metadata,
    get_source,
    list_sources,
)
from src.core.downloader import ConcurrentMangaDownloader
from src.core.models import Chapter, DownloadReport, MangaInfo, OutputFormat
from src.utils.chapter_filter import filter_chapters
from src.utils.dns import enable_smart_dns

# Kích hoạt Smart DNS tự động vượt chặn ISP
try:
    enable_smart_dns()
except Exception:
    pass

logger = logging.getLogger("moeject.server")

# ==========================================
# PYDANTIC DATA TRANSFER OBJECTS (SCHEMAS)
# ==========================================


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "MoeJect REST API"
    version: str = "1.0.0"
    timestamp: float = Field(default_factory=time.time)


class SourceItem(BaseModel):
    id: str
    name: str
    url: str
    languages: List[str]
    description: str
    needs_browser_bypass: bool
    status: str


class SourcesResponse(BaseModel):
    sources: List[SourceItem]


class MangaSearchResultSchema(BaseModel):
    id: str
    title: str
    url: str
    cover_url: Optional[str] = None
    latest_chapter: Optional[str] = None
    description: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    genres: List[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    source: str
    query: str
    page: int
    total: int
    results: List[MangaSearchResultSchema]


class ChapterSchema(BaseModel):
    id: str
    title: str
    chapter_number: str
    url: str
    scanlator: Optional[str] = None
    pages_count: int = 0


class MangaDetailResponse(BaseModel):
    id: str
    title: str
    url: str
    cover_url: Optional[str] = None
    description: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    genres: List[str] = Field(default_factory=list)
    total_chapters: int = 0
    chapters: List[ChapterSchema] = Field(default_factory=list)


class DownloadRequest(BaseModel):
    source: str = Field("mangadex", description="Mã nguồn truyện (mangadex, cuutruyen)")
    manga_id: str = Field(..., description="Mã định danh hoặc URL bộ manga")
    chapter_ids: Optional[List[str]] = Field(
        None, description="Danh sách các chapter ID cụ thể cần tải"
    )
    chapters: Optional[str] = Field(
        None, description="Chuỗi biểu thức phạm vi chapter (vd: '1-3, 5', '10.5', 'all')"
    )
    format: str = Field("cbz", description="Định dạng đóng gói file: cbz, zip, images, pdf")
    output_dir: Optional[str] = Field("downloads", description="Thư mục lưu trữ kết quả")
    max_chapter_workers: Optional[int] = Field(2, ge=1, le=8, description="Số chapters tải đồng thời")
    max_image_workers: Optional[int] = Field(5, ge=1, le=12, description="Số luồng tải ảnh mỗi chapter")


class DownloadInitResponse(BaseModel):
    task_id: str
    status: str = "pending"
    message: str


class ChapterDownloadStatus(BaseModel):
    chapter_id: str
    chapter_number: str
    status: str  # "success" | "failed"
    pages_downloaded: int = 0
    total_pages: int = 0
    output_path: Optional[str] = None
    error: Optional[str] = None


class DownloadTaskProgress(BaseModel):
    total_chapters: int = 0
    completed_chapters: int = 0
    total_pages: int = 0
    completed_pages: int = 0
    percent: float = 0.0


class DownloadTaskStatusResponse(BaseModel):
    task_id: str
    status: str  # "pending", "running", "completed", "failed"
    source: str
    manga_id: str
    manga_title: Optional[str] = None
    format: str
    progress: DownloadTaskProgress
    results: List[ChapterDownloadStatus] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    created_at: float
    updated_at: float


# ==========================================
# IN-MEMORY BACKGROUND TASK MANAGER
# ==========================================


class DownloadTaskManager:
    """Quản lý trạng thái và tiến độ của các tác vụ tải ngầm (thread-safe)."""

    def __init__(self):
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create_task(self, task_id: str, req: DownloadRequest) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            task_data = {
                "task_id": task_id,
                "status": "pending",
                "source": req.source,
                "manga_id": req.manga_id,
                "manga_title": None,
                "format": req.format.lower(),
                "progress": {
                    "total_chapters": 0,
                    "completed_chapters": 0,
                    "total_pages": 0,
                    "completed_pages": 0,
                    "percent": 0.0,
                },
                "results": [],
                "errors": [],
                "created_at": now,
                "updated_at": now,
            }
            self._tasks[task_id] = task_data
            return task_data

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            # Return deep-copy of dict structure
            return {
                "task_id": task["task_id"],
                "status": task["status"],
                "source": task["source"],
                "manga_id": task["manga_id"],
                "manga_title": task["manga_title"],
                "format": task["format"],
                "progress": dict(task["progress"]),
                "results": list(task["results"]),
                "errors": list(task["errors"]),
                "created_at": task["created_at"],
                "updated_at": task["updated_at"],
            }

    def update_task(self, task_id: str, **kwargs) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(kwargs)
                self._tasks[task_id]["updated_at"] = time.time()

    def update_progress(
        self,
        task_id: str,
        completed_pages: Optional[int] = None,
        total_pages: Optional[int] = None,
        completed_chapters: Optional[int] = None,
        total_chapters: Optional[int] = None,
    ) -> None:
        with self._lock:
            if task_id in self._tasks:
                prog = self._tasks[task_id]["progress"]
                if completed_pages is not None:
                    prog["completed_pages"] = completed_pages
                if total_pages is not None:
                    prog["total_pages"] = total_pages
                if completed_chapters is not None:
                    prog["completed_chapters"] = completed_chapters
                if total_chapters is not None:
                    prog["total_chapters"] = total_chapters

                tot_p = prog.get("total_pages", 0)
                cur_p = prog.get("completed_pages", 0)
                if tot_p > 0:
                    prog["percent"] = round(min(100.0, (cur_p / tot_p) * 100), 2)
                self._tasks[task_id]["updated_at"] = time.time()

    def add_result(self, task_id: str, result: Dict[str, Any]) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id]["results"].append(result)
                self._tasks[task_id]["updated_at"] = time.time()

    def add_error(self, task_id: str, error_msg: str) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id]["errors"].append(error_msg)
                self._tasks[task_id]["updated_at"] = time.time()


task_manager = DownloadTaskManager()
_worker_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="moeject_bg_worker")


def _run_download_task_worker(task_id: str, req_data: Dict[str, Any]) -> None:
    """Hàm worker chạy trên luồng nền riêng biệt để xử lý tải và cập nhật tiến trình."""
    source_name = req_data["source"]
    manga_id = req_data["manga_id"]
    chapter_ids = req_data.get("chapter_ids")
    chapters_expr = req_data.get("chapters")
    format_str = req_data.get("format", "cbz").lower()
    output_dir_str = req_data.get("output_dir", "downloads")
    max_chapter_workers = req_data.get("max_chapter_workers", 2)
    max_image_workers = req_data.get("max_image_workers", 5)

    format_map = {
        "cbz": OutputFormat.CBZ,
        "zip": OutputFormat.ZIP,
        "images": OutputFormat.IMAGES,
        "pdf": OutputFormat.PDF,
    }
    output_format = format_map.get(format_str, OutputFormat.CBZ)
    output_path = Path(output_dir_str)
    output_path.mkdir(parents=True, exist_ok=True)

    task_manager.update_task(task_id, status="running")

    try:
        # 1. Khởi tạo connector và lấy metadata manga (async)
        src = get_source(source_name)

        async def _fetch_metadata():
            async with src:
                info = await src.get_manga_details(manga_id)
                target_chs = filter_chapters(
                    info.chapters, selection=chapters_expr, explicit_ids=chapter_ids
                )
                for ch in target_chs:
                    if not ch.pages:
                        try:
                            ch.pages = await src.get_chapter_pages(ch.id)
                        except Exception as e:
                            logger.warning(f"Lỗi lấy link ảnh chapter {ch.id}: {e}")
                return info, target_chs

        manga_info, target_chapters = asyncio.run(_fetch_metadata())
        task_manager.update_task(task_id, manga_title=manga_info.title)

        if not target_chapters:
            task_manager.add_error(task_id, "Không tìm thấy chapter nào phù hợp để tải.")
            task_manager.update_task(task_id, status="failed")
            return

        total_pages_all = sum(len(c.pages) for c in target_chapters)
        task_manager.update_progress(
            task_id,
            total_chapters=len(target_chapters),
            completed_chapters=0,
            total_pages=total_pages_all,
            completed_pages=0,
        )

        downloader = ConcurrentMangaDownloader(
            max_image_workers=max_image_workers,
            per_host_limit=4,
        )

        page_lock = threading.Lock()
        completed_pages_tracker: Dict[str, int] = {}
        total_finished_pages = 0
        total_finished_chapters = 0

        def _make_page_cb(ch_id: str):
            def _cb(done: int, tot: int):
                nonlocal total_finished_pages
                with page_lock:
                    prev = completed_pages_tracker.get(ch_id, 0)
                    delta = done - prev
                    if delta > 0:
                        completed_pages_tracker[ch_id] = done
                        total_finished_pages += delta
                        task_manager.update_progress(
                            task_id, completed_pages=total_finished_pages
                        )
            return _cb

        # 2. Điều phối tải chapters
        for ch in target_chapters:
            cb = _make_page_cb(ch.id)
            report = downloader.download_chapter(
                chapter_or_id=ch,
                manga_info=manga_info,
                output_format=output_format,
                output_dir=output_path,
                stream_to_disk=True,
                progress_callback=cb,
            )

            total_finished_chapters += 1
            task_manager.update_progress(
                task_id, completed_chapters=total_finished_chapters
            )

            res_entry = {
                "chapter_id": ch.id,
                "chapter_number": ch.chapter_number,
                "status": "success" if report.is_successful else "failed",
                "pages_downloaded": len(report.downloaded_pages),
                "total_pages": report.total_pages,
                "output_path": str(report.output_path) if report.output_path else None,
                "error": str(report.failures[0].message) if report.failures else None,
            }
            task_manager.add_result(task_id, res_entry)

        # Đánh dấu trạng thái cuối cùng
        task_curr = task_manager.get_task(task_id)
        if task_curr:
            has_success = any(r["status"] == "success" for r in task_curr["results"])
            final_status = "completed" if has_success else "failed"
            task_manager.update_task(task_id, status=final_status)

    except Exception as exc:
        logger.error(f"[Task {task_id}] Lỗi xử lý tải ngầm: {exc}", exc_info=True)
        task_manager.add_error(task_id, str(exc))
        task_manager.update_task(task_id, status="failed")


# ==========================================
# FASTAPI APPLICATION SETUP
# ==========================================

app = FastAPI(
    title="MoeJect REST API",
    description="REST API điều phối tìm kiếm, bóc tách và tải truyện tranh Manga đa nguồn cho Frontend Clients.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Thêm CORS Middleware cho phép mọi client (Flutter Mobile, Desktop GUI, Web) gọi tới API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# REST API ENDPOINTS
# ==========================================


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def serve_web_app():
    """Giao diện Web App tương tác của MoeJect phục vụ nghiệm thu tức thì."""
    return HTMLResponse(content=WEB_APP_HTML)


@app.get("/api/health", response_model=HealthResponse, tags=["System"])
async def health_check() -> HealthResponse:
    """Kiểm tra tình trạng hoạt động của REST API server (Healthcheck)."""
    return HealthResponse()


@app.get("/api/sources", response_model=SourcesResponse, tags=["Sources"])
async def get_available_sources() -> SourcesResponse:
    """Trả về danh sách tất cả các nguồn truyện tranh khả dụng trong hệ thống."""
    sources = get_all_sources_metadata()
    return SourcesResponse(
        sources=[
            SourceItem(
                id=s["id"],
                name=s["name"],
                url=s["url"],
                languages=s["languages"],
                description=s["description"],
                needs_browser_bypass=s["needs_browser_bypass"],
                status=s["status"],
            )
            for s in sources
        ]
    )


@app.get("/api/search", response_model=SearchResponse, tags=["Manga"])
async def search_manga(
    source: str = Query("mangadex", description="Mã nguồn truyện (vd: mangadex, cuutruyen)"),
    q: str = Query(..., min_length=1, description="Từ khóa tìm kiếm"),
    page: int = Query(1, ge=1, description="Số trang kết quả"),
) -> SearchResponse:
    """Tìm kiếm truyện tranh theo từ khóa từ nguồn chỉ định."""
    source_key = source.strip().lower()
    try:
        src = get_source(source_key)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    try:
        async with src:
            results = await src.search(query=q, page=page)
    except Exception as exc:
        logger.error(f"Lỗi khi tìm kiếm trên nguồn '{source_key}': {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Lỗi kết nối tới nguồn {source_key}: {str(exc)}",
        )

    items = [
        MangaSearchResultSchema(
            id=r.id,
            title=r.title,
            url=r.url,
            cover_url=r.cover_url,
            latest_chapter=r.latest_chapter,
            description=r.description,
            authors=r.authors,
            genres=r.genres,
        )
        for r in results
    ]

    return SearchResponse(
        source=source_key,
        query=q,
        page=page,
        total=len(items),
        results=items,
    )


@app.get("/api/manga/{source}/{manga_id}", response_model=MangaDetailResponse, tags=["Manga"])
async def get_manga_detail(
    source: str,
    manga_id: str,
) -> MangaDetailResponse:
    """Lấy thông tin chi tiết của bộ truyện cùng toàn bộ danh sách chapters."""
    source_key = source.strip().lower()
    try:
        src = get_source(source_key)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    try:
        async with src:
            manga_info = await src.get_manga_details(manga_id)
    except Exception as exc:
        logger.error(f"Lỗi khi lấy thông tin truyện '{manga_id}' trên {source_key}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Không thể lấy thông tin truyện từ nguồn {source_key}: {str(exc)}",
        )

    chapters_list = [
        ChapterSchema(
            id=c.id,
            title=c.title,
            chapter_number=c.chapter_number,
            url=c.url,
            scanlator=c.scanlator,
            pages_count=len(c.pages),
        )
        for c in manga_info.chapters
    ]

    return MangaDetailResponse(
        id=manga_info.id,
        title=manga_info.title,
        url=manga_info.url,
        cover_url=manga_info.cover_url,
        description=manga_info.description,
        authors=manga_info.authors,
        genres=manga_info.genres,
        total_chapters=len(chapters_list),
        chapters=chapters_list,
    )


@app.post(
    "/api/download",
    response_model=DownloadInitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Downloader"],
)
async def create_download_task(
    payload: DownloadRequest,
    background_tasks: BackgroundTasks,
) -> DownloadInitResponse:
    """
    Khởi tạo tác vụ tải truyện chạy ngầm (Background Task).
    Hỗ trợ tải theo chapter_ids cụ thể hoặc cú pháp dải chapters (vd: '1-5, 8').
    """
    source_key = payload.source.strip().lower()
    if source_key not in AVAILABLE_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nguồn '{payload.source}' không hợp lệ. Các nguồn hỗ trợ: {list(AVAILABLE_SOURCES.keys())}",
        )

    valid_formats = {"cbz", "zip", "images", "pdf"}
    if payload.format.strip().lower() not in valid_formats:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Định dạng '{payload.format}' không được hỗ trợ. Các định dạng hợp lệ: {list(valid_formats)}",
        )

    task_id = str(uuid.uuid4())
    task_manager.create_task(task_id, payload)

    # Chạy worker qua ThreadPoolExecutor để không làm block async loop
    payload_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    _worker_pool.submit(_run_download_task_worker, task_id, payload_dict)

    return DownloadInitResponse(
        task_id=task_id,
        status="pending",
        message="Tác vụ tải truyện đã được khởi tạo thành công.",
    )


@app.get(
    "/api/download/{task_id}",
    response_model=DownloadTaskStatusResponse,
    tags=["Downloader"],
)
async def get_download_task_status(task_id: str) -> DownloadTaskStatusResponse:
    """Tra cứu trạng thái, tiến độ chi tiết và đường dẫn kết quả của tác vụ tải ngầm."""
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy tác vụ tải với ID '{task_id}'.",
        )

    return DownloadTaskStatusResponse(
        task_id=task["task_id"],
        status=task["status"],
        source=task["source"],
        manga_id=task["manga_id"],
        manga_title=task.get("manga_title"),
        format=task["format"],
        progress=DownloadTaskProgress(**task["progress"]),
        results=[ChapterDownloadStatus(**r) for r in task["results"]],
        errors=task["errors"],
        created_at=task["created_at"],
        updated_at=task["updated_at"],
    )
