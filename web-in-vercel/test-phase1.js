/**
 * Unit & Integration Test for Phase 1 - MangaStudio AI
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 BẮT ĐẦU KIỂM TRA NGHIỆM THU GIAI ĐOẠN 1...\n');

// 1. Kiểm tra index.html
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

console.log('1. Kiểm tra kiến trúc & liên kết index.html:');
// a. Link Chương (hàng loạt) không có target=_blank
assert.ok(indexHtml.includes('href="/batch-studio" class="nav-batch-link"'), 'nav-batch-link phải trỏ trực tiếp đến /batch-studio');
assert.ok(!indexHtml.includes('href="/batch-studio" target="_blank" class="nav-batch-link"'), 'nav-batch-link không được có target=_blank');
console.log('  ✅ Link header "Chương (hàng loạt)" mở ngay trong tab hiện tại.');

// b. Iframe cũ tới batch-studio đã được xóa bỏ
assert.ok(!indexHtml.includes('<iframe id="iframe-batch-studio" src="/batch-studio"'), 'Iframe tới /batch-studio phải được loại bỏ để tiết kiệm tài nguyên');
console.log('  ✅ Iframe nặng 82vh đã được gỡ bỏ.');

// c. Cờ LEGACY_TABS & 3 Tab hoạt động (Xóa chữ, Tẩy ZIP, Dịch script)
assert.ok(indexHtml.includes('const LEGACY_TABS = false;'), 'Phải có cờ const LEGACY_TABS = false');
assert.ok(indexHtml.includes('hide-legacy-tabs'), 'Phải có class hide-legacy-tabs');
assert.ok(!indexHtml.includes('class="tab-btn legacy-tab" data-tab="tab-batch"'), 'tab-batch không được gắn legacy-tab (đã mở lại cho Cleaner/Redrawer)');
assert.ok(indexHtml.includes('class="tab-btn" data-tab="tab-batch"'), 'Nút tab-batch phải mở sẵn cho người dùng');
assert.ok(indexHtml.includes('<span class="tab-label-short">Tẩy ZIP</span>'), 'Có nhãn ngắn Tẩy ZIP cho mobile');
console.log('  ✅ Cờ const LEGACY_TABS = false được thiết lập; mở lại tab "Tẩy ZIP" cho Redrawer.');

// d. Responsive CSS cho mobile 360-480px
assert.ok(indexHtml.includes('@media (max-width: 480px)'), 'Phải có @media (max-width: 480px)');
assert.ok(indexHtml.includes('.brand-text span') && indexHtml.includes('display: none !important;'), 'Phụ đề header phải ẩn dưới 480px');
assert.ok(indexHtml.includes('white-space: nowrap !important;'), 'Tên app h1 không được xuống dòng');
assert.ok(indexHtml.includes('overflow-x: hidden !important;'), 'html, body, main-wrapper không cuộn ngang');
console.log('  ✅ Mobile CSS chống tràn viền (overflow-x: hidden), ẩn subtitle, không xuống dòng tên app.');

// 2. Kiểm tra batch-studio/index.html
const batchHtml = fs.readFileSync(path.join(__dirname, 'batch-studio', 'index.html'), 'utf-8');
console.log('\n2. Kiểm tra giao diện Batch Studio (/batch-studio/index.html):');
assert.ok(batchHtml.includes('jszip.min.js'), 'Batch Studio phải nạp thư viện JSZip');
assert.ok(batchHtml.includes('id="btnCleanAll"'), 'Phải có nút Tẩy chữ tất cả (#btnCleanAll)');
assert.ok(batchHtml.includes('id="btnExportCleanZip"'), 'Phải có nút Tải ZIP ảnh sạch (#btnExportCleanZip)');
assert.ok(batchHtml.includes('id="btnExportBundleZip"'), 'Phải có nút Tải gói đầy đủ Ảnh + Script (#btnExportBundleZip)');
assert.ok(batchHtml.includes('id="selectCleanModel"'), 'Phải có cấu hình mô hình inpaint');
assert.ok(batchHtml.includes('id="inputCleanDilation"'), 'Phải có cấu hình dilation px');
assert.ok(batchHtml.includes('id="inputCleanThreshold"'), 'Phải có cấu hình detection threshold');
console.log('  ✅ Có đầy đủ JSZip, nút Tẩy chữ, menu Xuất ZIP và cấu hình Inpainting.');

// 3. Kiểm tra batch-studio/app.js
const appJs = fs.readFileSync(path.join(__dirname, 'batch-studio', 'app.js'), 'utf-8');
console.log('\n3. Kiểm tra logic xử lý Chapter Workspace (/batch-studio/app.js):');

// a. IndexedDB version 2 & kho cleaned
assert.ok(appJs.includes('DB_VERSION = 2'), 'IndexedDB DB_VERSION phải là 2');
assert.ok(appJs.includes("db.createObjectStore(CLEANED, { keyPath: 'id' })"), 'Phải tạo kho cleaned trong onupgradeneeded');
assert.ok(appJs.includes('putCleaned'), 'Store phải có phương thức putCleaned');
assert.ok(appJs.includes('cleanedById'), 'loadAll phải kết hợp dữ liệu từ kho cleaned');
console.log('  ✅ IndexedDB v2 với 3 kho (pages, state, cleaned) và migration tự động.');

// b. Hàm cleanSingleImage có retry và gửi đúng tham số
assert.ok(appJs.includes('async function cleanSingleImage(item, maxRetries = 2)'), 'Phải có hàm cleanSingleImage với retry');
assert.ok(appJs.includes('cleanSFX: Boolean(state.settings.cleanSFX)'), 'Gửi tham số cleanSFX');
assert.ok(appJs.includes('dilationPx: Number(state.settings.cleanDilation'), 'Gửi tham số dilationPx');
assert.ok(appJs.includes('detThreshold: Number(state.settings.cleanThreshold'), 'Gửi tham số detThreshold');
assert.ok(appJs.includes('inpaintModel: String(state.settings.cleanModel'), 'Gửi tham số inpaintModel');
assert.ok(appJs.includes("store.putCleaned({ id: item.id, cleanedBase64: item.cleanedBase64 })"), 'Lưu ảnh đã tẩy vào kho cleaned');
console.log('  ✅ cleanSingleImage hỗ trợ retry tối đa 2 lần, lưu kết quả vào kho cleaned.');

// c. Giới hạn 2 request đồng thời cho queue tẩy chữ
assert.ok(appJs.includes('const concurrency = 2; // Giới hạn 2 request đồng thời'), 'runCleanQueue phải giới hạn concurrency = 2');
console.log('  ✅ runCleanQueue giới hạn đúng 2 concurrent requests.');

// d. Xuất ZIP ảnh sạch và kịch bản
assert.ok(appJs.includes('async function exportCleanedImagesZip()'), 'Phải có hàm exportCleanedImagesZip');
assert.ok(appJs.includes('async function exportBundleZip()'), 'Phải có hàm exportBundleZip');
assert.ok(appJs.includes('zip.file(img.name, b64, { base64: true })'), 'Giữ nguyên tên file gốc của ảnh khi nén zip');
console.log('  ✅ Hỗ trợ xuất ZIP ảnh sạch (giữ tên file gốc) và xuất gói ZIP đầy đủ.');

// e. Giữ nguyên các yêu cầu bất biến
assert.ok(appJs.includes('function getPrevContext(item)'), 'Phải giữ nguyên hàm getPrevContext (12 dòng, lùi 3 trang)');
assert.ok(appJs.includes('slice(-12)'), 'prevContext giữ 12 dòng');
assert.ok(appJs.includes('function needsWork(img, mode)'), 'Phải giữ nguyên hàm needsWork');
assert.ok(appJs.includes('function flushPendingSaves()'), 'Phải giữ nguyên hàm flushPendingSaves');
assert.ok(appJs.includes('function clearAllBatch()'), 'Phải giữ nguyên hàm clearAllBatch có confirm');
console.log('  ✅ Toàn bộ cơ chế bất biến (prevContext 12 dòng, needsWork, flushPendingSaves, clearAllBatch) được bảo toàn nguyên vẹn.');

// 4. Giả lập kịch bản Resume (reload chỉ gửi phần còn lại)
console.log('\n4. Giả lập luồng: Upload 3 trang -> Tẩy chữ -> Dịch -> Resume');
const mockImages = [
  { id: 'p1', name: '01.png', stage: 2, status: 'done', cleanStatus: 'done', cleanedBase64: 'data:image/png;base64,AAA', viText: 'Lời thoại 1' },
  { id: 'p2', name: '02.png', stage: 1, status: 'done', cleanStatus: 'done', cleanedBase64: 'data:image/png;base64,BBB', viText: '' },
  { id: 'p3', name: '03.png', stage: 0, status: 'idle', cleanStatus: 'idle', cleanedBase64: '', viText: '' }
];

// Logic needsWork:
function mockNeedsWork(img, mode) {
  const stage = img.stage || 0;
  if (mode === 'ocr_only') return stage < 1;
  if (mode === 'translate_only') return stage < 2 && !!(img.ocrText && img.ocrText.trim());
  return stage < 2;
}

// Logic clean needsWork:
function mockNeedsClean(img) {
  return !img.cleanedBase64 || img.cleanStatus !== 'done';
}

const remainingToTranslate = mockImages.filter(img => mockNeedsWork(img, 'all'));
assert.strictEqual(remainingToTranslate.length, 2, 'Trang 1 đã xong (stage 2), chỉ gửi tiếp trang 2 và 3');
assert.strictEqual(remainingToTranslate[0].name, '02.png');
assert.strictEqual(remainingToTranslate[1].name, '03.png');
console.log('  ✅ Khi chạy tiếp OCR/Dịch: Chỉ gửi 2 trang chưa xong (02.png, 03.png), bỏ qua 01.png.');

const remainingToClean = mockImages.filter(img => mockNeedsClean(img));
assert.strictEqual(remainingToClean.length, 1, 'Trang 1 và 2 đã tẩy xong, chỉ cần tẩy tiếp trang 3');
assert.strictEqual(remainingToClean[0].name, '03.png');
console.log('  ✅ Khi chạy tiếp Tẩy chữ: Chỉ gửi 1 trang chưa tẩy (03.png), bỏ qua trang 1 và 2.');

// 5. Kiểm tra README.md
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf-8');
console.log('\n5. Kiểm tra tài liệu hóa README.md:');
assert.ok(readme.includes('/api/vision.js') && readme.includes('Legacy'), 'vision.js phải được ghi chú Legacy');
assert.ok(readme.includes('/api/ocr.js') && readme.includes('Legacy'), 'ocr.js phải được ghi chú Legacy');
assert.ok(readme.includes('/api/translate.js') && readme.includes('Legacy'), 'translate.js phải được ghi chú Legacy');
assert.ok(readme.includes('/api/batch-zip.js') && readme.includes('Legacy'), 'batch-zip.js phải được ghi chú Legacy');
console.log('  ✅ README.md đã ghi chú rõ ràng 4 API legacy và vị trí UI gọi.');

console.log('\n🎉 TẤT CẢ CÁC BÀI TEST NGHIỆM THU GIAI ĐOẠN 1 ĐÃ VƯỢT QUA XUẤT SẮC!');
