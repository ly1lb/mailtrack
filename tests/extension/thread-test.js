/* Regresijos testas: ženklai gijoje ir sąraše (be dublikatų, be klaidingų
   „seka“ ženklų dėl cituoto teksto), atsakymo siuntimas pašalina seną pikselį. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '../../chrome-extension');
const DIR = __dirname;
let src = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
src = src.replace(/if \(!location\.hostname\.endsWith\('mail\.google\.com'\)\) return;/, '/* test: hostname guard off */');
fs.writeFileSync(path.join(DIR, 'content-test.js'), src);
fs.copyFileSync(path.join(EXT, 'sha256.js'), path.join(DIR, 'sha256.js'));
fs.copyFileSync(path.join(EXT, 'content.css'), path.join(DIR, 'content.css'));

let fails = 0;
function check(name, cond, got) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got)));
  if (!cond) fails++;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(DIR, 'thread-sim.html'));
  await page.addStyleTag({ path: path.join(DIR, 'content.css') });
  await page.waitForTimeout(1200);

  // Sukeliam kelis papildomus ciklus (Gmail nuolat keičia DOM)
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => document.body.appendChild(document.createElement('i')));
    await page.waitForTimeout(350);
  }

  const r = await page.evaluate(() => {
    function bar(id) { var m = document.getElementById(id); var out = []; for (var p = m.previousElementSibling; p && /mt-/.test(p.className); p = p.previousElementSibling) out.push(p.className + ':' + p.textContent.trim()); return out; }
    function marks(id) { var b = document.querySelector('#' + id + ' .mt-marks'); return b ? { text: b.textContent.trim(), eye: !!b.querySelector('.mt-eye'), on: !!b.querySelector('.mt-ck.on'), count: document.querySelectorAll('#' + id + ' .mt-marks').length } : null; }
    var sv = window.__calls.filter(function (c) { return c.type === 'api' && c.path === 'selfview'; });
    return {
      mine: bar('msgMine'), egle: bar('msgEgle'), aiste: bar('msgAiste'),
      rowEgle: marks('rowEgle'), rowOther: marks('rowOtherSameSubj'), rowAiste: marks('rowAiste'),
      rowGmailOther: marks('rowGmailOther'), rowUnopened: marks('rowUnopened'),
      selfview: sv.map(function (c) { return c.body; }),
      oldStore: 'trackSenders' in window.__store, senders: window.__store.trackSenders2 || {}
    };
  });

  check('mano laiškas: viena juosta su ✓✓ ir ↪', r.mine.length === 1 && /✓✓ Atidaryta 7 k\./.test(r.mine[0]) && /Galimai persiųstas/.test(r.mine[0]), r.mine);
  check('mano laiškas: be „Seka“ (mano paties Mailtrack pikselis)', !/Seka/.test(r.mine.join()), r.mine);
  check('Eglės atsakymas: jokių ženklų (pikseliai tik citatoje)', r.egle.length === 0 || r.egle.every(x => x.trim().endsWith(':')), r.egle);
  check('Aistės atsakymas: tik vienas „Seka: Mailtrack“', r.aiste.length === 1 && /Seka: Mailtrack/.test(r.aiste[0]) && !/Atidaryta/.test(r.aiste[0]), r.aiste);
  check('senas domeno sąrašas išmestas', r.oldStore === false, r.oldStore);
  check('sekančiu pažymėta tik aiste@gmail.com', JSON.stringify(Object.keys(r.senders)) === '["aiste@gmail.com"]', r.senders);
  check('selfview išsiųstas mūsų uid', r.selfview.length >= 1 && r.selfview.some(b => (b.uids || []).indexOf('OLDUID12345678') !== -1), r.selfview);
  check('sąrašas: Eglės gija ✓✓ + ↪, be 👁', r.rowEgle && r.rowEgle.on && /↪/.test(r.rowEgle.text) && !r.rowEgle.eye && r.rowEgle.count === 1, r.rowEgle);
  check('sąrašas: ta pati tema, kitas gavėjas – be ženklo', r.rowOther === null, r.rowOther);
  check('sąrašas: Aistė – tik 👁', r.rowAiste && r.rowAiste.eye && r.rowAiste.text === '', r.rowAiste);
  check('sąrašas: kitas @gmail.com – be ženklo', r.rowGmailOther === null, r.rowGmailOther);
  check('sąrašas: neatidarytas – pilkas ✓', r.rowUnopened && r.rowUnopened.text === '✓' && !r.rowUnopened.on, r.rowUnopened);

  // CPU: ramybės būsenoje mūsų kodas neturi nuolat keisti DOM
  const idleMut = await page.evaluate(() => new Promise(res => {
    var n = 0; var mo = new MutationObserver(m => { n += m.length; });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    setTimeout(() => { mo.disconnect(); res(n); }, 2000);
  }));
  check('ramybėje DOM nekeičiamas (nėra begalinio ciklo)', idleMut === 0, idleMut);

  // Istorija: spustelim ✓✓ sąraše
  await page.locator('#rowEgle .mt-ck').click();
  await page.waitForTimeout(300);
  const pop = await page.evaluate(() => { var p = document.querySelector('.mt-pop'); return p ? p.innerText : null; });
  check('spustelėjus ✓✓ atsidaro istorija', pop && /Fotosesija/.test(pop) && /Vilnius/.test(pop), pop);
  await page.screenshot({ path: path.join(DIR, 'shot-thread.png') });
  await page.keyboard.press('Escape');

  // Atsakymo siuntimas
  await page.locator('#send').click();
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    var b = document.getElementById('body');
    var px = b.querySelectorAll('img.mt-px');
    var q = b.querySelector('.gmail_quote');
    return {
      reg: window.__registered,
      oldPixelLeft: !!b.querySelector('img[src*="OLDUID"]'),
      newPixels: px.length,
      pixelBeforeQuote: px.length === 1 && !!(px[0].compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING),
      hrefs: Array.from(b.querySelectorAll('a')).map(a => a.getAttribute('href'))
    };
  });
  check('siunčiant: senas pikselis pašalintas iš citatos', !s.oldPixelLeft, s);
  check('siunčiant: naujas pikselis vienas ir prieš citatą', s.newPixels === 1 && s.pixelBeforeQuote, s);
  check('siunčiant: quotes = [OLDUID…]', s.reg && JSON.stringify(s.reg.quotes) === '["OLDUID12345678"]', s.reg);
  check('siunčiant: perrašyta tik nauja nuoroda', /track\.test\/c\//.test(s.hrefs[0]) && s.hrefs[1] === 'https://senas.lt', s.hrefs);
  check('siunčiant: gavėjas egle@gmail.com', s.reg && s.reg.recipients.indexOf('egle@gmail.com') !== -1, s.reg && s.reg.recipients);

  check('be JS klaidų', errors.length === 0, errors);
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAIL' : '\nVISKAS OK');
  process.exit(fails ? 1 : 0);
})();
