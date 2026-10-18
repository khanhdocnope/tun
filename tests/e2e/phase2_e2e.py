import json, sys, os
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
BASE = 'http://localhost:3111'
MOCK_PATH = os.path.join(os.path.dirname(__file__), 'mock.js')
MOCK = open(MOCK_PATH, encoding='utf-8').read()

results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    status = 'PASS ' if cond else 'FAIL '
    print(status + name + (f'  [{extra}]' if extra else ''))

def block_externals(ctx):
    for pat in ('**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**', '**/cdnjs.cloudflare.com/**'):
        ctx.route(pat, lambda r: r.abort())

def overflow(pg):
    return pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')

def run_tests():
    print('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ E2E GIAI ĐOẠN 2 (MOBILE UI BATCH STUDIO)...\n')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        block_externals(ctx)
        ctx.add_init_script(MOCK)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))

        pg.goto(BASE + '/batch-studio', wait_until='domcontentloaded')
        pg.wait_for_timeout(600)

        # 1. Header 2 hàng & dọn dẹp nhãn
        check('Header có hàng 1 và hàng 2', pg.locator('.studio-header-row-1').count() == 1 and pg.locator('.studio-header-row-2').count() == 1)
        add_text = pg.locator('.btn-add-images').inner_text()
        check('Không có dấu + thừa ở nút Thêm ảnh', '+ +' not in add_text and 'Thêm ảnh' in add_text, add_text)
        check('Nút Thu gọn tất cả và Soát bản dịch có trên hàng 2', pg.locator('#btnToggleCollapseAll').is_visible() and pg.locator('#btnOpenProofread').is_visible())

        # 2. Thanh lọc tiến độ (Filter Progress Bar)
        check('Thanh lọc tiến độ có đầy đủ 4 chip', pg.locator('.filter-chip').count() == 4)
        check('Nút nhảy tới trang chưa xong có mặt', pg.locator('#btnJumpPending').is_visible())

        # 3. Fixed Bottom Action Bar
        bar = pg.locator('#bottomActionBar')
        check('Fixed Bottom Action Bar hiển thị', bar.is_visible())
        check('Nút Menu Thêm có trên thanh đáy', pg.locator('#btnOpenBottomSheet').is_visible())
        check('Nút chính nổi bật có trên thanh đáy', pg.locator('#btnBottomProcessAll').is_visible())
        check('Nút Tẩy chữ nhanh và Tải .txt có trên thanh đáy', pg.locator('#btnBottomCleanAll').is_visible() and pg.locator('#btnBottomQuickTxt').is_visible())

        # 4. Bottom Sheet Modal
        pg.click('#btnOpenBottomSheet')
        pg.wait_for_timeout(250)
        sheet = pg.locator('#bottomSheetBackdrop')
        check('Bottom Sheet mở trượt từ đáy', sheet.is_visible())
        check('Nút Xóa tất cả cách ly ở cuối sheet', pg.locator('#sheetBtnClearAll').is_visible())
        check('Các tác vụ hàng loạt đầy đủ trong sheet', pg.locator('#sheetBtnCleanAll').is_visible() and pg.locator('#sheetBtnExportZipBoth').is_visible())
        pg.click('#btnCloseBottomSheet')
        pg.wait_for_timeout(200)
        check('Đóng Bottom Sheet thành công', not sheet.is_visible())

        # 5. Tải lên 3 ảnh mẫu
        page1 = os.path.join(os.path.dirname(__file__), 'page1.jpg')
        page2 = os.path.join(os.path.dirname(__file__), 'page2.jpg')
        page3 = os.path.join(os.path.dirname(__file__), 'page3.jpg')
        pg.set_input_files('#fileInputMultiple', [page1, page2, page3])
        pg.wait_for_function('document.querySelectorAll(".manga-row-card").length === 3', timeout=15000)
        check('3 thẻ trang được hiển thị', pg.locator('.manga-row-card').count() == 3)

        # 6. Đếm tiến độ
        c_all = pg.locator('#countAll').inner_text()
        c_pending = pg.locator('#countPending').inner_text()
        check('Đếm tiến độ ban đầu chính xác (3 trang chưa xong)', c_all == '3' and c_pending == '3', f'all={c_all}, pending={c_pending}')

        # 7. Thẻ thu gọn (Collapsible Card)
        check('Ban đầu thẻ mở rộng đầy đủ', pg.locator('.manga-row-card.is-collapsed').count() == 0)
        pg.click('#btnToggleCollapseAll')
        pg.wait_for_timeout(200)
        check('Bấm Thu gọn tất cả: cả 3 thẻ thu gọn', pg.locator('.manga-row-card.is-collapsed').count() == 3)
        check('Dòng tóm tắt bản dịch hiển thị khi thu gọn', pg.locator('.collapsed-preview-bar').first.is_visible())

        # Mở rộng thẻ đầu tiên qua nút collapse đơn lẻ
        pg.locator('.manga-row-card').first.locator('.btn-toggle-collapse').click()
        pg.wait_for_timeout(200)
        check('Nút thu gọn đơn lẻ mở rộng 1 thẻ', pg.locator('.manga-row-card.is-collapsed').count() == 2)

        # Mở rộng lại toàn bộ
        pg.click('#btnToggleCollapseAll')
        pg.wait_for_timeout(200)
        check('Bấm Mở tất cả: 3 thẻ đều mở', pg.locator('.manga-row-card.is-collapsed').count() == 0)

        # 8. Bộ lọc trạng thái (Filter switching)
        pg.click('#filterDone')
        pg.wait_for_timeout(150)
        visible_cards = pg.locator('.manga-row-card:not(.filter-hidden)').count()
        check('Lọc Đã xong: không có thẻ nào hiện (0/3 xong)', visible_cards == 0, f'visible={visible_cards}')

        pg.click('#filterPending')
        pg.wait_for_timeout(150)
        visible_cards_pending = pg.locator('.manga-row-card:not(.filter-hidden)').count()
        check('Lọc Chưa xong: cả 3 thẻ hiện (3/3 chưa xong)', visible_cards_pending == 3, f'visible={visible_cards_pending}')

        pg.click('#filterAll')
        pg.wait_for_timeout(150)

        # 9. Chế độ Soát bản dịch (Proofreading Overlay)
        pg.click('#btnOpenProofread')
        pg.wait_for_timeout(300)
        proof = pg.locator('#proofreadOverlay')
        check('Mở Soát bản dịch toàn màn hình', proof.is_visible())
        check('Chỉ số trang Trang 1 / 3 hiển thị đúng', 'Trang 1 / 3' in pg.locator('#proofreadPageIndicator').inner_text())
        check('Khung ảnh và 2 ô soạn thảo hiện hữu', pg.locator('#proofreadImg').is_visible() and pg.locator('#proofreadJpText').is_visible() and pg.locator('#proofreadViText').is_visible())

        # Thử chỉnh sửa văn bản trong Soát bản dịch
        pg.fill('#proofreadViText', 'Lời thoại dịch soát trang 1')
        pg.wait_for_timeout(200)

        # Chuyển trang sau
        pg.click('#btnProofreadNext')
        pg.wait_for_timeout(200)
        check('Chuyển sang Trang 2 / 3', 'Trang 2 / 3' in pg.locator('#proofreadPageIndicator').inner_text())

        # Chuyển trang trước
        pg.click('#btnProofreadPrev')
        pg.wait_for_timeout(200)
        check('Chuyển lại Trang 1 / 3 còn giữ bản sửa', pg.input_value('#proofreadViText') == 'Lời thoại dịch soát trang 1')

        # Thử phím mũi tên trên desktop
        pg.keyboard.press('ArrowRight')
        pg.wait_for_timeout(200)
        check('Phím mũi tên phải chuyển sang Trang 2 / 3', 'Trang 2 / 3' in pg.locator('#proofreadPageIndicator').inner_text())

        # Đóng Soát bản dịch
        pg.click('#btnCloseProofread')
        pg.wait_for_timeout(200)
        check('Đóng Soát bản dịch thành công', not proof.is_visible())

        # Kiểm tra văn bản sửa trong soát bản dịch đã cập nhật vào thẻ chính
        card1_vi = pg.locator('.manga-row-card').first.locator('.textarea-vi').input_value()
        check('Văn bản soát cập nhật đồng bộ vào thẻ trang', card1_vi == 'Lời thoại dịch soát trang 1')

        # 10. Không cuộn ngang (scrollWidth <= clientWidth) ở 360, 390, 414px
        for w in (360, 390, 414):
            pg.set_viewport_size({'width': w, 'height': 844})
            pg.wait_for_timeout(200)
            sw, cw = overflow(pg)
            check(f'Batch Studio không cuộn ngang ở {w}px', sw <= cw, f'{sw}/{cw}')

        # 11. Chụp ảnh màn hình nghiệm thu 390x844
        pg.set_viewport_size({'width': 390, 'height': 844})
        screenshot_path = os.path.join(os.path.dirname(__file__), 'phase2_mobile_390.png')
        pg.screenshot(path=screenshot_path)
        check('Đã chụp ảnh màn hình 390x844', os.path.exists(screenshot_path), screenshot_path)

        b.close()

    fails = [r for r in results if not r[1]]
    print(f'\n🏁 KẾT QUẢ: {len(results) - len(fails)}/{len(results)} PASS')
    if fails:
        print('CÁC MỤC THẤT BẠI:')
        for f in fails:
            print(f'  ❌ {f[0]} ({f[2]})')
        sys.exit(1)
    else:
        print('🎉 TẤT CẢ CÁC BÀI TEST GIAI ĐOẠN 2 ĐÃ VƯỢT QUA 100%!')

if __name__ == '__main__':
    run_tests()
