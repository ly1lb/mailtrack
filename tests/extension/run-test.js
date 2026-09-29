const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXT = '/home/user/mailtrack/chrome-extension';
const DIR = __dirname;

// content.js turi hostname apsaugą – testui ją pašalinam (logika nesikeičia)
let src = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
src = src.replace(/if \(!location\.hostname\.endsWith\('mail\.google\.com'\)\) return;/,
                  '/* test: hostname guard off */');
fs.writeFileSync(path.join(DIR, 'content-test.js'), src);
fs.copyFileSync(path.join(EXT, 'sha256.js'), path.join(DIR, 'sha256.js'));
fs.copyFileSync(path.join(EXT, 'content.css'), path.join(DIR, 'content.css'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + path.join(DIR, 'gmail-sim.html'));
  await page.addStyleTag({ path: path.join(DIR, 'content.css') });
  await page.waitForTimeout(900); // leidžiam boot + observer

  const results = {};

  // 1) Kiek mygtukų atsirado?
  results.toggles = await page.locator('.mt-track-toggle').count();
  results.tplButtons = await page.locator('.mt-tpl').count();

  // 2) Ar Gmail interceptorius tikrai veikia (turi būti >0 po paspaudimo)?
  // 3) Paspaudžiam Šablonai
  const tpl = page.locator('.mt-tpl').first();
  if (await tpl.count()) {
    await tpl.click({ force: true });
    await page.waitForTimeout(400);
  }
  results.menuVisible = await page.locator('.mt-menu').count();
  results.menuItems = await page.locator('.mt-menu .mt-menu-item').count();
  results.menuText = await page.locator('.mt-menu').first().innerText().catch(() => '(nėra)');
  results.gmailSwallowed = await page.evaluate(() => window.__gmailSwallowed || 0);

  // 4) Įterpiam pirmą šabloną ir tikrinam ar pateko į laiško kūną + temą
  if (results.menuItems > 0) {
    await page.locator('.mt-menu .mt-menu-item').first().click({ force: true });
    await page.waitForTimeout(300);
  }
  results.subject = await page.locator('input[name="subjectbox"]').inputValue();
  results.bodyHtml = await page.locator('#body').innerHTML();

  // 4b) Ar aptiko svetima sekikli gautame laiske?
  results.trackedByBadge = await page.locator('.mt-tracked-by').count();
  results.trackedByText = await page.locator('.mt-tracked-by').first().innerText().catch(() => '(nera)');
  // 4c) Ar sablonu mygtukas YRA VIRS laisko teksto (ne apatineje juostoje)?
  results.tplAboveBody = await page.evaluate(() => {
    var bar = document.querySelector('.mt-tplbar');
    var body = document.getElementById('body');
    if (!bar || !body) return false;
    return !!(bar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // 5) Sekimo jungiklis persijungia?
  const tog = page.locator('.mt-track-toggle').first();
  results.toggleBefore = await tog.innerText();
  await tog.click({ force: true });
  await page.waitForTimeout(200);
  results.toggleAfter = await tog.innerText();

  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
