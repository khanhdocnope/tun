"""
Unit tests toàn diện cho module formats (zip_packager, cbz) và core downloader (Two-Tier Concurrency, Streaming Memory).
"""

import io
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock
import xml.etree.ElementTree as ET
import zipfile
from PIL import Image

from src.core.models import MangaInfo, Chapter, OutputFormat, ImageFailure, DownloadReport
from src.core.downloader import (
    HostConnectionGate,
    validate_image_bytes,
    detect_image_extension,
    sanitize_filename,
    resolve_chapter_output_path,
    ConcurrentMangaDownloader,
    download_manga_chapters,
)
from src.formats.zip_packager import create_chapter_zip, ZipStreamPackager
from src.formats.cbz import (
    generate_comic_info_xml,
    create_chapter_cbz,
    CBZStreamPackager,
    export_to_cbz,
)


def create_dummy_image_bytes(color=(255, 0, 0), format="WEBP") -> bytes:
    """Tạo byte ảnh hợp lệ phục vụ unit test."""
    buf = io.BytesIO()
    img = Image.new("RGB", (32, 32), color)
    img.save(buf, format=format)
    return buf.getvalue()


class TestZipPackager(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_create_chapter_zip_standard_naming_and_deflated(self):
        img1 = create_dummy_image_bytes(color=(255, 0, 0))
        img2 = create_dummy_image_bytes(color=(0, 255, 0))
        pages = [(0, img1), (1, img2)]

        out_zip = self.test_dir / "chapter_01.zip"
        res_path = create_chapter_zip(out_zip, pages, extension="webp")

        self.assertTrue(res_path.exists())
        self.assertEqual(res_path, out_zip)

        with zipfile.ZipFile(res_path, "r") as zf:
            names = zf.namelist()
            self.assertEqual(names, ["001.webp", "002.webp"])
            # Kiểm tra compression method
            info = zf.getinfo("001.webp")
            self.assertEqual(info.compress_type, zipfile.ZIP_DEFLATED)
            self.assertEqual(zf.read("001.webp"), img1)
            self.assertEqual(zf.read("002.webp"), img2)

    def test_zip_stream_packager(self):
        out_zip = self.test_dir / "stream_chap.zip"
        img1 = create_dummy_image_bytes()
        img2 = create_dummy_image_bytes()

        with ZipStreamPackager(out_zip, total_pages=2, extension="webp") as packager:
            packager.add_page(0, img1)
            packager.add_page(1, img2)

        self.assertTrue(out_zip.exists())
        self.assertFalse(out_zip.with_suffix(".zip.tmp").exists())

        with zipfile.ZipFile(out_zip, "r") as zf:
            self.assertEqual(zf.namelist(), ["001.webp", "002.webp"])

    def test_zip_stream_packager_abort_cleans_tmp(self):
        out_zip = self.test_dir / "aborted.zip"
        packager = ZipStreamPackager(out_zip, total_pages=2)
        packager.add_page(0, create_dummy_image_bytes())
        tmp_file = out_zip.with_suffix(".zip.tmp")
        self.assertTrue(tmp_file.exists())

        packager.abort()
        self.assertFalse(tmp_file.exists())
        self.assertFalse(out_zip.exists())


class TestCBZPackager(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())
        self.manga_info = MangaInfo(
            id="one-piece",
            title="One Piece",
            url="https://example.com/one-piece",
            authors=["Eiichiro Oda"],
            genres=["Action", "Adventure", "Fantasy"],
            description="Vua hải tặc tương lai Monkey D. Luffy."
        )
        self.chapter = Chapter(
            id="ch-1000",
            title="Straw Hat Luffy",
            chapter_number="1000",
            url="https://example.com/one-piece/1000",
            scanlator="MoeJect Scanlation"
        )

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_generate_comic_info_xml(self):
        xml_str = generate_comic_info_xml(self.manga_info, self.chapter, page_count=20)
        self.assertIn("<?xml version=\"1.0\" encoding=\"utf-8\"?>", xml_str)
        self.assertIn("<ComicInfo", xml_str)

        root = ET.fromstring(xml_str)
        self.assertEqual(root.tag, "ComicInfo")
        self.assertEqual(root.findtext("Title"), "Straw Hat Luffy")
        self.assertEqual(root.findtext("Series"), "One Piece")
        self.assertEqual(root.findtext("Number"), "1000")
        self.assertEqual(root.findtext("Writer"), "Eiichiro Oda")
        self.assertEqual(root.findtext("Genre"), "Action, Adventure, Fantasy")
        self.assertEqual(root.findtext("Summary"), "Vua hải tặc tương lai Monkey D. Luffy.")
        self.assertEqual(root.findtext("PageCount"), "20")
        self.assertEqual(root.findtext("ScanInformation"), "MoeJect Scanlation")
        self.assertEqual(root.findtext("Web"), "https://example.com/one-piece/1000")
        self.assertEqual(root.findtext("Manga"), "YesAndRightToLeft")

    def test_create_chapter_cbz(self):
        img1 = create_dummy_image_bytes(color=(10, 20, 30))
        img2 = create_dummy_image_bytes(color=(40, 50, 60))
        pages = [(0, img1), (1, img2)]

        out_cbz = self.test_dir / "One_Piece_Ch1000.cbz"
        res_path = create_chapter_cbz(out_cbz, self.manga_info, self.chapter, pages, extension="webp")

        self.assertTrue(res_path.exists())
        with zipfile.ZipFile(res_path, "r") as cbz:
            names = cbz.namelist()
            self.assertIn("ComicInfo.xml", names)
            self.assertIn("001.webp", names)
            self.assertIn("002.webp", names)

            # Đảm bảo ComicInfo.xml hợp lệ
            xml_data = cbz.read("ComicInfo.xml").decode("utf-8")
            root = ET.fromstring(xml_data)
            self.assertEqual(root.findtext("Title"), "Straw Hat Luffy")
            self.assertEqual(root.findtext("PageCount"), "2")

    def test_cbz_stream_packager(self):
        out_cbz = self.test_dir / "streamed_ch.cbz"
        img1 = create_dummy_image_bytes()

        with CBZStreamPackager(out_cbz, self.manga_info, self.chapter, total_pages=1, extension="webp") as packager:
            packager.add_page(0, img1)

        self.assertTrue(out_cbz.exists())
        with zipfile.ZipFile(out_cbz, "r") as cbz:
            self.assertIn("ComicInfo.xml", cbz.namelist())
            self.assertIn("001.webp", cbz.namelist())

    def test_legacy_export_to_cbz(self):
        img1 = create_dummy_image_bytes()
        out_cbz = self.test_dir / "legacy.cbz"
        export_to_cbz(out_cbz, [(0, img1)], extension="webp")
        self.assertTrue(out_cbz.exists())
        with zipfile.ZipFile(out_cbz, "r") as cbz:
            self.assertIn("ComicInfo.xml", cbz.namelist())
            self.assertIn("001.webp", cbz.namelist())


class TestCoreDownloader(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp())
        self.manga_info = MangaInfo(
            id="frieren",
            title="Sousou no Frieren",
            url="https://example.com/frieren",
            authors=["Kanehito Yamada"],
            genres=["Fantasy", "Drama"],
            description="Hành trình sau cái chết của dũng sĩ Himmel."
        )

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_validate_image_bytes(self):
        valid_webp = create_dummy_image_bytes(format="WEBP")
        valid_png = create_dummy_image_bytes(format="PNG")
        valid_jpeg = create_dummy_image_bytes(format="JPEG")
        fake_html = b"<html><head><title>Cloudflare 403 Forbidden</title></head><body>WAF challenge</body></html>"

        self.assertTrue(validate_image_bytes(valid_webp))
        self.assertTrue(validate_image_bytes(valid_png))
        self.assertTrue(validate_image_bytes(valid_jpeg))
        self.assertFalse(validate_image_bytes(fake_html))
        self.assertFalse(validate_image_bytes(b""))

    def test_detect_image_extension(self):
        self.assertEqual(detect_image_extension(create_dummy_image_bytes(format="WEBP")), "webp")
        self.assertEqual(detect_image_extension(create_dummy_image_bytes(format="PNG")), "png")
        self.assertEqual(detect_image_extension(create_dummy_image_bytes(format="JPEG")), "jpg")

    def test_host_connection_gate(self):
        gate_mgr = HostConnectionGate(per_host_limit=2)
        gate1 = gate_mgr.get_gate("https://cdn.mangadex.org/data/1.webp")
        gate2 = gate_mgr.get_gate("https://cdn.mangadex.org/data/2.webp")
        gate3 = gate_mgr.get_gate("https://i.cuutruyen.net/pages/1.webp")

        self.assertIs(gate1, gate2)  # Cùng domain -> cùng semaphore
        self.assertIsNot(gate1, gate3)  # Khác domain -> khác semaphore

    def test_resolve_chapter_output_path(self):
        ch = Chapter(id="1", title="The Beginning", chapter_number="1", url="")
        p_cbz = resolve_chapter_output_path(self.test_dir, self.manga_info, ch, OutputFormat.CBZ)
        self.assertEqual(p_cbz.name, "Ch.1 - The Beginning.cbz")
        self.assertEqual(p_cbz.parent.name, "Sousou no Frieren")

        p_zip = resolve_chapter_output_path(self.test_dir, self.manga_info, ch, OutputFormat.ZIP)
        self.assertEqual(p_zip.name, "Ch.1 - The Beginning.zip")

        p_img = resolve_chapter_output_path(self.test_dir, self.manga_info, ch, OutputFormat.IMAGES)
        self.assertEqual(p_img.name, "Ch.1 - The Beginning")

    def test_download_chapter_streaming_cbz(self):
        # Tạo mock session trả về ảnh WebP hợp lệ
        mock_session = MagicMock()
        img_bytes = create_dummy_image_bytes(format="WEBP")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = img_bytes
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(
            id="1",
            title="The Beginning",
            chapter_number="1",
            url="https://example.com/ch1",
            pages=["https://cdn.example.com/p1.webp", "https://cdn.example.com/p2.webp"]
        )

        progress_calls = []
        def _on_prog(done, total):
            progress_calls.append((done, total))

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.CBZ,
            output_dir=self.test_dir,
            stream_to_disk=True,
            progress_callback=_on_prog
        )

        self.assertTrue(report.is_successful)
        self.assertIsNotNone(report.output_path)
        self.assertTrue(report.output_path.exists())
        self.assertEqual(len(progress_calls), 2)

        # Kiểm tra nội dung CBZ đã sinh
        with zipfile.ZipFile(report.output_path, "r") as cbz:
            names = cbz.namelist()
            self.assertIn("ComicInfo.xml", names)
            self.assertIn("001.webp", names)
            self.assertIn("002.webp", names)

    def test_download_chapter_streaming_zip(self):
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = create_dummy_image_bytes(format="WEBP")
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(
            id="2",
            title="Second Day",
            chapter_number="2",
            url="",
            pages=["https://cdn.example.com/p1.webp"]
        )

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.ZIP,
            output_dir=self.test_dir,
            stream_to_disk=True
        )

        self.assertTrue(report.is_successful)
        self.assertTrue(report.output_path.exists())
        self.assertEqual(report.output_path.suffix, ".zip")

        with zipfile.ZipFile(report.output_path, "r") as zf:
            self.assertIn("001.webp", zf.namelist())

    def test_download_chapter_streaming_images(self):
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = create_dummy_image_bytes(format="WEBP")
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(id="3", title="Images Only", chapter_number="3", url="", pages=["https://cdn/p1.webp", "https://cdn/p2.webp"])

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.IMAGES,
            output_dir=self.test_dir,
            stream_to_disk=True
        )

        self.assertTrue(report.is_successful)
        self.assertTrue(report.output_path.is_dir())
        files = sorted([f.name for f in report.output_path.glob("*.*")])
        self.assertEqual(files, ["001.webp", "002.webp"])

    def test_download_chapter_streaming_pdf(self):
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = create_dummy_image_bytes(format="JPEG")
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(id="4", title="PDF Chapter", chapter_number="4", url="", pages=["https://cdn/p1.jpg"])

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.PDF,
            output_dir=self.test_dir,
            stream_to_disk=True
        )

        self.assertTrue(report.is_successful)
        self.assertTrue(report.output_path.exists())
        self.assertEqual(report.output_path.suffix, ".pdf")

    def test_download_chapter_in_memory_mode(self):
        mock_session = MagicMock()
        img_bytes = create_dummy_image_bytes(format="WEBP")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = img_bytes
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(id="5", title="Memory Buffer", chapter_number="5", url="", pages=["https://cdn/p1.webp"])

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.CBZ,
            output_dir=self.test_dir,
            stream_to_disk=False  # Buffer mode
        )

        self.assertTrue(report.is_successful)
        self.assertEqual(len(report.downloaded_pages), 1)
        self.assertEqual(report.downloaded_pages[0][1], img_bytes)
        self.assertTrue(report.output_path.exists())

    def test_download_chapter_failure_aborts_cleanly(self):
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 403  # Cloudflare WAF block
        mock_session.get.return_value = mock_resp

        downloader = ConcurrentMangaDownloader(max_image_workers=2, session=mock_session)
        ch = Chapter(id="6", title="Blocked", chapter_number="6", url="", pages=["https://cdn/blocked.webp"])

        report = downloader.download_chapter(
            chapter_or_id=ch,
            manga_info=self.manga_info,
            output_format=OutputFormat.CBZ,
            output_dir=self.test_dir,
            stream_to_disk=True
        )

        self.assertFalse(report.is_successful)
        self.assertEqual(len(report.failures), 1)
        self.assertEqual(report.failures[0].category, "HTTP_403_WAF")
        # File .cbz chính thức không được sinh ra
        expected_path = resolve_chapter_output_path(self.test_dir, self.manga_info, ch, OutputFormat.CBZ)
        self.assertFalse(expected_path.exists())
        self.assertFalse(expected_path.with_suffix(".cbz.tmp").exists())

    def test_generate_comic_info_xml_minimal(self):
        ch = Chapter(id="minimal", title="", chapter_number="99", url="")
        xml_str = generate_comic_info_xml(manga_info=None, chapter=ch, page_count=5)
        root = ET.fromstring(xml_str)
        self.assertEqual(root.findtext("Title"), "Chapter 99")
        self.assertEqual(root.findtext("PageCount"), "5")
        self.assertIsNone(root.find("Series"))

    def test_download_manga_chapters_two_tier_concurrency(self):
        mock_session = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = create_dummy_image_bytes(format="WEBP")
        mock_session.get.return_value = mock_resp

        ch1 = Chapter(id="1", title="Ch1", chapter_number="1", url="", pages=["https://cdn/1.webp", "https://cdn/2.webp"])
        ch2 = Chapter(id="2", title="Ch2", chapter_number="2", url="", pages=["https://cdn/3.webp"])

        chapters = [ch1, ch2]

        cb_calls = []
        def _prog(ch, rep):
            cb_calls.append((ch.id, rep.is_successful))

        reports = download_manga_chapters(
            manga_info=self.manga_info,
            chapters=chapters,
            output_format=OutputFormat.CBZ,
            output_dir=self.test_dir,
            max_chapter_workers=2,
            max_image_workers=2,
            progress_callback=_prog,
            session=mock_session
        )

        self.assertEqual(len(reports), 2)
        self.assertTrue(reports[0].is_successful)
        self.assertTrue(reports[1].is_successful)
        self.assertTrue(reports[0].output_path.exists())
        self.assertTrue(reports[1].output_path.exists())
        self.assertEqual(len(cb_calls), 2)


if __name__ == "__main__":
    unittest.main()
