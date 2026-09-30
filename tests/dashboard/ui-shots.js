const { chromium } = require('playwright');
const BASE='http://127.0.0.1:8775';
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const out=[];
  for (const [name,w,h] of [['desktop',1280,900],['mobile',390,844]]) {
    const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:2});
    const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto(BASE+'/login');
    await p.fill('input[name=email]','a@t.lt');
    await p.fill('input[name=password]','password123');
    await p.click('button.btn.primary');
    await p.waitForTimeout(700);
    // ar yra horizontalus slinkimas (bloga telefone)?
    const overflow = await p.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 1);
    if (name==='mobile') { await p.click('#burger'); await p.waitForTimeout(250); }
    await p.screenshot({path:`shot-${name}-dash.png`, fullPage:false});
    if (name==='mobile') { await p.click('#burger'); await p.waitForTimeout(200); }
    await p.goto(BASE+'/clicks'); await p.waitForTimeout(400);
    await p.screenshot({path:`shot-${name}-clicks.png`, fullPage:false});
    const overflow2 = await p.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 1);
    out.push({name, w, horizontalOverflowDash: overflow, horizontalOverflowClicks: overflow2, errors: errs});
    await ctx.close();
  }
  console.log(JSON.stringify(out,null,2));
  await b.close();
})();
