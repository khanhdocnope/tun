import sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:3111'
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844})
    for pat in ('**/fonts.googleapis.com/**','**/fonts.gstatic.com/**','**/cdnjs.cloudflare.com/**'): ctx.route(pat,lambda r:r.abort())
    pg=ctx.new_page(); pg.goto(BASE+'/api/health')   # cùng origin, chưa mở DB
    pg.evaluate('''async (png) => new Promise((resolve,reject)=>{
      const r=indexedDB.open('manga_studio_batch',1);
      r.onupgradeneeded=()=>{const db=r.result; db.createObjectStore('pages',{keyPath:'id'}); db.createObjectStore('state',{keyPath:'id'});};
      r.onsuccess=()=>{const db=r.result; const tx=db.transaction(['pages','state'],'readwrite');
        tx.objectStore('pages').put({id:'img_old_1',seq:1,name:'cu1.jpg',sizeStr:'1 KB',base64:png});
        tx.objectStore('state').put({id:'img_old_1',status:'done',stage:2,ocrText:'古い',viText:'Bản dịch cũ',updatedAt:1});
        tx.oncomplete=()=>{db.close();resolve(true)};};
      r.onerror=()=>reject(r.error);
    })''', PNG)
    pg.goto(BASE+'/batch-studio',wait_until='domcontentloaded'); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length===1',timeout=10000)
    row=pg.evaluate('''()=>({name:document.querySelector('.row-title').textContent, vi:document.querySelector('.textarea-vi').value, jp:document.querySelector('.textarea-jp').value, st:document.querySelector('.badge-status').textContent.trim(), cl:document.querySelector('.badge-clean').textContent.trim()})''')
    print(row)
    ok1 = 'cu1.jpg' in row['name'] and row['vi']=='Bản dịch cũ' and row['jp']=='古い' and row['st']=='DONE' and row['cl'].endswith('CHỜ')
    print('PASS' if ok1 else 'FAIL','dữ liệu v1 còn nguyên sau khi nâng cấp, trạng thái tẩy mặc định CHỜ')
    info=pg.evaluate('''()=>new Promise(res=>{const r=indexedDB.open('manga_studio_batch'); r.onsuccess=()=>{const db=r.result; res({v:db.version,stores:[...db.objectStoreNames].sort()}); db.close();}})''')
    print(info)
    ok2 = info['v']==2 and info['stores']==['cleaned','originals','pages','state']
    print('PASS' if ok2 else 'FAIL','DB version 2 với 4 kho')
    # Reload lần 2: không mất dữ liệu
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_function('document.querySelectorAll(".manga-row-card").length===1',timeout=10000)
    print('PASS' if pg.evaluate("document.querySelector('.textarea-vi').value")=='Bản dịch cũ' else 'FAIL','reload lần 2 vẫn còn dữ liệu')
    # Xóa 1 trang / Clear all xóa sạch cả 4 kho
    pg.once('dialog', lambda d: d.accept()); pg.click('#btnClearAll'); pg.wait_for_timeout(500)
    cnt=pg.evaluate('''()=>new Promise(res=>{const r=indexedDB.open('manga_studio_batch'); r.onsuccess=()=>{const db=r.result; const tx=db.transaction([...db.objectStoreNames]); const out={}; [...db.objectStoreNames].forEach(n=>{const q=tx.objectStore(n).count(); q.onsuccess=()=>out[n]=q.result}); tx.oncomplete=()=>{res(out);db.close()}}})''')
    print(cnt); print('PASS' if all(v==0 for v in cnt.values()) else 'FAIL','Clear all xóa cả 4 kho')
    b.close(); sys.exit(0 if (ok1 and ok2) else 1)
