import json, zipfile, io, sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3111'
MOCK = open('mock.js', encoding='utf-8').read()
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra else ''))

def block_externals(ctx):
    for pat in ('**/fonts.googleapis.com/**', '**/fonts.gstatic.com/**', '**/cdnjs.cloudflare.com/**'):
        ctx.route(pat, lambda r: r.abort())

def overflow(pg):
    return pg.evaluate('[document.documentElement.scrollWidth, document.documentElement.clientWidth]')

def calls(pg, kind=None):
    c = pg.evaluate('window.__calls')
    return [x for x in c if (kind is None or x['kind'] == kind)]

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
    check('JSZip nạp được (fallback local)', pg.evaluate('typeof JSZip') == 'function')

    # --- Đặt cài đặt tẩy chữ qua Settings, bật bước Tẩy chữ
    pg.click('#btnSettings')
    pg.select_option('#selectCleanModel', 'big-lama')
    pg.fill('#rangeCleanDilation', '7')
    pg.click('#btnSaveSettings')
    pg.check('#toggleStepClean')
    check('Nhãn nút chính đổi theo bước', 'Tẩy chữ + OCR + Dịch' in pg.inner_text('#btnProcessAllLabel'))

    # --- Upload 3 trang
    pg.set_input_files('#fileInputMultiple', ['page1.jpg', 'page2.jpg', 'page3.jpg'])
    pg.wait_for_function('document.querySelectorAll(".manga-row-card").length === 3', timeout=15000)
    check('3 trang đã thêm', pg.locator('.manga-row-card').count() == 3)

    # Page 3 (w=790) hỏng cả tẩy lẫn dịch; page 2 (w=800) bị Vercel 413 -> phải gọi thẳng backend
    pg.evaluate('window.__mock.cleanFailW=[790]; window.__mock.transFailW=[790]; window.__mock.proxy413W=[800]')
    pg.click('#btnProcessAll')
    pg.wait_for_function('!document.getElementById("btnProcessAll").disabled && document.querySelectorAll(".badge-status.processing").length===0 && document.querySelectorAll(".badge-clean.processing").length===0', timeout=40000)
    pg.wait_for_timeout(2500)
    cl = calls(pg, 'clean')
    check('Tẩy chữ gửi ẢNH GỐC (2000x3000) cho trang lớn', any(c['w'] == 2000 and c['h'] == 3000 for c in cl), str([(c['w'], c['h']) for c in cl]))
    check('Tham số tẩy từ Settings (big-lama, dilation 7)', all(c['model'] == 'big-lama' and c['dil'] == 7 for c in cl))
    check('Tối đa 2 request tẩy đồng thời', pg.evaluate('window.__maxInflight') == 2, str(pg.evaluate('window.__maxInflight')))
    check('413 từ proxy -> gọi thẳng backend', any(c['direct'] and c['w'] == 800 for c in cl))
    oc = calls(pg, 'ocr')
    check('OCR chạy trên ảnh hiển thị (nén 1400px), không phải ảnh sạch', any(c['h'] == 1400 for c in oc), str([(c['w'], c['h']) for c in oc]))
    st = pg.evaluate('''() => [...document.querySelectorAll(".manga-row-card")].map(c => ({
        ocr: c.querySelector(".badge-status").textContent.trim(), clean: c.querySelector(".badge-clean").textContent.trim()}))''')
    check('Trang 1,2: tẩy XONG + OCR DONE', st[0]['clean'].endswith('XONG') and st[1]['clean'].endswith('XONG') and st[0]['ocr'] == 'DONE' and st[1]['ocr'] == 'DONE', str(st))
    check('Trang 3: tẩy LỖI + OCR ERROR (trạng thái riêng từng bước)', st[2]['clean'].endswith('LỖI') and st[2]['ocr'] == 'ERROR', str(st[2]))
    pg.screenshot(path='/tmp/p1_after_run1_390.png')

    # --- Reload: dữ liệu IndexedDB còn, chạy tiếp chỉ phần còn lại
    pg.reload(wait_until='domcontentloaded')
    pg.wait_for_function('document.querySelectorAll(".manga-row-card").length === 3', timeout=15000)
    st2 = pg.evaluate('''() => [...document.querySelectorAll(".manga-row-card")].map(c => ({
        clean: c.querySelector(".badge-clean").textContent.trim(), text: c.querySelector(".textarea-vi").value}))''')
    check('Sau reload: trang 1,2 vẫn XONG và còn bản dịch', st2[0]['clean'].endswith('XONG') and st2[1]['clean'].endswith('XONG') and 'Xin chào' in st2[0]['text'] and 'Xin chào' in st2[1]['text'], str(st2))
    pg.click('#btnProcessAll')
    pg.wait_for_function('!document.getElementById("btnProcessAll").disabled', timeout=40000)
    pg.wait_for_timeout(2500)
    cl2 = calls(pg, 'clean'); oc2 = calls(pg, 'ocr')
    check('Chạy tiếp: chỉ gửi 1 request tẩy (trang 3)', len(cl2) == 1 and cl2[0]['w'] == 790, str(cl2))
    check('Chạy tiếp: chỉ gửi 1 request OCR/dịch (trang 3)', len(oc2) == 1 and oc2[0]['w'] == 790, str([(c['w'], c['mode']) for c in oc2]))
    check('Trang 3 gửi prevContext (bản dịch trang trước)', oc2 and len(oc2[0]['prev']) > 0, str(oc2[0]['prev'] if oc2 else ''))
    st3 = pg.evaluate('''() => [...document.querySelectorAll(".manga-row-card")].map(c => c.querySelector(".badge-clean").textContent.trim() + "|" + c.querySelector(".badge-status").textContent.trim())''')
    check('Cả 3 trang XONG', all(x.endswith('XONG|DONE') for x in st3), str(st3))

    # --- Overflow ngang trên Batch Studio ở 3 độ rộng (đã có 3 trang)
    for w in (360, 390, 414):
        pg.set_viewport_size({'width': w, 'height': 844})
        pg.wait_for_timeout(200)
        sw, cw = overflow(pg)
        check(f'Batch Studio không cuộn ngang ở {w}px', sw <= cw, f'{sw}/{cw}')
    pg.set_viewport_size({'width': 390, 'height': 844})

    # --- Xuất ZIP ảnh sạch + script
    pg.click('#btnExportChapter')
    with pg.expect_download(timeout=20000) as dl:
        pg.click('#btnExportZipBoth')
    path = dl.value.path()
    z = zipfile.ZipFile(path)
    names = z.namelist()
    check('ZIP có đủ 3 ảnh sạch giữ tên gốc + script.txt', sorted(names) == ['page1.png', 'page2.png', 'page3.png', 'script.txt'], str(names))
    script = z.read('script.txt').decode('utf-8-sig')
    check('script.txt đúng định dạng === tên_file ===', all(f'=== page{i}.jpg ===' in script for i in (1, 2, 3)) and 'Xin chào' in script, script[:120].replace('\n', ' / '))
    check('Ảnh trong ZIP là PNG hợp lệ', all(z.read(n)[:4] == b'\x89PNG' for n in names if n.endswith('.png')))

    pg.click('#btnExportChapter')
    with pg.expect_download(timeout=20000) as dl2:
        pg.click('#btnExportZipClean')
    z2 = zipfile.ZipFile(dl2.value.path())
    check('ZIP chỉ ảnh: không có script', sorted(z2.namelist()) == ['page1.png', 'page2.png', 'page3.png'], str(z2.namelist()))

    check('Không có lỗi JS trên trang', not errors, str(errors))
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results)-len(fails)}/{len(results)} PASS')
sys.exit(1 if fails else 0)
