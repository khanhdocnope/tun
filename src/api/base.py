"""
Module định nghĩa lớp cơ sở trừu tượng cho tất cả Manga Source Connectors trong MoeJect.
Tuân thủ nghiêm ngặt nguyên lý Single Responsibility và Open/Closed Principle.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from src.core.models import Chapter, MangaInfo, MangaSearchResult


class BaseMangaSource(ABC):
    """
    Abstract Base Class cho mọi nguồn truyện (Manga Connector).
    Mọi connector mới cần kế thừa và triển khai đầy đủ các phương thức trừu tượng.
    """

    source_id: str = "base"
    source_name: str = "Base Source"
    base_url: str = ""
    needs_browser_bypass: bool = False

    @abstractmethod
    async def search(self, query: str, page: int = 1) -> List[MangaSearchResult]:
        """
        Tìm kiếm manga theo từ khóa và phân trang.
        Nếu query rỗng hoặc khoảng trắng, mặc định trả về danh sách truyện mới cập nhật.

        Args:
            query: Từ khóa tìm kiếm (hoặc chuỗi rỗng để lấy feed mới nhất).
            page: Số trang (mặc định bắt đầu từ 1).

        Returns:
            Danh sách các đối tượng MangaSearchResult.
        """
        pass

    async def get_latest_updates(self, page: int = 1) -> List[MangaSearchResult]:
        """
        Lấy danh sách các bộ truyện vừa mới cập nhật chương mới (Recently Updated / Mới -> Cũ).
        Mặc định ủy quyền cho self.search("", page=page). Lớp con có thể ghi đè nếu có endpoint chuyên biệt.
        """
        return await self.search("", page=page)

    @abstractmethod
    async def get_manga_details(self, manga_id_or_url: str) -> MangaInfo:
        """
        Trích xuất thông tin chi tiết và danh sách chapters của bộ truyện.

        Args:
            manga_id_or_url: Mã định danh truyện (ID/Slug/UUID) hoặc URL trang truyện.

        Returns:
            Đối tượng MangaInfo chứa thông tin tác giả, thể loại và danh sách chapters.
        """
        pass

    @abstractmethod
    async def get_chapter_pages(self, chapter_id_or_url: str) -> List[str]:
        """
        Trích xuất danh sách liên kết ảnh chất lượng cao của một chapter.

        Args:
            chapter_id_or_url: Mã định danh chapter (ID/UUID) hoặc URL chapter.

        Returns:
            Danh sách URL hình ảnh theo đúng thứ tự đọc của chapter.
        """
        pass

    async def close(self) -> None:
        """
        Giải phóng tài nguyên kết nối (HTTP clients, browser contexts nếu có).
        Lớp con có thể ghi đè nếu cần dọn dẹp.
        """
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
