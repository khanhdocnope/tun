from playwright.sync_api import sync_playwright
BASE='http://localhost:3111'; MOCK=open('mock.js',encoding='utf-8').read(); O='/mnt/user-data/outputs/'
with sync_playwright() as p:
    b=p.chromium.launch()
    def ctxnew(mock=False):
        c=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
        for pat in ('**/fonts.googleapis.com/**','**/fonts.gstatic.com/**','**/cdnjs.cloudflare.com/**'): c.route(pat,lambda r:r.abort())
        if mock: c.add_init_script(MOCK)
        return c
    c=ctxnew(); pg=c.new_page(); pg.goto(BASE+'/',wait_until='domcontentloaded'); pg.wait_for_timeout(700)
    pg.screenshot(path=O+'p1-1-trang-chinh-xoa-chu-390.png')
    pg.click('button[data-tab="tab-script-retrans"]'); pg.wait_for_timeout(300)
    pg.screenshot(path=O+'p1-2-trang-chinh-dich-lai-390.png'); c.close()
    c=ctxnew(True); pg=c.new_page(); pg.goto(BASE+'/batch-studio',wait_until='domcontentloaded'); pg.wait_for_timeout(600)
    pg.screenshot(path=O+'p1-3-batch-studio-trong-390.png')
    pg.click('#btnSettings'); pg.wait_for_timeout(300); pg.evaluate("document.querySelector('#settingsModal .modal-body').scrollTop=520"); pg.wait_for_timeout(200)
    pg.screenshot(path=O+'p1-4-cai-dat-tay-chu-390.png'); pg.click('#btnCancelSettings')
    pg.check('#toggleStepClean')
    pg.set_input_files('#fileInputMultiple',['page1.jpg','page2.jpg','page3.jpg']); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length===3')
    pg.evaluate('window.__mock.cleanFailW=[790]; window.__mock.transFailW=[790]')
    pg.click('#btnProcessAll'); pg.wait_for_function('!document.getElementById("btnProcessAll").disabled',timeout=40000); pg.wait_for_timeout(2500)
    pg.screenshot(path=O+'p1-5-batch-studio-sau-khi-chay-390.png')
    pg.click('#btnExportChapter'); pg.wait_for_timeout(200); pg.screenshot(path=O+'p1-6-menu-xuat-zip-390.png')
    b.close()
