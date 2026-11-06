"""
Giao diện dòng lệnh chính thức (MoeJect CLI Interactive Terminal).
Sử dụng Typer và Rich để cung cấp trải nghiệm dòng lệnh mượt mà, trực quan và hiện đại.
Hỗ trợ các lệnh: sources, search, info, download.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from pathlib import Path
import sys
import threading
from typing import Any, Dict, List, Optional

# Đảm bảo UTF-8 stream trên Windows console
if sys.platform == "win32":
    try:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if sys.stderr and hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeRemainingColumn,
)
from rich.table import Table

from src.api import (
    AVAILABLE_SOURCES,
    get_all_sources_metadata,
    get_source,
    list_sources,
)
from src.core.downloader import ConcurrentMangaDownloader, sanitize_filename
from src.core.models import Chapter, DownloadReport, MangaInfo, OutputFormat
from src.utils.chapter_filter import filter_chapters
from src.utils.dns import enable_smart_dns

# Kích hoạt Smart DNS để chống ISP DNS Poisoning
enable_smart_dns()

logger = logging.getLogger("moeject.cli")
console = Console(legacy_windows=False)
app = typer.Typer(
    name="moeject",
    help="MoeJect CLI - Nền tảng đọc, tìm kiếm và tải Manga đa nguồn thế hệ mới.",
    no_args_is_help=True,
    add_completion=False,
)


@app.command("sources", help="Liệt kê danh sách các nguồn manga khả dụng.")
def cmd_sources() -> None:
    """Hiển thị bảng danh sách các nguồn truyện được hỗ trợ trong hệ thống."""
    sources = get_all_sources_metadata()

    table = Table(
        title="[bold magenta]DANH SÁCH NGUỒN MANGA KHẢ DỤNG[/bold magenta]",
        box=box.ROUNDED,
        header_style="bold cyan",
        title_justify="center",
    )
    table.add_column("Mã nguồn (ID)", style="bold yellow", justify="center", width=14)
    table.add_column("Tên nguồn", style="bold green", width=16)
    table.add_column("Trang chủ", style="blue", width=26)
    table.add_column("Ngôn ngữ", style="white", justify="center", width=12)
    table.add_column("WAF Bypass", style="magenta", justify="center", width=12)
    table.add_column("Trạng thái", style="bold green", justify="center", width=12)
    table.add_column("Mô tả", style="dim", justify="left")

    for s in sources:
        langs = ", ".join(s.get("languages", []))
        waf = "Có (nodriver)" if s.get("needs_browser_bypass") else "API Trực tiếp"
        status = "[green]Hoạt động[/green]" if s.get("status") == "active" else "[yellow]Beta[/yellow]"
        table.add_row(
            s["id"],
            s["name"],
            s["url"],
            langs,
            waf,
            status,
            s.get("description", ""),
        )

    console.print()
    console.print(table)
    console.print(
        f"[dim cyan]Tổng cộng có {len(sources)} nguồn truyện được kích hoạt.[/dim cyan]\n"
    )


@app.command("search", help="Tìm kiếm truyện tranh theo tên từ nguồn chỉ định.")
def cmd_search(
    query: str = typer.Argument(..., help="Tên hoặc từ khóa truyện cần tìm kiếm"),
    source: str = typer.Option(
        "mangadex",
        "--source",
        "-s",
        help="Mã nguồn truyện (vd: mangadex, cuutruyen)",
    ),
    page: int = typer.Option(
        1,
        "--page",
        "-p",
        min=1,
        help="Số trang kết quả tìm kiếm (mặc định: 1)",
    ),
) -> None:
    """Tìm kiếm manga trên nguồn đã chọn và in kết quả dưới dạng bảng Rich Table."""
    source_key = source.strip().lower()
    try:
        src = get_source(source_key)
    except ValueError as e:
        console.print(f"[bold red]Lỗi:[/bold red] {e}")
        raise typer.Exit(code=1)

    async def _do_search():
        async with src:
            return await src.search(query, page=page)

    with console.status(
        f"[bold cyan]Đang tìm kiếm '[bold white]{query}[/bold white]' trên {src.source_name} (Trang {page})...[/bold cyan]"
    ):
        try:
            results = asyncio.run(_do_search())
        except Exception as e:
            console.print(f"[bold red]Lỗi khi tìm kiếm:[/bold red] {e}")
            raise typer.Exit(code=1)

    if not results:
        console.print(
            f"\n[yellow]Không tìm thấy kết quả nào phù hợp với từ khóa '{query}' trên {src.source_name}.[/yellow]\n"
        )
        return

    table = Table(
        title=f"[bold green]KẾT QUẢ TÌM KIẾM: '{query}' ({src.source_name} - Trang {page})[/bold green]",
        box=box.ROUNDED,
        header_style="bold magenta",
        title_justify="center",
    )
    table.add_column("Mã ID", style="bold cyan", justify="center")
    table.add_column("Tên truyện", style="bold white")
    table.add_column("Tác giả", style="yellow")
    table.add_column("Chương mới", style="green", justify="center")
    table.add_column("Thể loại / Ngôn ngữ", style="magenta")

    for item in results:
        authors_str = ", ".join(item.authors[:2]) if item.authors else "Chưa rõ"
        genres_str = ", ".join(item.genres[:3]) if item.genres else "Manga"
        latest_ch = f"Ch.{item.latest_chapter}" if item.latest_chapter else "N/A"
        table.add_row(
            item.id,
            item.title,
            authors_str,
            latest_ch,
            genres_str,
        )

    console.print()
    console.print(table)
    console.print(
        f"[dim]Hiển thị {len(results)} kết quả. Xem chi tiết: [bold cyan]python -m src.cli.main info <ID> --source {source_key}[/bold cyan][/dim]\n"
    )


@app.command("info", help="Xem chi tiết truyện và danh sách chapters.")
def cmd_info(
    manga_id: str = typer.Argument(..., help="ID hoặc URL của bộ manga"),
    source: str = typer.Option(
        "mangadex",
        "--source",
        "-s",
        help="Mã nguồn truyện (vd: mangadex, cuutruyen)",
    ),
    all_chapters: bool = typer.Option(
        False,
        "--all",
        "-a",
        help="Hiển thị toàn bộ danh sách chapters không rút gọn",
    ),
) -> None:
    """Hiển thị thông tin chi tiết và danh sách các chương của truyện."""
    source_key = source.strip().lower()
    try:
        src = get_source(source_key)
    except ValueError as e:
        console.print(f"[bold red]Lỗi:[/bold red] {e}")
        raise typer.Exit(code=1)

    async def _do_info():
        async with src:
            return await src.get_manga_details(manga_id)

    with console.status(
        f"[bold cyan]Đang lấy thông tin chi tiết truyện từ {src.source_name}...[/bold cyan]"
    ):
        try:
            manga_info: MangaInfo = asyncio.run(_do_info())
        except Exception as e:
            console.print(f"[bold red]Lỗi khi trích xuất dữ liệu truyện:[/bold red] {e}")
            raise typer.Exit(code=1)

    # Panel thông tin tổng quan
    authors_text = ", ".join(manga_info.authors) if manga_info.authors else "Chưa rõ"
    genres_text = ", ".join(manga_info.genres) if manga_info.genres else "Chưa cập nhật"
    desc_clean = (manga_info.description or "Không có mô tả.").strip()
    if len(desc_clean) > 300 and not all_chapters:
        desc_clean = desc_clean[:297] + "..."

    summary_content = (
        f"[bold cyan]Tên truyện:[/bold cyan] [bold white]{manga_info.title}[/bold white]\n"
        f"[bold cyan]ID:[/bold cyan] {manga_info.id}\n"
        f"[bold cyan]URL:[/bold cyan] [link={manga_info.url}]{manga_info.url}[/link]\n"
        f"[bold cyan]Tác giả:[/bold cyan] {authors_text}\n"
        f"[bold cyan]Thể loại:[/bold cyan] {genres_text}\n"
        f"[bold cyan]Tổng số chương:[/bold cyan] [bold green]{len(manga_info.chapters)}[/bold green] chương\n"
        f"[bold cyan]Mô tả:[/bold cyan] [dim]{desc_clean}[/dim]"
    )

    console.print()
    console.print(
        Panel(
            summary_content,
            title=f"[bold magenta]THÔNG TIN TRUYỆN: {manga_info.title}[/bold magenta]",
            border_style="cyan",
            box=box.ROUNDED,
            padding=(1, 2),
        )
    )

    if not manga_info.chapters:
        console.print("[yellow]Bộ truyện này hiện chưa có chương nào khả dụng.[/yellow]\n")
        return

    # Bảng danh sách chương
    ch_table = Table(
        title=f"[bold green]DANH SÁCH CHƯƠNG ({len(manga_info.chapters)} chương)[/bold green]",
        box=box.SIMPLE_HEAVY,
        header_style="bold cyan",
    )
    ch_table.add_column("STT", style="dim", justify="center", width=5)
    ch_table.add_column("Chương #", style="bold yellow", justify="center", width=10)
    ch_table.add_column("Tên chương", style="white", width=24)
    ch_table.add_column("Mã ID Chapter", style="cyan", width=36)
    ch_table.add_column("Nhóm dịch", style="magenta", width=16)

    total_ch = len(manga_info.chapters)
    if total_ch <= 30 or all_chapters:
        display_chapters = [(idx + 1, ch) for idx, ch in enumerate(manga_info.chapters)]
        for stt, ch in display_chapters:
            scanlator = ch.scanlator or "Mặc định"
            ch_table.add_row(str(stt), ch.chapter_number, ch.title, ch.id, scanlator)
    else:
        first_chunk = [(idx + 1, ch) for idx, ch in enumerate(manga_info.chapters[:15])]
        last_chunk = [
            (total_ch - 10 + idx + 1, ch)
            for idx, ch in enumerate(manga_info.chapters[-10:])
        ]
        for stt, ch in first_chunk:
            scanlator = ch.scanlator or "Mặc định"
            ch_table.add_row(str(stt), ch.chapter_number, ch.title, ch.id, scanlator)
        ch_table.add_row("...", "...", f"[dim]... và {total_ch - 25} chương khác ...[/dim]", "...", "...")
        for stt, ch in last_chunk:
            scanlator = ch.scanlator or "Mặc định"
            ch_table.add_row(str(stt), ch.chapter_number, ch.title, ch.id, scanlator)

    console.print(ch_table)
    console.print(
        f"[dim]Tải truyện ngay: [bold cyan]python -m src.cli.main download {manga_info.id} --source {source_key} --chapters \"1-5\" --format cbz[/bold cyan][/dim]\n"
    )


@app.command("download", help="Tải truyện tranh với Rich Progress Bar đa tiến trình.")
def cmd_download(
    manga_id_or_url: str = typer.Argument(
        ..., help="ID hoặc URL của manga cần tải về"
    ),
    source: str = typer.Option(
        "mangadex",
        "--source",
        "-s",
        help="Mã nguồn truyện (vd: mangadex, cuutruyen)",
    ),
    chapters: Optional[str] = typer.Option(
        None,
        "--chapters",
        "-c",
        help="Phạm vi chapters cần tải (vd: '1-3, 5', '10.5', 'all'). Mặc định: tất cả",
    ),
    format: str = typer.Option(
        "cbz",
        "--format",
        "-f",
        help="Định dạng đóng gói đầu ra: cbz, zip, images",
    ),
    output_dir: str = typer.Option(
        "downloads",
        "--output-dir",
        "-o",
        help="Thư mục gốc lưu trữ file tải về",
    ),
    chapter_workers: int = typer.Option(
        2,
        "--chapter-workers",
        min=1,
        max=8,
        help="Số chapters được điều phối tải song song",
    ),
    image_workers: int = typer.Option(
        5,
        "--image-workers",
        min=1,
        max=12,
        help="Số luồng tải trang ảnh song song trong mỗi chapter",
    ),
) -> None:
    """
    Tải truyện đa luồng với thanh tiến trình song song:
    - Thanh 1: Tiến độ hoàn thành các Chapter.
    - Thanh 2: Tiến độ tải các trang ảnh chi tiết.
    """
    source_key = source.strip().lower()
    try:
        src = get_source(source_key)
    except ValueError as e:
        console.print(f"[bold red]Lỗi nguồn truyện:[/bold red] {e}")
        raise typer.Exit(code=1)

    fmt_clean = format.strip().lower()
    format_map = {
        "cbz": OutputFormat.CBZ,
        "zip": OutputFormat.ZIP,
        "images": OutputFormat.IMAGES,
        "pdf": OutputFormat.PDF,
    }
    if fmt_clean not in format_map:
        console.print(
            f"[bold red]Định dạng '{format}' không được hỗ trợ.[/bold red] Các định dạng hợp lệ: cbz, zip, images, pdf"
        )
        raise typer.Exit(code=1)
    target_format = format_map[fmt_clean]

    # 1. Trích xuất thông tin Manga
    async def _fetch_meta():
        async with src:
            return await src.get_manga_details(manga_id_or_url)

    with console.status(f"[bold cyan]Đang lấy thông tin manga từ {src.source_name}...[/bold cyan]"):
        try:
            manga_info: MangaInfo = asyncio.run(_fetch_meta())
        except Exception as e:
            console.print(f"[bold red]Không thể lấy thông tin truyện:[/bold red] {e}")
            raise typer.Exit(code=1)

    if not manga_info.chapters:
        console.print("[yellow]Không tìm thấy chapters nào để tải.[/yellow]")
        raise typer.Exit(code=1)

    # 2. Lọc danh sách chapters cần tải
    target_chapters = filter_chapters(manga_info.chapters, selection=chapters)
    if not target_chapters:
        console.print(
            f"[yellow]Không có chapter nào khớp với bộ lọc '{chapters}'.[/yellow]"
        )
        raise typer.Exit(code=1)

    console.print(
        f"\n[bold green]Bộ truyện:[/bold green] [bold white]{manga_info.title}[/bold white]"
    )
    console.print(
        f"[bold green]Số chapters cần tải:[/bold green] [bold cyan]{len(target_chapters)}[/bold cyan] chapters | [bold green]Định dạng:[/bold green] [bold magenta]{target_format.value.upper()}[/bold magenta]"
    )

    # 3. Thu thập URL các trang ảnh cho từng chapter được chọn
    async def _populate_pages():
        async with get_source(source_key) as conn:
            for ch in target_chapters:
                if not ch.pages:
                    try:
                        ch.pages = await conn.get_chapter_pages(ch.id)
                    except Exception as err:
                        logger.warning(f"Lỗi lấy trang chapter {ch.id}: {err}")

    with console.status("[bold cyan]Đang chuẩn bị danh sách liên kết ảnh cho các chapters...[/bold cyan]"):
        asyncio.run(_populate_pages())

    total_images_all = sum(len(ch.pages) for ch in target_chapters)
    if total_images_all == 0:
        console.print("[red]Không thể lấy được liên kết ảnh nào cho các chapters đã chọn.[/red]")
        raise typer.Exit(code=1)

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    downloader = ConcurrentMangaDownloader(
        max_image_workers=image_workers,
        per_host_limit=4,
    )

    # 4. Hiển thị Rich Progress song song: Tiến trình Chapter & Tiến trình Trang ảnh
    reports: List[DownloadReport] = []
    page_lock = threading.Lock()
    chapter_lock = threading.Lock()
    ch_downloaded_pages: Dict[str, int] = {}

    with Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(bar_width=36),
        TaskProgressColumn(),
        MofNCompleteColumn(),
        TimeRemainingColumn(),
        console=console,
        transient=False,
    ) as progress:
        chapter_task = progress.add_task(
            "[bold green]Tiến trình Chapters[/bold green]",
            total=len(target_chapters),
        )
        pages_task = progress.add_task(
            "[bold cyan]Tiến trình Trang ảnh[/bold cyan]",
            total=total_images_all,
        )

        def make_page_callback(ch_id: str):
            def _cb(completed: int, total: int):
                with page_lock:
                    prev = ch_downloaded_pages.get(ch_id, 0)
                    delta = completed - prev
                    if delta > 0:
                        ch_downloaded_pages[ch_id] = completed
                        progress.advance(pages_task, delta)
            return _cb

        def download_single_ch(ch: Chapter) -> DownloadReport:
            cb = make_page_callback(ch.id)
            rep = downloader.download_chapter(
                chapter_or_id=ch,
                manga_info=manga_info,
                output_format=target_format,
                output_dir=out_path,
                stream_to_disk=True,
                progress_callback=cb,
            )
            with chapter_lock:
                progress.advance(chapter_task, 1)
            return rep

        # Điều phối tải chapters
        if chapter_workers <= 1 or len(target_chapters) == 1:
            for ch in target_chapters:
                rep = download_single_ch(ch)
                reports.append(rep)
        else:
            ordered_reports: List[Optional[DownloadReport]] = [None] * len(target_chapters)
            with ThreadPoolExecutor(max_workers=chapter_workers) as executor:
                future_map = {
                    executor.submit(download_single_ch, ch): idx
                    for idx, ch in enumerate(target_chapters)
                }
                for fut in as_completed(future_map):
                    idx = future_map[fut]
                    try:
                        ordered_reports[idx] = fut.result()
                    except Exception as e:
                        ordered_reports[idx] = DownloadReport(
                            chapter_id=target_chapters[idx].id,
                            total_pages=len(target_chapters[idx].pages),
                        )
            reports = [r for r in ordered_reports if r is not None]

    # 5. Tổng kết kết quả sau khi hoàn thành
    success_count = sum(1 for r in reports if r.is_successful)
    fail_count = len(reports) - success_count

    report_table = Table(
        title="[bold magenta]BÁO CÁO KẾT QUẢ TẢI TRUYỆN[/bold magenta]",
        box=box.ROUNDED,
        header_style="bold cyan",
    )
    report_table.add_column("Chương #", style="bold yellow", justify="center", width=12)
    report_table.add_column("Số trang", style="white", justify="center", width=10)
    report_table.add_column("Trạng thái", justify="center", width=14)
    report_table.add_column("Đường dẫn file / Ghi chú", style="dim")

    for ch, rep in zip(target_chapters, reports):
        status_text = "[bold green]Thành công[/bold green]" if rep.is_successful else "[bold red]Lỗi/Chưa xong[/bold red]"
        output_desc = str(rep.output_path) if rep.output_path else (
            f"Lỗi {len(rep.failures)} trang" if rep.failures else "Không có file"
        )
        report_table.add_row(
            ch.chapter_number,
            f"{len(rep.downloaded_pages)}/{rep.total_pages}",
            status_text,
            output_desc,
        )

    console.print()
    console.print(report_table)

    summary_panel = (
        f"[bold]Manga:[/bold] {manga_info.title}\n"
        f"[bold]Tổng số chương hoàn thành:[/bold] [green]{success_count}[/green] / {len(target_chapters)}\n"
        f"[bold]Thư mục lưu trữ:[/bold] [cyan]{out_path.resolve()}[/cyan]"
    )
    console.print(
        Panel(
            summary_panel,
            title="[bold green]TẢI HOÀN TẤT[/bold green]",
            border_style="green" if fail_count == 0 else "yellow",
            box=box.ROUNDED,
        )
    )


if __name__ == "__main__":
    app()
