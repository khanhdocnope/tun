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

def run_tests():
    print('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ E2E GIAI ĐOẠN 4 (TYPESET STUDIO & EXPORT ZIP)...\n')
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        block_externals(ctx)
        ctx.add_init_script(MOCK)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))

        # 1. Kiểm tra liên kết điều hướng từ Trang chủ và Batch Studio
        pg.goto(BASE + '/', wait_until='domcontentloaded')
        typeset_link_home = pg.locator('a[href="/typeset-studio"]')
        check('Trang chủ có nút liên kết tới Typeset Studio', typeset_link_home.count() >= 1)

        pg.goto(BASE + '/batch-studio', wait_until='domcontentloaded')
        typeset_link_batch = pg.locator('a[href="/typeset-studio/"]')
        check('Batch Studio Header có nút liên kết tới Typeset Studio', typeset_link_batch.count() >= 1)

        # 2. Truy cập trực tiếp vào Typeset Studio
        pg.goto(BASE + '/typeset-studio/', wait_until='domcontentloaded')
        pg.wait_for_timeout(500)

        check('Không có lỗi JavaScript khi khởi động Typeset Studio', len(errors) == 0, str(errors))
        check('Tiêu đề Manga Typeset Pro hiển thị', pg.locator('.studio-title').is_visible())
        check('Thanh điều hướng trang (Prev/Next/Counter) tồn tại', pg.locator('#pageCounterLabel').is_visible())
        check('Nút Xuất ZIP hoàn chỉnh tồn tại', pg.locator('#btnExportFullZip').is_visible())
        check('Nút Xuất ảnh PNG tồn tại', pg.locator('#btnExportCurrentPng').is_visible())
        check('Nút Tự căn chữ (Auto-fit) tồn tại', pg.locator('#btnAutoFitAll').is_visible())

        # 3. Bố cục 3 cột chuyên nghiệp
        check('Sidebar danh sách trang bên trái hiển thị', pg.locator('.sidebar-pages').is_visible())
        check('Viewport Canvas trung tâm hiển thị', pg.locator('#viewportContainer').is_visible())
        check('HTML5 Canvas hiển thị', pg.locator('#typesetCanvas').is_visible())
        check('Inspector thuộc tính bóng thoại bên phải hiển thị', pg.locator('#inspectorPanel').is_visible())

        # 4. Kiểm tra danh sách 20 font Manga Việt Hóa
        fonts_count = pg.locator('#propFont optgroup[label="Bộ Font Manga Việt Hóa"] option').count()
        check('Dropdown chứa đủ 20 font Manga Việt hóa', fonts_count == 20, f'Có {fonts_count} fonts')
        check('Nút nạp font tùy chỉnh TTF/OTF có mặt', pg.locator('#btnUploadFontTrigger').is_visible())

        # 5. Nạp dữ liệu mẫu vào IndexedDB để kiểm thử đồng bộ
        seed_script = """
        async () => {
          const req = indexedDB.open('manga_studio_batch', 3);
          return new Promise((resolve) => {
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction(['pages', 'state', 'cleaned'], 'readwrite');
              const c = document.createElement('canvas');
              c.width = 100; c.height = 100;
              const cx = c.getContext('2d');
              cx.fillStyle = '#ffffff';
              cx.fillRect(0, 0, 100, 100);
              const sampleImg = c.toDataURL('image/png');
              tx.objectStore('pages').put({ id: 'p1', seq: 1, name: '001.png', sizeStr: '1 KB', base64: sampleImg });
              tx.objectStore('cleaned').put({ id: 'p1', blob: null });
              tx.objectStore('state').put({
                id: 'p1',
                status: 'done',
                cleanStatus: 'done',
                viText: 'Xin chào thế giới!\\nLời thoại manga.',
                bubbles: [
                  { box_2d: [100, 100, 300, 400], src: 'Hello', tgt: 'Xin chào thế giới!' }
                ]
              });
              tx.oncomplete = () => resolve(true);
            };
          });
        }
        """
        pg.evaluate(seed_script)
        pg.wait_for_timeout(300)

        # Bấm nút đồng bộ từ Batch Studio
        pg.click('#btnSyncFromBatch')
        pg.wait_for_timeout(600)

        check('Đồng bộ hiển thị trang trong danh sách sidebar', pg.locator('.page-thumb-card').count() >= 1)
        check('Số đếm trang cập nhật (Trang 1 / 1)', '1 / 1' in pg.locator('#pageCounterLabel').inner_text())

        # 6. Kiểm tra tương tác thêm và sửa bóng thoại
        pg.click('#btnAddBubble')
        pg.wait_for_timeout(200)

        badge_text = pg.locator('#activeBubbleBadge').inner_text()
        check('Thêm bóng thoại thành công và tự động chọn bóng thoại', 'Thoại #' in badge_text, badge_text)
        check('Ô nhập lời thoại được kích hoạt và gõ được', pg.locator('#propText').is_enabled())

        # Gõ lời thoại mới
        pg.fill('#propText', 'Bản dịch mới đã chèn thành công!')
        pg.wait_for_timeout(200)

        # Chuyển đổi căn lề
        pg.click('#alignSegmented button[data-align="left"]')
        check('Nút căn trái kích hoạt', 'active' in pg.locator('#alignSegmented button[data-align="left"]').get_attribute('class'))

        # 7. Kiểm tra xóa bóng thoại
        pg.click('#btnDeleteBubble')
        pg.wait_for_timeout(200)
        check('Xóa bóng thoại thành công', pg.locator('#activeBubbleBadge').inner_text() == 'Chưa chọn')

        # 8. Kiểm tra Nạp ảnh trực tiếp qua input file
        page_file = os.path.join(os.path.dirname(__file__), 'page2.jpg')
        if os.path.exists(page_file):
            initial_count = pg.locator('.page-thumb-card').count()
            pg.set_input_files('#inputAddLocalImages', page_file)
            pg.wait_for_timeout(800)
            new_count = pg.locator('.page-thumb-card').count()
            check('Tải ảnh trực tiếp trong Typeset Studio thành công', new_count == initial_count + 1, f'{new_count} trang')

        # 9. Kiểm tra Tẩy chữ & Bắt Box AI (Backend)
        check('Nút Tẩy & Bắt Box AI có mặt', pg.locator('#btnAiCleanAndBox').is_visible())
        pg.click('#btnAiCleanAndBox')
        pg.wait_for_selector('#btnAiCleanAndBox:not([disabled])', timeout=10000)
        pg.wait_for_timeout(300)

        # Kiểm tra box được tự động tạo từ Backend AI
        check('Bắt box AI tự động tạo bóng thoại', pg.locator('#activeBubbleBadge').inner_text() != 'Chưa chọn')
        jp_val = pg.locator('#propSrcText').input_value()
        check('Ô tiếng Nhật gốc hiển thị chữ nhận diện được từ OCR', 'こんにちは世界' in jp_val, jp_val)
        vi_val = pg.locator('#propText').input_value()
        check('Ô tiếng Việt hiển thị bản dịch tương ứng', 'Xin chào thế giới' in vi_val, vi_val)

        # 10. Kiểm tra nút chuyển đổi chế độ xem Dịch (VI) / Gốc (JP)
        check('Nút toggle ngôn ngữ hiển thị', pg.locator('#btnToggleViewLang').is_visible())
        pg.click('#btnToggleViewLang')
        pg.wait_for_timeout(200)
        check('Chuyển sang chế độ xem tiếng Nhật gốc (JP)', 'Gốc (JP)' in pg.locator('#viewLangLabel').inner_text())
        pg.click('#btnToggleViewLang')
        pg.wait_for_timeout(200)
        check('Chuyển lại chế độ xem bản dịch tiếng Việt (VI)', 'Dịch (VI)' in pg.locator('#viewLangLabel').inner_text())

        # 11. Kiểm tra Bảng Cài đặt AI Tẩy Chữ (Dilation, Threshold)
        check('Nút mở Cài đặt Tẩy chữ có mặt', pg.locator('#btnAiCleanSettings').is_visible())
        pg.click('#btnAiCleanSettings')
        pg.wait_for_timeout(200)
        check('Popover Cài đặt Tẩy chữ hiển thị', pg.locator('#aiCleanSettingsPopover').is_visible())
        check('Slider Độ giãn viền nét (Dilation) tồn tại', pg.locator('#settingDilation').is_visible())
        
        # Thử thay đổi Dilation lên 12px
        pg.fill('#settingDilation', '12')
        pg.dispatch_event('#settingDilation', 'input')
        check('Badge Dilation cập nhật đúng 12px', '12px' in pg.locator('#valSettingDilation').inner_text())
        pg.click('#btnCloseAiSettings')
        pg.wait_for_timeout(150)
        check('Đóng Popover Cài đặt thành công', not pg.locator('#aiCleanSettingsPopover').is_visible())

        # 12. Kiểm tra Bộ định dạng Typography nâng cao
        check('Nút in hoa ALL CAPS có mặt', pg.locator('#propBtnUppercase').is_visible())
        check('Nút chữ đậm Bold có mặt', pg.locator('#propBtnBold').is_visible())
        check('Thanh kéo Padding lề trong bóng thoại có mặt', pg.locator('#propPadding').is_visible())
        check('Tùy chọn nền che phủ bóng thoại có mặt', pg.locator('#propBgFill').is_visible())

        # Bật In hoa (ALL CAPS)
        pg.click('#propBtnUppercase')
        pg.wait_for_timeout(100)
        check('Nút in hoa kích hoạt trạng thái active', 'active' in pg.locator('#propBtnUppercase').get_attribute('class'))

        # Chọn Nền trắng che phủ bóng thoại
        pg.select_option('#propBgFill', '#ffffff')
        check('Chọn nền trắng che phủ vết lem thành công', pg.locator('#propBgFill').input_value() == '#ffffff')

        # 13. Kiểm tra tính năng Xóa pic / xóa trang khi thêm thừa ảnh
        pg.on('dialog', lambda dialog: dialog.accept())
        count_before_delete = pg.locator('.page-thumb-card').count()
        check('Nút xóa trang trên thumbnail thẻ có mặt', pg.locator('.page-thumb-card:nth-child(2) .btn-delete-page').is_visible())
        pg.click('.page-thumb-card:nth-child(2) .btn-delete-page')
        pg.wait_for_timeout(600)
        count_after_delete = pg.locator('.page-thumb-card').count()
        check('Xóa trang thừa thành công và cập nhật danh sách', count_after_delete == count_before_delete - 1, f'{count_after_delete} trang')

        # 14. Kiểm tra sự kiện xuất ảnh PNG
        with pg.expect_download(timeout=5000) as download_info:
            pg.click('#btnExportCurrentPng')
        download = download_info.value
        check('Nút Xuất PNG tải về tệp ảnh hợp lệ', download.suggested_filename.endswith('.png'), download.suggested_filename)

        # 15. Kiểm tra sự kiện xuất ZIP hoàn chỉnh
        with pg.expect_download(timeout=8000) as download_zip_info:
            pg.click('#btnExportFullZip')
        download_zip = download_zip_info.value
        check('Nút Xuất ZIP tải về tệp ZIP hoàn chỉnh', download_zip.suggested_filename.endswith('.zip'), download_zip.suggested_filename)

        b.close()

    total = len(results)
    passed = sum(1 for r in results if r[1])
    failed = total - passed
    print(f'\n=================================================')
    print(f'TỔNG KẾT: {passed}/{total} KIỂM THỬ THÀNH CÔNG (PASS)')
    if failed > 0:
        print(f'❌ CÓ {failed} LỖI CẦN KHẮC PHỤC!')
        sys.exit(1)
    else:
        print(f'🎉 100% KIỂM THỬ GIAI ĐOẠN 4 HOÀN TẤT XUẤT SẮC!')
        print(f'=================================================\n')

if __name__ == '__main__':
    run_tests()
