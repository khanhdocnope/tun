"""
Helper trích xuất và lọc danh sách chapters dựa trên chuỗi định dạng phạm vi (ranges)
hoặc danh sách ID chương.
Hỗ trợ các định dạng: '1-3, 5', '10.5', 'all', hoặc UUIDs.
"""

import re
from typing import List, Optional, Set

from src.core.models import Chapter


def _parse_float_safe(val: str) -> Optional[float]:
    """Chuyển đổi chuỗi sang float an toàn nếu có thể trích xuất số."""
    nums = re.findall(r"\d+(?:\.\d+)?", val)
    if nums:
        try:
            return float(nums[0])
        except ValueError:
            return None
    return None


def filter_chapters(
    available_chapters: List[Chapter],
    selection: Optional[str] = None,
    explicit_ids: Optional[List[str]] = None,
) -> List[Chapter]:
    """
    Lọc danh sách Chapter từ available_chapters.

    Args:
        available_chapters: Danh sách các chapter sẵn có của manga.
        selection: Chuỗi phạm vi ví dụ: '1-5, 8, 10.5', 'all', hoặc rỗng (chọn tất cả).
        explicit_ids: Danh sách ID cụ thể (dành cho API khi client gửi trực tiếp IDs).

    Returns:
        Danh sách các Chapter thỏa mãn điều kiện.
    """
    if not available_chapters:
        return []

    # 1. Nếu có explicit_ids
    if explicit_ids:
        id_set: Set[str] = {str(i).strip() for i in explicit_ids if str(i).strip()}
        matched = [ch for ch in available_chapters if ch.id in id_set]
        if matched:
            return matched

    # 2. Nếu selection rỗng hoặc là 'all' / '*'
    if not selection or selection.strip().lower() in ("all", "*"):
        return list(available_chapters)

    tokens = [t.strip() for t in selection.split(",") if t.strip()]
    if not tokens:
        return list(available_chapters)

    selected_ids: Set[str] = set()

    for token in tokens:
        # Trường hợp dải phân cách 'X-Y'
        if "-" in token and not token.startswith("-"):
            parts = token.split("-", 1)
            start_num = _parse_float_safe(parts[0])
            end_num = _parse_float_safe(parts[1])

            if start_num is not None and end_num is not None:
                low = min(start_num, end_num)
                high = max(start_num, end_num)
                for ch in available_chapters:
                    ch_num = _parse_float_safe(ch.chapter_number)
                    if ch_num is not None and low <= ch_num <= high:
                        selected_ids.add(ch.id)
                continue

        # Trường hợp số đơn lẻ hoặc ID chuỗi
        single_num = _parse_float_safe(token)
        found_by_num = False
        if single_num is not None:
            for ch in available_chapters:
                ch_num = _parse_float_safe(ch.chapter_number)
                if ch_num is not None and abs(ch_num - single_num) < 1e-4:
                    selected_ids.add(ch.id)
                    found_by_num = True

        # Nếu không match theo số hoặc token là ID/UUID
        if not found_by_num:
            for ch in available_chapters:
                if ch.id == token or ch.chapter_number.lower() == token.lower():
                    selected_ids.add(ch.id)

    # Giữ nguyên thứ tự ban đầu của available_chapters
    return [ch for ch in available_chapters if ch.id in selected_ids]
