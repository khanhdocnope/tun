import sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:3111'; res=[]
def check(n,c,e=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ')+n+(f'  [{e}]' if e else ''))
def ctxnew(b,w=390):
    ctx=b.new_context(viewport={'width':w,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
    for pat in ('**/fonts.googleapis.com/**','**/fonts.gstatic.com/**','**/cdnjs.cloudflare.com/**'): ctx.route(pat,lambda r:r.abort())
    return ctx
with sync_playwright() as p:
    b=p.chromium.launch()
    for w in (360,390,414):
        ctx=ctxnew(b,w); pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto(BASE+'/',wait_until='domcontentloaded'); pg.wait_for_timeout(600)
        vis=pg.evaluate('[...document.querySelectorAll(".tab-btn")].filter(b=>b.offsetParent!==null).map(b=>b.dataset.tab)')
        if w==360: check('Chỉ còn 2 tab hiển thị',vis==['tab-cleaner','tab-script-retrans'],str(vis))
        nav=pg.evaluate('(()=>{const n=document.querySelector(".tab-nav");return [n.scrollWidth,n.clientWidth]})()')
        check(f'Thanh tab vừa khung, không vuốt ngang ở {w}px',nav[0]<=nav[1],str(nav))
        h=pg.evaluate('(()=>{const t=document.querySelector(".brand-text h1"); const s=document.querySelector(".brand-text span"); const r=t.getBoundingClientRect(); const lh=parseFloat(getComputedStyle(t).lineHeight)||r.height; return {sub:getComputedStyle(s).display, h1h:Math.round(r.height), ws:getComputedStyle(t).whiteSpace, clipped:t.scrollWidth>t.clientWidth}})()')
        check(f'Header {w}px: ẩn phụ đề, tên app 1 dòng, không bị cắt',h['sub']=='none' and h['ws']=='nowrap' and not h['clipped'] and h['h1h']<30,str(h))
        sw=pg.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth]'); check(f'Tab Xóa chữ không cuộn ngang ở {w}px',sw[0]<=sw[1],str(sw))
        pg.click('button[data-tab="tab-script-retrans"]'); pg.wait_for_timeout(300)
        sw=pg.evaluate('[document.documentElement.scrollWidth,document.documentElement.clientWidth]'); check(f'Tab Dịch lại script không cuộn ngang ở {w}px',sw[0]<=sw[1],str(sw))
        if w==390: pg.screenshot(path='/tmp/p1_main_retrans_390.png')
        link=pg.evaluate('(()=>{const a=document.querySelector(".nav-batch-link"); return [a.getAttribute("href"),a.getAttribute("target"),a.innerText.trim()]})()')
        if w==390: check('Link header → /batch-studio, cùng tab',link[0]=='/batch-studio' and link[1] is None,str(link))
        if w==390: check('Không còn iframe/target=_blank tới Batch Studio',pg.evaluate('document.querySelectorAll("iframe").length')==0 and pg.evaluate('document.querySelectorAll("a[target=_blank][href*=batch-studio]").length')==0)
        check(f'Không lỗi JS ({w}px)',not errs,str(errs)); ctx.close()
    # Click link -> điều hướng cùng tab
    ctx=ctxnew(b); pg=ctx.new_page(); pg.goto(BASE+'/',wait_until='domcontentloaded'); pg.click('.nav-batch-link'); pg.wait_for_url('**/batch-studio',timeout=8000)
    check('Bấm "Chương" mở /batch-studio ngay trong tab hiện tại',pg.url.endswith('/batch-studio') and len(ctx.pages)==1); ctx.close()
    # Desktop: nhãn đầy đủ
    ctx=b.new_context(viewport={'width':1280,'height':800}); 
    for pat in ('**/fonts.googleapis.com/**','**/fonts.gstatic.com/**','**/cdnjs.cloudflare.com/**'): ctx.route(pat,lambda r:r.abort())
    pg=ctx.new_page(); pg.goto(BASE+'/',wait_until='domcontentloaded'); pg.wait_for_timeout(400)
    check('Desktop: nhãn đầy đủ "Chương (hàng loạt)"',pg.evaluate('getComputedStyle(document.querySelector(".lbl-full")).display')!='none'); pg.screenshot(path='/tmp/p1_main_desktop.png'); ctx.close()
    # LEGACY_TABS = true -> 4 tab, tab cũ dùng được
    ctx=ctxnew(b); 
    def patch(route):
        r=route.fetch(); body=r.text().replace('const LEGACY_TABS = false;','const LEGACY_TABS = true;'); route.fulfill(response=r,body=body)
    ctx.route('**/index.html',patch); ctx.route(BASE+'/',patch)
    pg=ctx.new_page(); pg.goto(BASE+'/',wait_until='domcontentloaded'); pg.wait_for_timeout(500)
    vis=pg.evaluate('[...document.querySelectorAll(".tab-btn")].filter(b=>b.offsetParent!==null).map(b=>b.dataset.tab)')
    check('LEGACY_TABS=true: hiện lại tab-translator và tab-batch',set(vis)=={'tab-cleaner','tab-script-retrans','tab-translator','tab-batch'},str(vis))
    pg.click('button[data-tab="tab-translator"]'); check('Tab cũ vẫn hoạt động (mã cũ còn nguyên)',pg.evaluate('document.getElementById("tab-translator").classList.contains("active")')); ctx.close()
    b.close()
print(f'{sum(res)}/{len(res)} PASS'); sys.exit(0 if all(res) else 1)
