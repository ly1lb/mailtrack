const { chromium } = require('playwright');
const BASE='http://127.0.0.1:8775';
const PAGES=['', 'new', 'clicks', 'templates', 'documents', 'setup', 'settings', 'users', 'logs', 'diagnostics', 'email/1'];
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const rows=[];
  for (const [name,w,h] of [['PC',1280,900],['Tel',390,844]]) {
    const ctx=await b.newContext({viewport:{width:w,height:h}});
    const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(BASE+'/login');
    await p.fill('input[name=email]','a@t.lt'); await p.fill('input[name=password]','password123');
    await p.click('button.btn.primary'); await p.waitForTimeout(500);
    for (const pg of PAGES) {
      const r = await p.goto(BASE+'/'+pg);
      await p.waitForTimeout(250);
      const ov = await p.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 1);
      // ar yra elementu, iseinanciu uz ekrano ribu
      const wide = await p.evaluate(()=>{
        let n=0; document.querySelectorAll('body *').forEach(el=>{
          const r=el.getBoundingClientRect();
          if (r.width>0 && r.right > window.innerWidth + 2) n++;
        }); return n;
      });
      rows.push({rezimas:name, psl:'/'+pg, http:r.status(), slinkimas:ov, plaČiauNeiEkranas:wide, klaidos:errs.length});
    }
    await ctx.close();
  }
  console.table(rows);
  const bad = rows.filter(r=>r.http>=400 || r.slinkimas || r.klaidos>0);
  console.log(bad.length ? 'PROBLEMOS: '+JSON.stringify(bad) : 'VISI PUSLAPIAI ŠVARŪS');
  await b.close();
})();
