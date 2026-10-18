import sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:3111'; MOCK=open('mock.js',encoding='utf-8').read()
res=[]
def check(n,c,e=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+(f'  [{e}]' if e else ''))
with sync_playwright() as p:
    b=p.chromium.launch(); 
    def newpage():
        ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        for pat in ('**/fonts.googleapis.com/**','**/fonts.gstatic.com/**','**/cdnjs.cloudflare.com/**'): ctx.route(pat,lambda r:r.abort())
        ctx.add_init_script(MOCK); pg=ctx.new_page(); pg.goto(BASE+'/batch-studio',wait_until='domcontentloaded'); pg.wait_for_timeout(500); return pg
    # 1) retry 503
    pg=newpage()
    pg.set_input_files('#fileInputMultiple',['page2.jpg']); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length===1')
    pg.evaluate('window.__mock.failFirst=2')   # lần thử 1: proxy 503 + direct 503; lần thử 2: thành công
    pg.click('.btn-row-clean')
    pg.wait_for_function('document.querySelector(".badge-clean").textContent.includes("XONG")',timeout=15000)
    n=len(pg.evaluate('window.__calls'))
    check('Retry: lỗi 503 tạm thời được thử lại rồi thành công',n==3,f'{n} request')
    # 2) Dừng giữa chừng: 4 trang, delay dài, bấm Dừng sau khi bắt đầu
    pg=newpage()
    pg.evaluate('window.__mock.delay=1500')
    pg.set_input_files('#fileInputMultiple',['page2.jpg','page3.jpg','page2.jpg','page3.jpg']); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length===4')
    pg.click('#btnCleanAll'); pg.wait_for_timeout(600); pg.click('#btnStopQueue')
    pg.wait_for_function('!document.getElementById("btnCleanAll").disabled',timeout=20000)
    done=pg.evaluate('document.querySelectorAll(".badge-clean.done").length'); idle=pg.evaluate('document.querySelectorAll(".badge-clean.idle").length')
    check('Dừng: 2 trang đang chạy hoàn tất, 2 trang còn lại giữ CHỜ',done==2 and idle==2,f'done={done} idle={idle}')
    # 3) Nhập ZIP
    import zipfile,io
    z=zipfile.ZipFile('/tmp/in.zip','w'); 
    for n in ('p10.jpg','p2.jpg','p1.jpg'): z.write('page2.jpg','sub/'+n)
    z.write('page2.jpg','__MACOSX/._p1.jpg'); z.writestr('readme.txt','x'); z.close()
    pg=newpage(); pg.set_input_files('#fileInputMultiple','/tmp/in.zip'); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length>=3',timeout=15000)
    names=pg.evaluate('[...document.querySelectorAll(".row-title")].map(e=>e.textContent)')
    check('Nhập ZIP: sắp xếp tự nhiên, bỏ __MACOSX và file không phải ảnh',len(names)==3 and 'p1.jpg' in names[0] and 'p2.jpg' in names[1] and 'p10.jpg' in names[2],str(names))
    b.close()
print(f'{sum(res)}/{len(res)} PASS'); sys.exit(0 if all(res) else 1)
