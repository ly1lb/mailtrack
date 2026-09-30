// Tikrinam POPUP -> content script kelia (chrome.runtime.onMessage)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const EXT='/home/user/mailtrack/chrome-extension', DIR=__dirname;
let src = fs.readFileSync(path.join(EXT,'content.js'),'utf8')
  .replace(/if \(!location\.hostname\.endsWith\('mail\.google\.com'\)\) return;/,'/* off */');
fs.writeFileSync(path.join(DIR,'content-test.js'), src);

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div role="dialog" id="compose">
  <input name="subjectbox" value="">
  <div aria-label="Laiško turinys" contenteditable="true" id="body"><div>Pagarbiai<br>Lukas</div></div>
  <div id="toolbar"><div role="button" data-tooltip="Siųsti" id="sendOuter">
    <div role="button" aria-label="Siųsti" id="sendInner">Siųsti</div></div></div>
</div>
<script>
// Gmail perima viska savo juostoje
var tb=document.getElementById('toolbar');
['pointerdown','mousedown','click'].forEach(function(t){tb.addEventListener(t,function(e){
  e.stopPropagation(); e.stopImmediatePropagation();},true);});
// fake chrome + surenkam onMessage klausytoja
window.__listeners=[];
window.chrome={runtime:{lastError:null,getManifest:()=>({version:'1.1.0'}),
  sendMessage:(m,cb)=>{setTimeout(()=>{ if(m.type==='config') cb({ok:true,cfg:{serverUrl:'https://track.test',apiKey:'k'.repeat(30),linkSecret:'abc',trackByDefault:true,trackLinks:true,showTplButton:false}}); else cb({ok:true,data:{ok:true,templates:[],items:[],emails:[]}}); },5);},
  onMessage:{addListener:(fn)=>{window.__listeners.push(fn);}}},
  storage:{sync:{get:(d,cb)=>cb(d)},onChanged:{addListener:()=>{}}}};
</script>
<script src="sha256.js"></script><script src="content-test.js"></script>
</body></html>`;
fs.writeFileSync(path.join(DIR,'popup-sim.html'), html);

(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.join(DIR,'popup-sim.html'));
  await p.waitForTimeout(800);
  const r = await p.evaluate(()=>{
    // imituojam popup zinute
    var out=null;
    window.__listeners.forEach(fn=>{
      fn({type:'mt-insert-template', template:{id:1,name:'T',subject:'Tema is popup',body_html:'<p>Turinys is popup</p>'}}, {}, res=>{out=res;});
    });
    return {resp:out, subject:document.querySelector('input[name=subjectbox]').value,
            body:document.getElementById('body').innerHTML,
            tplButtonHidden: document.querySelectorAll('.mt-tplbar').length};
  });
  console.log(JSON.stringify({...r, errors:errs}, null, 2));
  await b.close();
})();
