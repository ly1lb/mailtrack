/* MailTrack Pro – Gmail turinio skriptas.
   1) Rašymo lange prideda VIENĄ "✓✓ Sekti" jungiklį; paspaudus "Siųsti" įterpia
      sekimo pikselį, (pasirinktinai) perrašo nuorodas su HMAC parašu ir pašalina
      SENUS mūsų pikselius iš cituoto teksto (kitaip atsakymas „atidarinėtų“ seną laišką).
   2) Kai TU pats atidarai savo sekamą laišką, praneša serveriui (selfview),
      kad Gmail proxy užkrovimas nebūtų suskaičiuotas kaip gavėjo atidarymas.
   3) Ženklai (kaip Mailsuite, bet aiškiau atskirti):
        ✓  pilka   – jūsų sekamas laiškas, dar neatidarytas
        ✓✓ žalia   – jūsų sekamas laiškas atidarytas
        ↪  oranžinė – galimai persiųstas
        👁 violetinė – SIUNTĖJAS seka jus (jo laiške yra sekimo pikselis)
      Vienam laiškui – viena juosta, be dublikatų; cituotas tekstas ignoruojamas. */
(function () {
  'use strict';
  if (!location.hostname.endsWith('mail.google.com')) return;

  var CFG = null;
  var ready = false;
  var lastComposeState = null;   // paskutinis aptiktas rašymo langas
  var subjectIndex = {};     // normalizuota tema -> [laiškai] (naujausi pirmi)
  var lastStatusFetch = 0;
  var trackSenders = {};     // TIKSLŪS siuntėjų adresai, kurių laiškuose aptikome sekiklį
  var learnedMine = {};      // jūsų adresai (aptikti automatiškai)
  var statusCache = {};      // uid -> {d: laiško duomenys, t: kada gauta}

  // ================= SAUGYKLA =================
  function loadLocal() {
    try {
      chrome.storage.local.get({ trackSenders2: {}, myEmails: {} }, function (s) {
        if (chrome.runtime.lastError) return;
        trackSenders = s.trackSenders2 || {};
        learnedMine = s.myEmails || {};
        mineCache = null;
      });
      // Senoji versija žymėjo VISĄ domeną (pvz. visus @gmail.com) – dėl to raudoni
      // taškai buvo beveik prie kiekvieno laiško. Tuos duomenis išmetam.
      chrome.storage.local.remove('trackSenders');
    } catch (e) {}
  }
  function rememberTrackSender(email, label) {
    email = String(email || '').toLowerCase();
    if (!email || isMine(email)) return;
    if (trackSenders[email] === label) return;
    trackSenders[email] = label;
    try {
      var keys = Object.keys(trackSenders);
      if (keys.length > 1000) delete trackSenders[keys[0]];
      chrome.storage.local.set({ trackSenders2: trackSenders });
    } catch (e) {}
    safe('decorateList', decorateList);
  }
  function rememberMine(email) {
    email = String(email || '').toLowerCase();
    if (!email || email.indexOf('@') < 1 || learnedMine[email]) return;
    learnedMine[email] = 1;
    mineCache = null;
    // jei šis adresas buvo klaidingai pažymėtas kaip „sekantis“ – pašalinam
    if (trackSenders[email]) { delete trackSenders[email]; try { chrome.storage.local.set({ trackSenders2: trackSenders }); } catch (e) {} }
    try { chrome.storage.local.set({ myEmails: learnedMine }); } catch (e) {}
  }

  /* Jūsų pačių adresai: iš plėtinio nustatymų, Gmail lango pavadinimo,
     Google paskyros mygtuko ir anksčiau aptiktų (pvz. „aš“ sąraše). */
  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  var mineCache = null, mineCacheAt = 0;
  function myEmails() {
    if (mineCache && Date.now() - mineCacheAt < 5000) return mineCache;
    var set = {};
    Object.keys(learnedMine).forEach(function (e) { set[e] = 1; });
    if (CFG && CFG.userEmail) set[String(CFG.userEmail).toLowerCase()] = 1;
    (document.title.match(EMAIL_RE) || []).forEach(function (e) { set[e.toLowerCase()] = 1; });
    var acc = document.querySelector('a[aria-label*="@"][href*="accounts.google.com"], a[aria-label*="@"][href*="SignOutOptions"]');
    if (acc) ((acc.getAttribute('aria-label') || '').match(EMAIL_RE) || []).forEach(function (e) { set[e.toLowerCase()] = 1; });
    mineCache = set; mineCacheAt = Date.now();
    return set;
  }
  function isMine(email) { return !!myEmails()[String(email || '').toLowerCase()]; }

  function log(message, context) {
    try { chrome.runtime.sendMessage({ type: 'log', message: message, context: context }); } catch (e) {}
  }
  function apiGet(path, cb) {
    try {
      chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: path }, function (r) {
        if (chrome.runtime.lastError) return cb && cb(null);
        cb && cb(r && r.ok ? r.data : null);
      });
    } catch (e) { cb && cb(null); }
  }
  function apiPost(path, body, cb) {
    try {
      chrome.runtime.sendMessage({ type: 'api', method: 'POST', path: path, body: body }, function (r) {
        if (chrome.runtime.lastError) return cb && cb(null);
        cb && cb(r && r.ok ? r.data : null);
      });
    } catch (e) { cb && cb(null); }
  }

  function loadCfg(cb) {
    try {
      chrome.runtime.sendMessage({ type: 'config' }, function (r) {
        if (chrome.runtime.lastError) return;
        if (r && r.ok) { CFG = r.cfg; ready = !!(CFG.serverUrl && CFG.apiKey); mineCache = null; }
        cb && cb();
      });
    } catch (e) {}
  }

  function uidGen() {
    var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '';
    var buf = new Uint8Array(22); crypto.getRandomValues(buf);
    for (var i = 0; i < 22; i++) s += a[buf[i] % 62];
    return s;
  }
  function b64url(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function sig(uid, idx, url) {
    return self.MTCrypto.hmacSha256Hex(CFG.linkSecret, uid + '|' + idx + '|' + url).slice(0, 16);
  }
  /* Mūsų pikselio atpažinimas – nepriklausomai nuo http/https (Gmail proxy gali pakeisti). */
  function pixelRegex() {
    if (!CFG || !CFG.serverUrl) return null;
    var base = CFG.serverUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return new RegExp('//' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/o/([A-Za-z0-9_-]{8,32})', 'i');
  }
  function imgSrc(img) {
    return img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-surl') || '';
  }
  function ownUid(img, re) {
    var raw = imgSrc(img);
    if (!raw) return null;
    var m = raw.match(re) || (deproxy(raw) || '').match(re);
    return m ? m[1] : null;
  }

  /* Ar elementas yra CITUOTAME tekste (ankstesnis laiškas atsakyme / persiųstame)?
     Gmail palieka „gmail_quote“ klases; kitų klientų klasės/ID gauna „m_…“ priešdėlį,
     todėl tikrinam *= / $=. Outlook citata eina po #divRplyFwdMsg / #appendonsend. */
  var QUOTE_SEL = [
    'blockquote', '[class*="gmail_quote"]', '[class*="gmail_extra"]', '[class*="yahoo_quoted"]',
    '[class*="moz-cite-prefix"] ~ *', '[id$="divRplyFwdMsg"]', '[id$="divRplyFwdMsg"] ~ *',
    '[id$="appendonsend"] ~ *', '[class*="OutlookMessageHeader"]', '[class*="OutlookMessageHeader"] ~ *',
    '[class*="zmail_extra"]', '[class*="protonmail_quote"]', '.im'
  ].join(',');
  function isQuoted(node, root) {
    var q = node.closest && node.closest(QUOTE_SEL);
    return !!(q && (!root || root.contains(q)));
  }

  // ================= RAŠYMO LANGAS =================
  function getSubject(dialog) {
    var s = dialog.querySelector('input[name="subjectbox"]');
    return s ? s.value : '';
  }
  function getBodyEl(dialog) {
    return dialog.querySelector('div[aria-label][contenteditable="true"], div[g_editable="true"][contenteditable="true"]');
  }
  function getRecipients(dialog) {
    var set = {};
    dialog.querySelectorAll('[email], [data-hovercard-id]').forEach(function (n) {
      // nekišam laiško turinio (cituoti adresai) – tik antraštės laukai
      if (n.closest('[contenteditable="true"]')) return;
      var em = n.getAttribute('email') || n.getAttribute('data-hovercard-id');
      if (em && em.indexOf('@') > 0) set[em.toLowerCase()] = 1;
    });
    dialog.querySelectorAll('textarea[name="to"], input[name="to"], textarea[name="cc"], input[name="cc"], textarea[name="bcc"], input[name="bcc"]').forEach(function (n) {
      (n.value || '').split(/[,;\s]+/).forEach(function (e) { if (e.indexOf('@') > 0) set[e.toLowerCase()] = 1; });
    });
    return Object.keys(set);
  }

  /** Vienareikšmiškai randam Siųsti mygtukus – po vieną kiekvienam rašymo langui. */
  function eachSendButton(fn) {
    var btns = document.querySelectorAll('div[role="button"][data-tooltip], div[role="button"][aria-label]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var tip = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').toLowerCase();
      // "Siųsti (Ctrl+Enter)" / "Send" – bet NE "Siųsti vėliau", "More send options", "Schedule"
      if (!/(^|[^a-z])(send|siųsti|siųsk)/.test(tip)) continue;
      if (/later|vėliau|schedule|suplanuo|option|parink|more|daugiau/.test(tip)) continue;
      fn(b);
    }
  }

  function decorateComposes() {
    if (!document.querySelector('div[role="button"]')) return;
    eachSendButton(function (sendBtn) {
      if (sendBtn.__mtDecorated) return;
      var dialog = sendBtn.closest('div[role="dialog"]') || sendBtn.closest('td') && sendBtn.closest('table') && sendBtn.closest('div.iN') || sendBtn.closest('div.M9, div.aoI, div.nH') || sendBtn.parentElement;
      var body = dialog && getBodyEl(dialog);
      if (!body) {
        // gali būti kitas mygtukas su tokiu pat pavadinimu – tik su kūnu laikom rašymo langu
        return;
      }
      // Gmail turi įdėtų role="button" elementų su ta pačia žyme (išorinis ir vidinis),
      // todėl be šios patikros mygtukai atsirasdavo po du. Vienam rašymo langui – vienas.
      if (dialog.querySelector('.mt-track-toggle')) {
        sendBtn.__mtDecorated = true;
        return;
      }
      sendBtn.__mtDecorated = true;

      var state = { on: ready && CFG.trackByDefault, dialog: dialog, body: body };
      sendBtn.__mtState = state;
      lastComposeState = state; // kad šabloną būtų galima įterpti ir iš plėtinio lango

      var toggle = document.createElement('div');
      toggle.className = 'mt-toggle mt-track-toggle';
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      var tick = document.createElement('span'); tick.className = 'mt-tick';
      var lbl = document.createElement('span'); lbl.className = 'mt-lbl';
      toggle.appendChild(tick); toggle.appendChild(lbl);
      function paint() {
        toggle.classList.toggle('on', !!state.on);
        toggle.title = ready ? (state.on ? 'Sekimas įjungtas – spauskite, kad išjungtumėte šiam laiškui' : 'Sekimas išjungtas šiam laiškui') : 'Sukonfigūruokite plėtinį';
        tick.textContent = state.on ? '✓✓' : '✓';
        lbl.textContent = state.on ? 'Sekama' : 'Sekti';
      }
      paint();
      // Paspaudimus gaudom globaliai capture fazėje (žr. žemiau) – Gmail savo
      // įrankių juostoje perima click'us ir įprastas listener'is nesuveiktų.
      toggle.__mtPaint = paint;
      toggle.__mtState = state;
      if (sendBtn.parentElement) sendBtn.parentElement.insertBefore(toggle, sendBtn.nextSibling);

      // Siuntimo mygtuką pažymim – paspaudimą pagauna globalus capture klausytojas
      // (žr. installClickCapture). Tiesioginis listener'is čia nepatikimas: Gmail
      // aukščiau esančiame konteineryje kviečia stopImmediatePropagation() ir jis
      // nesuveikia – tada pikselis bei nuorodos NEBŪTŲ įdėti.
      sendBtn.classList.add('mt-sendbtn');
      sendBtn.addEventListener('click', function () { beforeSend(state); }, true); // atsarga
      dialog.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') beforeSend(state);
      }, true);
    });
  }

  /* Mūsų sekami laiškai, matomi atidarytoje gijoje (atsakant į ją). Serveris juos
     susies su nauju laišku: kai gavėjas atidaro atsakymą, Gmail kartu užkrauna ir
     cituotą seną pikselį – tokio „atidarymo“ senam laiškui neskaičiuosim. */
  function threadUids(dialog, subject) {
    var re = pixelRegex();
    if (!re) return [];
    // atsakymas gijos viduje (ne atskiras „Naujas laiškas“ langas) arba ta pati tema
    var inThread = !!(dialog && dialog.closest && !dialog.closest('div[role="dialog"]') && document.querySelector('div.a3s'));
    var subj = normSubject(subject);
    var h2 = document.querySelector('h2.hP');
    var sameSubj = !!(h2 && subj && normSubject(h2.textContent) === subj);
    if (!inThread && !sameSubj) return [];
    var set = {};
    document.querySelectorAll('div.a3s img').forEach(function (img) {
      var uid = ownUid(img, re);
      if (uid) set[uid] = 1;
    });
    return Object.keys(set);
  }

  var handled = new WeakSet();
  function beforeSend(state) {
    try {
      if (!state || !state.on || !ready) return;
      var body = (state.dialog && getBodyEl(state.dialog)) || state.body;
      if (!body || handled.has(body) || body.querySelector('img.mt-px')) return;
      handled.add(body);

      var uid = uidGen();
      var re = pixelRegex();
      var quotes = {};
      // 1) Seni MŪSŲ pikseliai cituotame tekste – pašalinam (kitaip kiekvienas atsakymo
      //    atidarymas būtų užskaitytas ir senam laiškui → klaidingi „atidarymai“ ir
      //    „galimai persiųstas“).
      body.querySelectorAll('img').forEach(function (img) {
        if (img.classList.contains('mt-px')) return;
        var old = re && ownUid(img, re);
        if (old) { quotes[old] = 1; img.remove(); }
      });
      threadUids(state.dialog, getSubject(state.dialog)).forEach(function (u) { quotes[u] = 1; });

      // 2) Nuorodos – tik NAUJAME tekste (cituotos priklauso senam laiškui)
      var links = [];
      if (CFG.trackLinks) {
        body.querySelectorAll('a[href^="http"]').forEach(function (a, i) {
          var url = a.getAttribute('href');
          if (!url || a.__mt) return;
          if (isQuoted(a, body)) return;
          if (CFG.serverUrl && url.indexOf(CFG.serverUrl) === 0) return;
          a.setAttribute('href', CFG.serverUrl + '/c/' + uid + '/' + i + '?u=' + b64url(url) + '&s=' + sig(uid, i, url));
          a.__mt = true;
          links.push({ idx: i, url: url });
        });
      }

      // 3) Pikselis – prieš cituotą tekstą (jei jis išskleistas), kad atsakymuose
      //    jis neatsidurtų citatoje.
      var img = document.createElement('img');
      img.className = 'mt-px';
      img.src = CFG.serverUrl + '/o/' + uid + '.gif';
      img.width = 1; img.height = 1; img.alt = '';
      img.setAttribute('style', 'width:1px;height:1px;border:0;opacity:0;display:block');
      var q = null;
      for (var c = body.firstElementChild; c; c = c.nextElementSibling) {
        if (c.matches && c.matches('[class*="gmail_quote"], blockquote')) { q = c; break; }
      }
      if (q) body.insertBefore(img, q); else body.appendChild(img);

      delete quotes[uid];
      chrome.runtime.sendMessage({
        type: 'register',
        payload: {
          uid: uid, subject: getSubject(state.dialog), recipients: getRecipients(state.dialog),
          links: links, quotes: Object.keys(quotes).slice(0, 20), source: 'gmail-chrome'
        }
      }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) log('Nepavyko įtraukti laiško į eilę', { uid: uid });
      });
      lastStatusFetch = 0; // kad sąrašas iškart pamatytų naują laišką
    } catch (e) {
      log('beforeSend klaida: ' + (e && e.message), { stack: String(e && e.stack).slice(0, 200) });
    }
  }

  // ================= MINI DASHBOARD GMAIL LANGE (kaip Mailsuite panelė) =================
  var panelEl = null, fabEl = null, panelOpen = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureFab() {
    if (fabEl && document.body.contains(fabEl)) return;
    fabEl = el('div', 'mt-fab');
    fabEl.title = 'MailTrack Pro – veikla';
    fabEl.appendChild(el('span', 'mt-fab-tick', '✓✓'));
    // click'ą tvarko globalus capture klausytojas (installClickCapture)
    document.body.appendChild(fabEl);
  }

  function togglePanel() {
    if (!panelEl) buildPanel();
    panelOpen = !panelOpen;
    panelEl.classList.toggle('open', panelOpen);
    if (panelOpen) { refreshPanel(); if (fabEl) fabEl.classList.remove('pulse'); }
  }

  function buildPanel() {
    panelEl = el('div', 'mt-panel');
    var head = el('div', 'mt-panel-head');
    var title = el('span', 'mt-panel-title');
    title.appendChild(el('span', 'mt-tickg', '✓✓'));
    title.appendChild(document.createTextNode(' MailTrack Pro'));
    var acts = el('span', 'mt-panel-actions');
    var dash = el('a', 'mt-panel-dash', 'Skydelis ↗'); dash.target = '_blank';
    if (CFG && CFG.serverUrl) dash.href = CFG.serverUrl;
    var close = el('span', 'mt-panel-close', '✕'); close.title = 'Uždaryti';
    acts.appendChild(dash); acts.appendChild(close);
    head.appendChild(title); head.appendChild(acts);
    var stats = el('div', 'mt-panel-stats');
    [['mt-s-today', 'Atidarymai šiandien'], ['mt-s-tracked', 'Sekami laiškai']].forEach(function (s) {
      var st = el('div', 'mt-stat'); var n = el('div', 'n', '–'); n.id = s[0];
      st.appendChild(n); st.appendChild(el('div', 'l', s[1])); stats.appendChild(st);
    });
    var legend = el('div', 'mt-panel-legend');
    [['mt-ck', '✓', 'išsiųsta, neatidaryta'], ['mt-ck on', '✓✓', 'atidaryta'], ['mt-fw', '↪', 'galimai persiųsta']].forEach(function (l) {
      var it = el('span', 'mt-lg'); it.appendChild(el('span', l[0], l[1])); it.appendChild(document.createTextNode(' ' + l[2])); legend.appendChild(it);
    });
    var lgEye = el('span', 'mt-lg');
    var eyeW = el('span', 'mt-eye-wrap'); eyeW.appendChild(eyeIcon());
    lgEye.appendChild(eyeW); lgEye.appendChild(document.createTextNode(' siuntėjas seka jus'));
    legend.appendChild(lgEye);
    var feed = el('div', 'mt-panel-feed'); feed.id = 'mt-panel-feed';
    feed.appendChild(el('div', 'mt-empty', 'Kraunama…'));
    panelEl.appendChild(head); panelEl.appendChild(stats); panelEl.appendChild(legend);
    panelEl.appendChild(el('div', 'mt-panel-sub', 'Naujausia veikla'));
    panelEl.appendChild(feed);
    document.body.appendChild(panelEl);
    close.addEventListener('click', togglePanel);
  }

  function parseTs(s) {
    if (!s) return null;
    s = String(s);
    // API grąžina ISO su Z; atidarymų sąraše – „Y-m-d H:i:s“ UTC
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtShort(iso) {
    var dt = parseTs(iso);
    if (!dt) return String(iso || '–');
    try {
      return dt.toLocaleString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return dt.toLocaleString(); }
  }
  function agoTxt(iso) {
    var dt = parseTs(iso);
    if (!dt) return '';
    var d = (Date.now() - dt.getTime()) / 1000;
    if (d < 60) return 'ką tik';
    if (d < 3600) return 'prieš ' + Math.floor(d / 60) + ' min.';
    if (d < 86400) return 'prieš ' + Math.floor(d / 3600) + ' val.';
    if (d < 86400 * 30) return 'prieš ' + Math.floor(d / 86400) + ' d.';
    return fmtShort(iso);
  }
  function iconFor(type) {
    return type === 'open' ? '✓✓' : type === 'forward' ? '↪' : type === 'click' ? '🔗' : type === 'doc' ? '📄' : type === 'reminder' ? '⏰' : '✉️';
  }

  function refreshPanel() {
    if (!panelEl) return;
    apiGet('activity?limit=25', function (d) {
      var feed = panelEl.querySelector('#mt-panel-feed');
      feed.textContent = '';
      if (!d) { feed.appendChild(el('div', 'mt-empty', 'Nepavyko gauti veiklos. Patikrinkite plėtinio nustatymus.')); return; }
      panelEl.querySelector('#mt-s-today').textContent = d.opens_today != null ? d.opens_today : '–';
      panelEl.querySelector('#mt-s-tracked').textContent = d.tracked != null ? d.tracked : '–';
      if (!d.items || !d.items.length) { feed.appendChild(el('div', 'mt-empty', 'Kol kas veiklos nėra.')); return; }
      d.items.forEach(function (n) {
        var it = el('div', 'mt-fitem');
        it.appendChild(el('div', 'mt-fic mt-fic-' + n.type, iconFor(n.type)));
        var mid = el('div', 'mt-fmid');
        mid.appendChild(el('div', 'mt-ft', n.title));
        mid.appendChild(el('div', 'mt-fb', (n.body || '').split('\n')[0]));
        mid.appendChild(el('div', 'mt-fw-time', agoTxt(n.created_at)));
        it.appendChild(mid);
        it.addEventListener('click', function () { window.open(n.url, '_blank'); });
        feed.appendChild(it);
      });
    });
  }

  // Periodiškai: FAB pulsavimas (nauja veikla), atvira panelė, matomų laiškų statusai
  var seenActivityId = 0;
  function pollFab() {
    if (!ready) return;
    apiGet('activity?limit=1', function (d) {
      if (!d) return;
      var newest = d.items && d.items[0] ? d.items[0].id : 0;
      if (panelEl && panelOpen) refreshPanel();
      if (seenActivityId && newest > seenActivityId) {
        if (!panelOpen && fabEl) fabEl.classList.add('pulse');
        lastStatusFetch = 0;           // nauja veikla – atnaujinam ✓/✓✓ sąraše
        safe('decorateList', decorateList);
        refreshVisibleBars(true);
      }
      if (newest) seenActivityId = Math.max(seenActivityId, newest);
    });
    refreshVisibleBars(false);
  }

  // ================= ŠABLONAI =================
  function openTemplateMenu(anchor, state) {
    var existing = document.querySelector('.mt-menu');
    if (existing) { existing.remove(); }
    var menu = document.createElement('div');
    menu.className = 'mt-menu';
    // Kritinius stilius rašom tiesiai į elementą – kad meniu būtų matomas net jei
    // content.css neįsikrautų arba Gmail rašymo langas turėtų aukštesnį z-index.
    menu.setAttribute('style', [
      'position:fixed', 'z-index:2147483647', 'min-width:260px', 'max-width:380px',
      'max-height:320px', 'overflow-y:auto', 'background:#fff', 'color:#202124',
      'border:1px solid #dadce0', 'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,.28)', 'padding:6px',
      'font:13px/1.4 Roboto,Arial,sans-serif'
    ].join(';'));
    menu.textContent = 'Kraunama…';
    document.documentElement.appendChild(menu);
    function place() {
      var r = anchor.getBoundingClientRect();
      var mh = menu.offsetHeight || 200;
      var left = Math.min(Math.max(8, r.left), window.innerWidth - 360);
      menu.style.left = left + 'px';
      // virš mygtuko, jei telpa; kitaip – po juo
      if (r.top - mh - 8 > 8) {
        menu.style.top = (r.top - 8 - mh) + 'px';
      } else {
        menu.style.top = Math.min(r.bottom + 8, window.innerHeight - mh - 8) + 'px';
      }
    }
    place();
    function note(text) {
      menu.textContent = '';
      var em = document.createElement('div');
      em.setAttribute('style', 'padding:10px;color:#80868b;white-space:normal');
      em.textContent = text;
      menu.appendChild(em);
      place();
    }
    apiGet('templates', function (d) {
      if (!d) { note('Nepavyko pasiekti serverio. Patikrinkite plėtinio nustatymus (serverio adresas ir API raktas).'); return; }
      var list = d.templates || [];
      if (!list.length) { note('Šablonų nėra. Sukurkite skydelyje → Šablonai.'); return; }
      menu.textContent = '';
      list.forEach(function (t) {
        var it = document.createElement('div');
        it.className = 'mt-menu-item';
        it.setAttribute('style', 'padding:9px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
        it.textContent = t.name + (t.subject ? ' — ' + t.subject : '');
        it.addEventListener('mouseenter', function () { it.style.background = '#f1f3f4'; });
        it.addEventListener('mouseleave', function () { it.style.background = 'transparent'; });
        it.addEventListener('click', function (ev) {
          ev.stopPropagation();
          insertTemplate(state, t);
          apiPost('templates/' + t.id + '/use', {}, function () {});
          menu.remove();
        });
        menu.appendChild(it);
      });
      place();
    });
    setTimeout(function () {
      document.addEventListener('click', function close(ev) {
        if (!menu.contains(ev.target) && ev.target !== anchor) { menu.remove(); document.removeEventListener('click', close); }
      });
    }, 10);
  }

  function insertTemplate(state, t) {
    try {
      // Kūną randam iš naujo – Gmail gali būti perpiešęs rašymo langą
      var body = (state.dialog && getBodyEl(state.dialog)) || state.body;
      if (t.subject) {
        var subj = state.dialog && state.dialog.querySelector('input[name="subjectbox"]');
        if (subj && !subj.value) {
          subj.value = t.subject;
          subj.dispatchEvent(new Event('input', { bubbles: true }));
          subj.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (t.body_html && body) {
        body.focus();
        var div = document.createElement('div');
        div.innerHTML = t.body_html;
        // įterpiam šablono turinį į kūno pradžią (prieš parašą)
        body.insertBefore(div, body.firstChild);
        body.dispatchEvent(new Event('input', { bubbles: true }));
        state.body = body;
      } else if (!body) {
        alert('MailTrack Pro: nepavyko rasti laiško teksto lauko. Perkraukite Gmail (F5) ir bandykite dar kartą.');
      }
    } catch (e) {
      log('Šablono įterpimo klaida: ' + (e && e.message));
      alert('MailTrack Pro: šablono įterpti nepavyko – ' + (e && e.message));
    }
  }

  // ================= ATIDARYTI LAIŠKAI (gija) =================
  /* Kiekvienam laiškui (div.a3s) – VIENA juosta virš teksto:
       • jūsų laiškas su mūsų pikseliu (NE citatoje) → ✓/✓✓ statusas (+ ↪);
       • svetimas laiškas su sekimo pikseliu (NE citatoje) → 👁 „Seka: X“.
     Anksčiau kiekvienas atsakymas gijoje rodydavo ženklus dar kartą, nes
     skenuodavom ir cituotą tekstą (jūsų pačių Mailtrack/MailTrack pikselius),
     o dublikato patikra žiūrėdavo tik į artimiausią kaimyną. */
  var selfviewAt = {};
  function scanOpenedMessages() {
    if (!ready) return;
    var re = pixelRegex();
    if (!re) return;
    var svBatch = [];
    document.querySelectorAll('div.a3s').forEach(function (msg) {
      var info = msg.__mtInfo || (msg.__mtInfo = { tries: 0, ownDone: false, foreignDone: false, uid: null });

      if (!info.ownDone) {
        var all = [], top = [];
        msg.querySelectorAll('img').forEach(function (img) {
          var uid = ownUid(img, re);
          if (!uid) return;
          if (all.indexOf(uid) === -1) all.push(uid);
          if (!isQuoted(img, msg) && top.indexOf(uid) === -1) top.push(uid);
        });
        info.ownDone = true;
        // Savo peržiūra: Gmail proxy užkrauna VISUS paveikslėlius, taip pat cituotus –
        // todėl pranešam apie visus rastus mūsų pikselius (ne tik pagrindinį).
        all.forEach(function (u) {
          if (!selfviewAt[u] || Date.now() - selfviewAt[u] > 60000) { selfviewAt[u] = Date.now(); svBatch.push(u); }
        });
        if (top.length) {
          info.uid = top[top.length - 1];
          info.foreignDone = true; // tai jūsų laiškas – svetimų sekiklių jame neieškom
          rememberMine(senderOf(msg));
          showOwnStatus(msg, info.uid, false);
        }
      }
      if (!info.foreignDone) detectForeignIn(msg, info);
    });
    if (svBatch.length) apiPost('selfview', { uids: svBatch.slice(0, 20) }, function () {});
  }

  function showOwnStatus(msg, uid, force) {
    var c = statusCache[uid];
    if (c && c.d) paintOwn(barFor(msg), c.d);
    if (!force && c && Date.now() - c.t < 30000) return;
    statusCache[uid] = { d: c && c.d, t: Date.now() };
    apiGet('emails/' + uid, function (d) {
      if (!d) return;
      statusCache[uid] = { d: d, t: Date.now() };
      if (msg.isConnected) paintOwn(barFor(msg), d);
    });
  }

  /** Atnaujina matomų jūsų laiškų juostas (kas ~60 s arba iškart po naujos veiklos). */
  function refreshVisibleBars(force) {
    document.querySelectorAll('div.a3s').forEach(function (msg) {
      var info = msg.__mtInfo;
      if (!info || !info.uid) return;
      var c = statusCache[info.uid];
      if (force || !c || Date.now() - c.t > 60000) showOwnStatus(msg, info.uid, true);
    });
  }

  /* Viena juosta laiškui. Ieškom jau esamos tarp ankstesnių kaimynų (Gmail kartais
     perpiešia a3s elementą) – kad niekada neatsirastų dvi. */
  function barFor(msg) {
    if (msg.__mtBar && msg.__mtBar.isConnected && msg.__mtBar.parentElement === msg.parentElement) return msg.__mtBar;
    var bar = null;
    for (var p = msg.previousElementSibling; p && /(^|\s)mt-/.test(p.getAttribute('class') || ''); ) {
      var prev = p.previousElementSibling;
      if (p.classList.contains('mt-msgbar')) {
        if (!bar) bar = p; else p.remove();
      } else if (p.classList.contains('mt-banner') || p.classList.contains('mt-tracked-by')) {
        p.remove(); // senų versijų likučiai
      }
      p = prev;
    }
    if (!bar) {
      bar = el('div', 'mt-msgbar');
      if (!insertBefore(bar, msg)) return bar;
    }
    msg.__mtBar = bar;
    return bar;
  }

  function setText(n, t) { if (n.textContent !== t) n.textContent = t; }
  function setAttr(n, a, v) { if (n.getAttribute(a) !== v) n.setAttribute(a, v); }
  function setClass(n, c) { if (n.getAttribute('class') !== c) n.setAttribute('class', c); }
  var CHIP_ORDER = { own: 0, fwd: 1, foreign: 2 };
  function chip(bar, key) {
    var c = bar.querySelector(':scope > [data-mt="' + key + '"]');
    if (!c) {
      c = el('span');
      c.setAttribute('data-mt', key);
      // tvarka juostoje: savas statusas, persiųsta, svetimas sekiklis
      var after = null;
      bar.querySelectorAll(':scope > [data-mt]').forEach(function (x) {
        if (CHIP_ORDER[x.getAttribute('data-mt')] < CHIP_ORDER[key]) after = x;
      });
      bar.insertBefore(c, after ? after.nextSibling : bar.firstChild);
    }
    return c;
  }
  function dropChip(bar, key) {
    var c = bar.querySelector(':scope > [data-mt="' + key + '"]');
    if (c) c.remove();
  }

  function paintOwn(bar, d) {
    if (!bar) return;
    var opened = d.open_count > 0;
    var c = chip(bar, 'own');
    setClass(c, 'mt-chip mt-own ' + (opened ? 'on' : 'off'));
    var txt = opened
      ? '✓✓ Atidaryta ' + d.open_count + ' k.' + (d.last_open_at ? ' · ' + agoTxt(d.last_open_at) : '')
      : '✓ Išsiųsta · dar neatidaryta';
    if (d.click_count > 0) txt += ' · 🔗 ' + d.click_count;
    setText(c, txt);
    setAttr(c, 'title', (opened
      ? 'Pirmą kartą: ' + fmtShort(d.first_open_at) + '\nPaskutinį kartą: ' + fmtShort(d.last_open_at)
      : 'Išsiųsta: ' + fmtShort(d.sent_at)) + '\nSpauskite – atidarymų istorija');
    c.__mtUid = d.uid;
    if (d.forwarded) {
      var f = chip(bar, 'fwd');
      setClass(f, 'mt-chip mt-fwd');
      setText(f, '↪ Galimai persiųstas');
      setAttr(f, 'title', (d.forward_reason || 'Atidarymų daugiau nei tikėtina vienam gavėjui') + '\nSpauskite – atidarymų istorija');
      f.__mtUid = d.uid;
    } else {
      dropChip(bar, 'fwd');
    }
  }

  /* Ar KITI seka jus? Gautame laiške ieškom sekimo pikselio (tik NE cituotame tekste
     ir tik ne jūsų pačių laiškuose). Paveikslėliai kraunasi ne iškart (Gmail proxy),
     todėl bandom kelis ciklus. */
  function detectForeignIn(msg, info) {
    var sender = senderOf(msg);
    if (sender && isMine(sender)) { info.foreignDone = true; return; }
    if (info.tries >= 12) { info.foreignDone = true; return; }
    info.tries++;
    var found = {};
    var re = pixelRegex();
    msg.querySelectorAll('img').forEach(function (img) {
      var raw = imgSrc(img);
      if (!raw) return;
      if (isQuoted(img, msg)) return;
      if (re && ownUid(img, re)) return;
      var name = trackerFromSrc(raw, img);
      if (name) { found[name] = 1; return; }
      // dar neužsikrovęs paveikslėlis – gali būti pikselis; perskenuosim jam užsikrovus
      if ((!img.complete || img.naturalWidth === 0) && !img.__mtLoadHook) {
        img.__mtLoadHook = 1;
        var again = function () { safe('scanOpenedMessages', scanOpenedMessages); };
        img.addEventListener('load', again, { once: true });
        img.addEventListener('error', again, { once: true });
      }
    });
    var names = Object.keys(found);
    if (!names.length) return;
    info.foreignDone = true;
    var bar = barFor(msg);
    var c = chip(bar, 'foreign');
    setClass(c, 'mt-chip mt-foreign');
    c.textContent = '';
    c.appendChild(eyeIcon());
    c.appendChild(document.createTextNode(' Seka: ' + names.join(', ')));
    c.title = 'Siuntėjas mato, ar ir kada atidarėte šį laišką (' + names.join(', ') + ').\n' +
      'Kad nesektų – Gmail nustatymuose išjunkite automatinį paveikslėlių rodymą.';
    if (sender) rememberTrackSender(sender, names[0]);
  }

  var TRACKERS = [
    [/mailtrack\.io|mailtrack\.me|mltrk\.io/i, 'Mailtrack'],
    [/mailsuite\.com|\bmlsnd\b/i, 'Mailsuite'],
    [/yesware\.com/i, 'Yesware'],
    [/streak\.com|mailfoogae/i, 'Streak'],
    [/hubspot\.com|hubspotemail|hs-sites|hubspotlinks|[/.]hubs\.ly/i, 'HubSpot'],
    [/mixmax\.com/i, 'Mixmax'],
    [/bananatag\.com/i, 'Bananatag'],
    [/saleshandy\.com/i, 'Saleshandy'],
    [/[/.]snov\.io/i, 'Snov.io'],
    [/[/.]gmass\.co/i, 'GMass'],
    [/contactmonkey\.com/i, 'ContactMonkey'],
    [/cirrusinsight\.com/i, 'Cirrus Insight'],
    [/getnotify\.com|didtheyreadit/i, 'GetNotify'],
    [/[/.]outreach\.io/i, 'Outreach'],
    [/[/.]apollo\.io/i, 'Apollo'],
    [/sendgrid\.net|sendgrid\.com/i, 'SendGrid'],
    [/list-manage\.com|[/.]mailchimp\.com\/.*(open|track)/i, 'Mailchimp'],
    [/sparkpostmail|sparkpost\.com/i, 'SparkPost'],
    [/mailgun\.org|mailgun\.net|mailgun\.com|mailgunapp/i, 'Mailgun'],
    [/sendinblue\.com|sibautomation|[/.]brevo\.com/i, 'Brevo'],
    [/customeriomail|track\.customer\.io/i, 'Customer.io'],
    [/[/.]klaviyo\.com\/.*open|kmail-lists|trk\.klclick/i, 'Klaviyo'],
    [/mandrillapp\.com/i, 'Mandrill'],
    [/postmarkapp\.com|pstmrk\.it/i, 'Postmark'],
    [/mailerlite\.com|ml\.mailerlite|mlsend\.com|mlsend\.net/i, 'MailerLite'],
    [/rs6\.net|[/.]constantcontact\.com\/.*(open|track)/i, 'Constant Contact'],
    [/activehosted\.com|[/.]acems\d*\.com/i, 'ActiveCampaign'],
    [/[/.]getresponse\.com\/.*open|grsm\.io/i, 'GetResponse'],
    [/[/.]aweber\.com\/.*open|awtrack/i, 'AWeber'],
    [/convertkit-mail|[/.]ck\.page\/.*open/i, 'ConvertKit'],
    [/[/.]mktoresp\.com|\/trk\?.*mkt_tok/i, 'Marketo'],
    [/pi\.pardot\.com|go\.pardot\.com/i, 'Pardot'],
    [/exct\.net|exacttarget/i, 'Salesforce'],
    [/via\.intercom\.io|intercom-mail|[/.]intercom\.io\/.*open/i, 'Intercom'],
    [/amazonses\.com|awstrack\.me/i, 'Amazon SES'],
    [/[/.]sendpulse\.com/i, 'SendPulse'],
    [/[/.]moosend\.com|moosend-mail/i, 'Moosend'],
    [/[/.]omnisend\.com|omnisrc\.com/i, 'Omnisend'],
    [/[/.]getdrip\.com|[/.]drip\.com\/.*open/i, 'Drip'],
    [/[/.]woodpecker\.co/i, 'Woodpecker'],
    [/[/.]lemlist\.com|lemwarm/i, 'Lemlist'],
    [/[/.]reply\.io\/.*(open|track)/i, 'Reply.io'],
    [/[/.]close\.(com|io)\/.*(open|track)/i, 'Close CRM'],
    [/pipedrivemail|[/.]pipedrive\.com\/.*(open|track)/i, 'Pipedrive'],
    [/zcsend\.net|[/.]zoho\.(com|eu)\/.*(open|track)/i, 'Zoho'],
    [/[/.]mjt\.lu|[/.]mailjet\.com\/.*open/i, 'Mailjet'],
    [/elasticemail/i, 'Elastic Email'],
    [/benchmarkemail\.com\/.*(open|track)|bmetrack/i, 'Benchmark'],
    [/createsend\d*\.com\/t\/|cmail\d+\.com\/t\//i, 'Campaign Monitor'],
    [/[/.]substack\.com\/o\/|substack\.com\/.*open/i, 'Substack'],
    [/[/.]superhuman\.com|r\.superhuman/i, 'Superhuman'],
    [/[/.]mailbutler\.io/i, 'Mailbutler'],
    [/[/.]boomerangapp\.com/i, 'Boomerang'],
    [/[/.]rightinbox\.com/i, 'Right Inbox']
  ];

  /* Gmail VISAS gautų laiškų paveikslėlių nuorodas persiunčia per savo tarpinį
     serverį (googleusercontent.com Image Proxy). Tikroji sekiklio nuoroda lieka
     po „#" (fragmente) arba URL-kode. Čia atkoduojam originalią nuorodą. */
  function deproxy(src) {
    if (!src) return src;
    // 1) dažniausias variantas: originalas po '#'
    var h = src.indexOf('#');
    if (h !== -1) {
      var after = src.slice(h + 1);
      if (/^https?:\/\//i.test(after)) { try { return decodeURIComponent(after); } catch (e) { return after; } }
      if (/^https?%3A/i.test(after)) { try { return decodeURIComponent(after); } catch (e) {} }
    }
    // 2) originalas įdėtas kaip URL-encoded parametras/path'as
    var m = src.match(/https?%3A%2F%2F[^&#\s]+/i);
    if (m) { try { return decodeURIComponent(m[0]); } catch (e) {} }
    // 3) originalas po '/proxy/.../'  ar '/meips/.../' su tiesiogine http nuoroda
    var m2 = src.match(/\/(?:proxy|meips|mail-sig)\/[^#]*?(https?:\/\/[^#\s]+)$/i);
    if (m2) return m2[1];
    return src;
  }

  function trackerFromSrc(rawsrc, img) {
    var src = deproxy(rawsrc);
    if (!src || src.indexOf('data:') === 0 || src.indexOf('cid:') === 0) return null;

    var host;
    try { host = new URL(src, location.href).hostname.toLowerCase(); } catch (e) { return null; }
    // mūsų pačių serveris – praleidžiam
    if (CFG && CFG.serverUrl) { try { if (new URL(CFG.serverUrl).hostname.toLowerCase() === host) return null; } catch (e) {} }

    // 1) Žinomi sekimo paslaugų teikėjai (pagal atkoduotą URL)
    for (var i = 0; i < TRACKERS.length; i++) {
      if (TRACKERS[i][0].test(src)) return TRACKERS[i][1];
    }

    // Jei net po atkodavimo liko Google domenas – tai tikras Google turinys
    // (emoji, nuotraukos), NE sekiklis; praleidžiam.
    if (/(^|\.)(google|googleusercontent|gstatic|ggpht|youtube|ytimg|googleapis|gmail)\.com$/i.test(host)) return null;
    if (/(^|\.)google\.[a-z.]+$/i.test(host)) return null;

    // 2) Nežinomas teikėjas: tik tikrai NEMATOMAS paveikslėlis (1×1 / paslėptas).
    //    Vien URL žodžiai („.gif“, „campaign“) – per daug klaidingų (logotipai, parašai).
    var w = parseInt(img.getAttribute('width') || '0', 10);
    var h = parseInt(img.getAttribute('height') || '0', 10);
    var st = (img.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
    var tinyAttr = (w > 0 && w <= 2 && h <= 2) || (h > 0 && h <= 2 && w <= 2);
    var tinyNat = img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2 && img.naturalHeight <= 2;
    var hiddenSt = /display:none|visibility:hidden|opacity:0(;|$)|max-height:0|width:[01]px|height:[01]px/.test(st);
    var trackyUrl = /(open|pixel|beacon|track|trk|\/o\/|wf\/open|1x1|spacer|blank\.gif|clear\.gif)/i.test(src);
    if (tinyAttr || tinyNat || (hiddenSt && trackyUrl)) {
      var parts = host.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : host;
    }
    return null;
  }

  /* Atidaryto laiško siuntėjo el. paštas (iš antraštės). Neinam aukščiau nei
     paties laiško konteineris – kitaip paimtume KITO gijos laiško siuntėją. */
  function senderOf(msg) {
    var box = msg.closest('.adn, .gs, [data-message-id]') || msg.parentElement;
    for (var hop = 0; box && hop < 3; hop++) {
      if (hop > 0 && box.querySelectorAll('div.a3s').length > 1) break;
      // pirmiausia Gmail antraštės „Nuo“ (.gD), tik tada bet koks adresas antraštėje
      var cands = [].slice.call(box.querySelectorAll('.gD[email]')).concat([].slice.call(box.querySelectorAll('span[email], [data-hovercard-id]')));
      for (var i = 0; i < cands.length; i++) {
        if (msg.contains(cands[i])) continue; // adresai pačiame laiško tekste – ne siuntėjas
        var em = cands[i].getAttribute('email') || cands[i].getAttribute('data-hovercard-id') || '';
        if (em.indexOf('@') !== -1) return em.toLowerCase();
      }
      box = box.parentElement;
    }
    return '';
  }

  /* SVARBU: įterpiam tik į TIKRĄ tėvinį elementą (kitaip insertBefore meta
     NotFoundError ir nutraukia visą ciklą). */
  function insertBefore(node, ref) {
    var parent = ref && ref.parentElement;
    if (!parent) return false;
    try {
      parent.insertBefore(node, ref);
      return true;
    } catch (e) {
      log('insertBefore nepavyko: ' + (e && e.message));
      return false;
    }
  }

  function eyeIcon() {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '14'); s.setAttribute('height', '14');
    s.setAttribute('class', 'mt-eye'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z');
    s.appendChild(p);
    return s;
  }

  // ================= ATIDARYMŲ ISTORIJA (spustelėjus ✓/✓✓) =================
  function closePop() { var p = document.querySelector('.mt-pop'); if (p) p.remove(); }
  function openHistory(anchor, uid) {
    closePop();
    if (!uid) return;
    var pop = el('div', 'mt-pop');
    pop.appendChild(el('div', 'mt-pop-load', 'Kraunama…'));
    document.documentElement.appendChild(pop);
    function place() {
      var r = anchor.getBoundingClientRect();
      var w = pop.offsetWidth || 340, h = pop.offsetHeight || 200;
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      pop.style.top = (r.bottom + 6 + h < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + 'px';
    }
    place();
    apiGet('emails/' + uid, function (d) {
      if (!pop.isConnected) return;
      pop.textContent = '';
      if (!d) { pop.appendChild(el('div', 'mt-pop-load', 'Nepavyko gauti duomenų iš serverio.')); place(); return; }
      statusCache[uid] = { d: d, t: Date.now() };
      var head = el('div', 'mt-pop-head');
      head.appendChild(el('div', 'mt-pop-subj', d.subject || '(be temos)'));
      if (d.recipients) head.appendChild(el('div', 'mt-pop-meta', 'Kam: ' + d.recipients));
      head.appendChild(el('div', 'mt-pop-meta', 'Išsiųsta: ' + fmtShort(d.sent_at)));
      pop.appendChild(head);
      var sum = el('div', 'mt-pop-sum');
      sum.appendChild(el('span', 'mt-chip mt-own ' + (d.open_count > 0 ? 'on' : 'off'), d.open_count > 0 ? '✓✓ Atidaryta ' + d.open_count + ' k.' : '✓ Dar neatidaryta'));
      if (d.click_count > 0) sum.appendChild(el('span', 'mt-chip mt-clk', '🔗 Paspaudimai: ' + d.click_count));
      if (d.forwarded) sum.appendChild(el('span', 'mt-chip mt-fwd', '↪ Galimai persiųstas'));
      pop.appendChild(sum);
      if (d.forwarded && d.forward_reason) pop.appendChild(el('div', 'mt-pop-note', d.forward_reason));
      var opens = (d.opens || []).filter(function (o) { return !(+o.ignored); });
      var list = el('div', 'mt-pop-list');
      if (!opens.length) list.appendChild(el('div', 'mt-pop-empty', 'Atidarymų dar nėra.'));
      opens.slice(0, 12).forEach(function (o) {
        var row = el('div', 'mt-pop-row');
        row.appendChild(el('span', 'mt-pop-when', fmtShort(o.opened_at)));
        var where = o.proxy ? 'per ' + o.proxy : [o.device, o.os, o.city || o.country].filter(Boolean).join(' · ');
        row.appendChild(el('span', 'mt-pop-where', (where || '–') + (o.ignore_reason ? ' ⚠' : '')));
        if (o.ignore_reason) row.title = o.ignore_reason;
        list.appendChild(row);
      });
      if (opens.length > 12) list.appendChild(el('div', 'mt-pop-empty', '…ir dar ' + (opens.length - 12)));
      pop.appendChild(list);
      var foot = el('div', 'mt-pop-foot');
      var a = el('a', null, 'Visa istorija skydelyje ↗'); a.href = d.dashboard_url; a.target = '_blank';
      foot.appendChild(a);
      pop.appendChild(foot);
      place();
    });
  }

  // ================= LAIŠKŲ SĄRAŠAS =================
  function refreshStatusIndex(cb) {
    var now = Date.now();
    if (now - lastStatusFetch < 20000) { cb && cb(); return; }
    lastStatusFetch = now;
    apiGet('emails?limit=200', function (d) {
      if (d && d.emails) {
        subjectIndex = {};
        d.emails.forEach(function (e) {
          e.__rcpt = ((e.recipients || '').toLowerCase().match(EMAIL_RE) || []);
          var key = normSubject(e.subject);
          if (!key) return;
          (subjectIndex[key] = subjectIndex[key] || []).push(e); // sąrašas nuo naujausių
        });
      }
      cb && cb();
    });
  }

  // Temą normalizuojam: nuimam Re:/Fwd:/Fw:/AW:/Atsak.: priešdėlius ir sutraukiam tarpus,
  // kad sekamą laišką atpažintume ir gijoje (atsakymuose), ir persiųstą.
  function normSubject(s) {
    s = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var prev;
    do { prev = s; s = s.replace(/^(re|fwd?|aw|wg|sv|vs|atsak|ats|persiųsta|persi)\s*(\[\d+\])?\s*[:：]\s*/i, ''); } while (s !== prev);
    return s.trim();
  }

  /* Eilutės dalyviai (el. paštai). Gmail juos laiko span[email] atributuose. */
  function rowEmails(row) {
    var out = [];
    row.querySelectorAll('span[email]').forEach(function (n) {
      var e = (n.getAttribute('email') || '').toLowerCase();
      if (!e) return;
      if (out.indexOf(e) === -1) out.push(e);
      // „aš“ / „me“ sąraše = jūsų adresas – įsimenam
      var t = (n.textContent || '').trim().toLowerCase();
      if (/^(aš|me|ich|moi|yo|я|eu|io|ja)$/.test(t)) rememberMine(e);
    });
    return out;
  }

  /* Ar eilutė – MŪSŲ sekamas laiškas? Tema turi sutapti IR (jei žinomi gavėjai)
     bent vienas eilutės dalyvis turi būti to laiško gavėjas. Anksčiau užtekdavo
     temos – todėl ženklas atsirasdavo prie svetimų laiškų su ta pačia tema. */
  function matchOwn(subj, emails) {
    var cands = subj ? subjectIndex[subj] : null;
    if (!cands) return null;
    var mine = myEmails();
    var others = emails.filter(function (e) { return !mine[e]; });
    var weak = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c.__rcpt.length) { if (!weak) weak = c; continue; }
      for (var j = 0; j < others.length; j++) if (c.__rcpt.indexOf(others[j]) !== -1) return c;
    }
    return weak;
  }

  function decorateList() {
    if (!ready) return;
    refreshStatusIndex(function () {
      var rows = document.querySelectorAll('tr.zA');
      if (!rows.length) return;
      var showForeign = !CFG || CFG.listForeign !== false;
      var inSent = /^#(sent|išsiųsti)/i.test(location.hash);
      rows.forEach(function (row) {
        var subjEl = row.querySelector('.bog, .y6 span[id], .bqe, .xT .y6 span, .y6 > span');
        var anchor = row.querySelector('.y6') || subjEl;
        var emails = rowEmails(row);
        var subj = subjEl ? normSubject(subjEl.textContent) : '';
        var e = matchOwn(subj, emails);

        // svetimas sekiklis: tik pagal TIKSLŲ siuntėjo adresą ir ne „Išsiųstuose“
        var foreign = null;
        if (showForeign && !inSent) {
          for (var i = 0; i < emails.length; i++) {
            if (trackSenders[emails[i]] && !isMine(emails[i])) { foreign = trackSenders[emails[i]]; break; }
          }
        }
        paintRow(row, anchor, e, foreign);
      });
    });
  }

  function paintRow(row, anchor, e, foreign) {
    var box = row.querySelector('.mt-marks');
    // senų versijų taškai
    row.querySelectorAll('.mt-list-badge, .mt-list-trk').forEach(function (n) { n.remove(); });
    if (!e && !foreign) { if (box) box.remove(); return; }
    if (!box) {
      if (!anchor || !anchor.parentElement) return;
      box = el('span', 'mt-marks');
      anchor.parentElement.insertBefore(box, anchor);
    }
    // savas statusas
    var ck = box.querySelector('.mt-ck');
    var fw = box.querySelector('.mt-fw');
    if (e) {
      var opened = e.open_count > 0;
      if (!ck) { ck = el('span'); box.insertBefore(ck, box.firstChild); }
      setClass(ck, 'mt-ck' + (opened ? ' on' : ''));
      setText(ck, opened ? '✓✓' : '✓');
      setAttr(ck, 'title', (opened
        ? 'Atidaryta ' + e.open_count + ' k. · paskutinį kartą ' + fmtShort(e.last_open_at)
        : 'Sekama · dar neatidaryta (išsiųsta ' + fmtShort(e.sent_at) + ')') +
        (e.click_count > 0 ? ' · paspaudimų: ' + e.click_count : '') + '\nSpauskite – istorija');
      ck.__mtUid = e.uid;
      if (e.forwarded) {
        if (!fw) { fw = el('span', 'mt-fw', '↪'); box.insertBefore(fw, ck.nextSibling); }
        setAttr(fw, 'title', 'Galimai persiųstas' + (e.forward_reason ? ': ' + e.forward_reason : ''));
        fw.__mtUid = e.uid;
      } else if (fw) fw.remove();
    } else {
      if (ck) ck.remove();
      if (fw) fw.remove();
    }
    // svetimas sekiklis
    var eye = box.querySelector('.mt-eye-wrap');
    if (foreign) {
      if (!eye) { eye = el('span', 'mt-eye-wrap'); eye.appendChild(eyeIcon()); box.appendChild(eye); }
      setAttr(eye, 'title', 'Šis siuntėjas jus seka (' + foreign + ') – mato, ar atidarėte jo laišką.');
    } else if (eye) eye.remove();
  }

  // ================= STEBĖJIMAS =================
  /* Kiekvieną dalį vykdom atskirai – sugedusi dalis nebetrukdo kitoms. */
  function safe(name, fn) {
    try {
      fn();
    } catch (e) {
      if (!safe.warned) safe.warned = {};
      if (!safe.warned[name]) {
        safe.warned[name] = 1; // pranešam tik kartą, kad neužpiltume žurnalo
        log('Klaida (' + name + '): ' + (e && e.message), { stack: String(e && e.stack).slice(0, 300) });
      }
    }
  }

  function runCycle() {
    safe('decorateComposes', decorateComposes);
    safe('scanOpenedMessages', scanOpenedMessages);
    safe('decorateList', decorateList);
    if (ready) safe('ensureFab', ensureFab);
  }

  /* Mūsų pačių DOM pakeitimai neturi sukelti naujo ciklo (anksčiau kas 250 ms
     perrašydavom ženklus → observer → vėl ciklas: be galo kaitinamas CPU). */
  var OWN_SEL = '.mt-marks, .mt-msgbar, .mt-panel, .mt-pop, .mt-toggle, .mt-fab, .mt-menu';
  function isOwnNode(n) {
    if (n.nodeType === 3) return !!(n.parentElement && n.parentElement.closest(OWN_SEL));
    return n.nodeType === 1 && /(^|\s)mt-/.test(n.getAttribute('class') || '');
  }
  function ownMutation(m) {
    var t = m.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(OWN_SEL)) return true;
    var nodes = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes));
    return nodes.length > 0 && nodes.every(isOwnNode);
  }
  var tick = 0;
  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      if (!ownMutation(muts[i])) {
        clearTimeout(tick);
        tick = setTimeout(runCycle, 250);
        return;
      }
    }
  });

  /* Gmail savo įrankių juostoje perima paspaudimus (stopPropagation capture fazėje),
     todėl mūsų mygtukų click'ai nepasiekdavo jų pačių listener'ių. Sprendimas –
     vienas klausytojas ant document CAPTURE fazėje: jis suveikia PIRMAS. */
  function installClickCapture() {
    if (window.__mtClickCaptureInstalled) return;
    window.__mtClickCaptureInstalled = true;

    var HIT = '.mt-tpl, .mt-track-toggle, .mt-fab, .mt-marks .mt-ck, .mt-marks .mt-fw, .mt-msgbar .mt-own, .mt-msgbar .mt-fwd';
    // Reaguojam į pointerdown – jis įvyksta anksčiausiai, dar prieš mousedown/click,
    // todėl Gmail nespėja paspaudimo "suvalgyti". click'ą tik nuslopinam.
    function handle(e, act) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (act && !t.closest('.mt-pop')) closePop();
      var hit = t.closest(HIT);
      if (!hit) return;
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.preventDefault();
      if (!act) return;
      if (hit.classList.contains('mt-fab')) { togglePanel(); return; }
      if (!ready) {
        alert('MailTrack Pro: spauskite plėtinio ikoną (🧩 viršuje) ir įveskite serverio adresą bei API raktą.');
        return;
      }
      if (hit.__mtUid) { openHistory(hit, hit.__mtUid); return; }
      if (hit.classList.contains('mt-tpl')) {
        openTemplateMenu(hit, hit.__mtState);
      } else if (hit.classList.contains('mt-track-toggle')) {
        if (hit.__mtState) {
          hit.__mtState.on = !hit.__mtState.on;
          if (hit.__mtPaint) hit.__mtPaint();
        }
      }
    }
    // Siuntimas: mūsų klausytojas ant document capture fazėje suveikia PIRMAS –
    // anksčiau nei Gmail konteineris spėja sustabdyti įvykį. Įvykio NESTABDOM,
    // kad Gmail normaliai išsiųstų laišką.
    function handleSend(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sb = t.closest('.mt-sendbtn');
      if (sb && sb.__mtState) {
        try { beforeSend(sb.__mtState); } catch (err) { log('send capture: ' + (err && err.message)); }
      }
    }
    document.addEventListener('pointerdown', function (e) { handle(e, true); }, true);
    document.addEventListener('mousedown', function (e) { handle(e, false); }, true);
    document.addEventListener('click', function (e) { handleSend(e); handle(e, false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); }, true);
  }
  // Registruojam IŠ KARTO (document_start), kad Gmail neužsiregistruotų anksčiau.
  installClickCapture();

  /* Šablono įterpimas IŠ PLĖTINIO LANGO (popup). */
  function currentComposeState() {
    if (lastComposeState && document.contains(lastComposeState.body)) return lastComposeState;
    var b = document.querySelector('div[aria-label][contenteditable="true"], div[g_editable="true"][contenteditable="true"]');
    if (!b) return null;
    var dlg = b.closest('div[role="dialog"]') || b.closest('div.M9, div.aoI, div.nH') || b.parentElement;
    return { on: true, dialog: dlg, body: b };
  }
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg) return;
      if (msg.type === 'mt-insert-template') {
        var st = currentComposeState();
        if (!st) { sendResponse({ ok: false, error: 'Neatidarytas laiško rašymo langas' }); return true; }
        insertTemplate(st, msg.template);
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'mt-has-compose') {
        sendResponse({ ok: true, has: !!currentComposeState() });
        return true;
      }
    });
  } catch (e) { /* plėtinys perkraunamas */ }

  function boot() {
    loadLocal();
    loadCfg(function () {
      safe('observe', function () { observer.observe(document.body, { childList: true, subtree: true }); });
      runCycle();
      if (ready) safe('pollFab', pollFab);
      setInterval(function () { safe('pollFab', pollFab); }, 20000);
      // sąrašo ✓/✓✓ atnaujinimas net jei Gmail DOM nesikeičia
      setInterval(function () { safe('decorateList', decorateList); }, 30000);
      window.addEventListener('hashchange', function () {
        closePop();
        setTimeout(function () { safe('decorateList', decorateList); }, 400);
      });
      safe('storageListener', function () {
        chrome.storage.onChanged.addListener(function (c, area) {
          if (area === 'sync') loadCfg(function () { lastStatusFetch = 0; if (ready) { safe('ensureFab', ensureFab); safe('decorateList', decorateList); } });
        });
      });
    });
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
