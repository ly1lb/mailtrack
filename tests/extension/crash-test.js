// Atkartojam TIKSLIAI ta klaida: .gs yra TOLIMAS protevis, ne tiesioginis tevas
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const EXT='/home/user/mailtrack/chrome-extension', DIR=__dirname;
fs.writeFileSync(path.join(DIR,'content-test.js'),
  fs.readFileSync(path.join(EXT,'content.js'),'utf8')
    .replace(/if \(!location\.hostname\.endsWith\('mail\.google\.com'\)\) return;/,'/* off */'));
fs.copyFileSync(path.join(EXT,'sha256.js'), path.join(DIR,'sha256.js'));

const html=`<!doctype html><html><head><meta charset="utf-8"></head><body>
<!-- TIKROVISKA Gmail struktura: .gs -> .. -> .. -> div.a3s (keli lygiai!) -->
<div class="gs">
  <div class="gE"><span>Siuntejas</span></div>
  <div class="ii gt">
    <div class="a3s aiL" id="received">
      <p>Sveiki</p>
      <img src="https://mailtrack.io/trace/mail/abc.png" width="1" height="1">
    </div>
  </div>
</div>
<div class="gs">
  <div class="ii gt"><div class="a3s aiL" id="ourMail">
    <p>Musu siunciamas</p>
    <img src="https://track.test/o/AbCdEfGhIjKlMnOpQr.gif" width="1" height="1">
  </div></div>
</div>
<div role="dialog" id="compose">
  <input name="subjectbox" value="">
  <div aria-label="Laiskas" contenteditable="true" id="body"><div>Parasas</div></div>
  <div id="toolbar"><div role="button" data-tooltip="Siųsti" id="sendInner">Siųsti</div></div>
</div>
<table><tr class="zA"><td class="xW"><span class="bog">Tema viena</span></td></tr></table>
<script>
window.location.hash='#sent';
window.chrome={runtime:{lastError:null,getManifest:()=>({version:'1.1.0'}),
 sendMessage:(m,cb)=>{setTimeout(()=>{
   if(m.type==='config')cb({ok:true,cfg:{serverUrl:'https://track.test',apiKey:'k'.repeat(30),linkSecret:'abc',trackByDefault:true,trackLinks:true,showTplButton:true}});
   else if(m.type==='api'&&String(m.path).indexOf('emails/')===0)cb({ok:true,data:{ok:true,open_count:3,last_open_at:'2026-09-30T10:00:00Z',click_count:1,dashboard_url:'https://track.test/email/1'}});
   else if(m.type==='api'&&String(m.path).indexOf('emails')===0)cb({ok:true,data:{ok:true,emails:[{uid:'u1',subject:'Tema viena',open_count:2}]}});
   else if(m.type==='api'&&String(m.path).indexOf('activity')===0)cb({ok:true,data:{ok:true,items:[],opens_today:1,tracked:5}});
   else cb({ok:true,data:{ok:true,templates:[]}});},5);},
 onMessage:{addListener:()=>{}}},storage:{sync:{get:(d,cb)=>cb(d)},onChanged:{addListener:()=>{}}}};
</script>
<script src="sha256.js"></script><script src="content-test.js"></script></body></html>`;
fs.writeFileSync(path.join(DIR,'crash-sim.html'),html);

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.join(DIR,'crash-sim.html'));
  await p.waitForTimeout(1500);
  const r=await p.evaluate(()=>({
    uncaughtCrash: null,
    trackedByBadge: document.querySelectorAll('.mt-tracked-by').length,
    trackedByText: (document.querySelector('.mt-tracked-by')||{}).textContent||'(nera)',
    openBanner: document.querySelectorAll('.mt-banner').length,
    openBannerText: (document.querySelector('.mt-banner')||{}).textContent||'(nera)',
    fabExists: document.querySelectorAll('.mt-fab').length,
    listBadge: document.querySelectorAll('.mt-list-badge').length,
    tplButton: document.querySelectorAll('.mt-tpl').length
  }));
  console.log(JSON.stringify({...r, pageErrors: errs}, null, 2));
  await b.close();
})();
