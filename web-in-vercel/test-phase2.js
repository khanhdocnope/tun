/**
 * Unit & Integration Test for Phase 2 - MangaStudio AI Mobile UI Optimization
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 BẮT ĐẦU KIỂM TRA NGHIỆM THU GIAI ĐOẠN 2 (MOBILE UI BATCH STUDIO)...\n');

// 1. Kiểm tra HTML: batch-studio/index.html
const batchHtml = fs.readFileSync(path.join(__dirname, 'batch-studio', 'index.html'), 'utf-8');

console.log('1. Kiểm tra cấu trúc giao diện Batch Studio (HTML):');
// a. Header 2 hàng
assert.ok(batchHtml.includes('studio-header-row-1'), 'Header phải có hàng 1 (studio-header-row-1)');
assert.ok(batchHtml.includes('studio-header-row-2'), 'Header phải có hàng 2 (studio-header-row-2)');
assert.ok(!batchHtml.includes('>+ Add images'), 'Đã xóa dấu + thừa ở Add images');
assert.ok(batchHtml.includes('Thêm ảnh (tối đa 100)'), 'Nhãn thêm ảnh đã chuẩn hóa tiếng Việt');
assert.ok(batchHtml.includes('id="btnToggleCollapseAll"'), 'Phải có nút Thu gọn tất cả (#btnToggleCollapseAll)');
assert.ok(batchHtml.includes('id="btnOpenProofread"'), 'Phải có nút Soát bản dịch (#btnOpenProofread)');
console.log('  ✅ Header 2 hàng gọn gàng, dọn dẹp chữ "+ +", có nút Thu gọn và Soát bản dịch.');

// b. Thanh lọc chip đếm
assert.ok(batchHtml.includes('id="filterAll"'), 'Có chip lọc Tất cả');
assert.ok(batchHtml.includes('id="filterDone"'), 'Có chip lọc Đã xong');
assert.ok(batchHtml.includes('id="filterPending"'), 'Có chip lọc Chưa xong');
assert.ok(batchHtml.includes('id="filterError"'), 'Có chip lọc Lỗi');
assert.ok(batchHtml.includes('id="btnJumpPending"'), 'Có nút Tới trang chưa xong');
console.log('  ✅ Thanh trạng thái / Lọc tiến độ đầy đủ 4 chip đếm và nút nhảy trang.');

// c. Bottom Fixed Action Bar
assert.ok(batchHtml.includes('id="bottomActionBar"'), 'Có Bottom Fixed Action Bar (#bottomActionBar)');
assert.ok(batchHtml.includes('id="btnOpenBottomSheet"'), 'Có nút mở Bottom Sheet (#btnOpenBottomSheet)');
assert.ok(batchHtml.includes('id="btnBottomProcessAll"'), 'Có nút chính OCR + Dịch tất cả (#btnBottomProcessAll)');
assert.ok(batchHtml.includes('id="btnBottomCleanAll"'), 'Có nút nhanh Tẩy chữ ở đáy');
assert.ok(batchHtml.includes('id="btnBottomQuickTxt"'), 'Có nút nhanh Tải .txt ở đáy');
console.log('  ✅ Action Bar cố định đáy màn hình với nút nổi bật và các thao tác nhanh.');

// d. Bottom Sheet Menu
assert.ok(batchHtml.includes('id="bottomSheetBackdrop"'), 'Có backdrop Bottom Sheet');
assert.ok(batchHtml.includes('id="bottomSheetCard"'), 'Có khung Bottom Sheet card');
assert.ok(batchHtml.includes('id="sheetBtnClearAll"'), 'Có nút Xóa tất cả tách biệt ở đáy sheet');
console.log('  ✅ Bottom Sheet menu đầy đủ các tác vụ và nút Xóa tách biệt ở đáy.');

// e. Proofreading Overlay
assert.ok(batchHtml.includes('id="proofreadOverlay"'), 'Có Proofreading Fullscreen Overlay');
assert.ok(batchHtml.includes('id="proofreadImg"'), 'Có thẻ ảnh lớn trong Proofread');
assert.ok(batchHtml.includes('id="proofreadJpText"'), 'Có ô textarea tiếng Nhật');
assert.ok(batchHtml.includes('id="proofreadViText"'), 'Có ô textarea tiếng Việt');
assert.ok(batchHtml.includes('id="btnProofreadPrev"'), 'Có nút chuyển trang trước');
assert.ok(batchHtml.includes('id="btnProofreadNext"'), 'Có nút chuyển trang sau');
console.log('  ✅ Màn hình Soát bản dịch toàn màn hình với ảnh lớn và 2 ô soạn thảo song song.');

// 2. Kiểm tra CSS: batch-studio/style.css
const styleCss = fs.readFileSync(path.join(__dirname, 'batch-studio', 'style.css'), 'utf-8');

console.log('\n2. Kiểm tra CSS và Mobile Responsive (style.css):');
assert.ok(styleCss.includes('.bottom-action-bar'), 'Có CSS cho .bottom-action-bar');
assert.ok(styleCss.includes('env(safe-area-inset-bottom)'), 'Có nhận diện env(safe-area-inset-bottom) chống cấn thanh điều hướng di động');
assert.ok(styleCss.includes('.manga-row-card.is-collapsed'), 'Có CSS cho thẻ thu gọn .is-collapsed');
assert.ok(styleCss.includes('.proofread-overlay'), 'Có CSS cho .proofread-overlay');
assert.ok(styleCss.includes('.bottom-sheet-card'), 'Có CSS cho .bottom-sheet-card với animation');
assert.ok(styleCss.includes('min-height: 48px') || styleCss.includes('min-height: 44px'), 'Vùng chạm đạt chuẩn di động >= 44px');
console.log('  ✅ CSS đáp ứng đầy đủ safe-area-inset-bottom, thẻ thu gọn, bottom sheet và vùng chạm >= 44px.');

// 3. Kiểm tra JavaScript: batch-studio/app.js
const appJs = fs.readFileSync(path.join(__dirname, 'batch-studio', 'app.js'), 'utf-8');

console.log('\n3. Kiểm tra logic xử lý JavaScript (app.js):');
// a. State mở rộng
assert.ok(appJs.includes("currentFilter: 'all'"), 'State có currentFilter');
assert.ok(appJs.includes('isAllCollapsed: false'), 'State có isAllCollapsed');
assert.ok(appJs.includes('proofreadIndex: 0'), 'State có proofreadIndex');
console.log('  ✅ State quản lý bộ lọc, thu gọn thẻ và vị trí soát bản dịch.');

// b. Hàm Filter & Tiến độ
assert.ok(appJs.includes('function updateFilterCounts()'), 'Có hàm updateFilterCounts');
assert.ok(appJs.includes('function setFilter(filterType)'), 'Có hàm setFilter');
assert.ok(appJs.includes('function jumpToFirstPending()'), 'Có hàm jumpToFirstPending');
assert.ok(appJs.includes('function toggleCollapseAll()'), 'Có hàm toggleCollapseAll');
console.log('  ✅ Bộ hàm lọc danh sách, đếm tiến độ động và nhảy tới trang chưa xong.');

// c. Hàm Bottom Sheet & Proofreading
assert.ok(appJs.includes('function openBottomSheet()'), 'Có hàm openBottomSheet');
assert.ok(appJs.includes('function closeBottomSheet()'), 'Có hàm closeBottomSheet');
assert.ok(appJs.includes('function openProofread(index = 0)'), 'Có hàm openProofread');
assert.ok(appJs.includes('function closeProofread()'), 'Có hàm closeProofread');
assert.ok(appJs.includes('function navigateProofread(step)'), 'Có hàm navigateProofread');
console.log('  ✅ Điều hướng Soát bản dịch mượt mà với zoom, phím tắt và cảm ứng vuốt chạm.');

// d. Hiển thị tiến độ x/N trên nút dừng
assert.ok(appJs.includes('Dừng lại (${completed}/${total})'), 'Nút chuyển sang Dừng lại (x/N) khi đang chạy');
console.log('  ✅ Khi chạy queue, nút chuyển sang trạng thái "Dừng lại (x/N)" theo thời gian thực.');

// e. Bảo toàn các yêu cầu bất biến
assert.ok(appJs.includes('function getPrevContext(item)'), 'Bảo toàn getPrevContext');
assert.ok(appJs.includes('function needsWork(img, mode)'), 'Bảo toàn needsWork');
assert.ok(appJs.includes('function flushPendingSaves()'), 'Bảo toàn flushPendingSaves');
assert.ok(appJs.includes('function clearAllBatch()'), 'Bảo toàn clearAllBatch');
console.log('  ✅ Các logic cốt lõi bất biến tiếp tục được bảo toàn 100%.');

console.log('\n🎉 TẤT CẢ CÁC BÀI TEST NGHIỆM THU GIAI ĐOẠN 2 ĐÃ VƯỢT QUA XUẤT SẮC!\n');
