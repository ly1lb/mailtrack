/* MailTrack Pro – Gmail turinio skriptas.
   1) Rašymo lange prideda VIENĄ "✓✓ Sekti" jungiklį; paspaudus "Siųsti" įterpia
      sekimo pikselį ir (pasirinktinai) perrašo nuorodas su HMAC parašu.
   2) Kai TU pats atidarai savo sekamą laišką, praneša serveriui (selfview),
      kad Gmail proxy užkrovimas nebūtų suskaičiuotas kaip gavėjo atidarymas.
   3) Laiškų sąraše ir atidarytame laiške rodo ✓ / ✓✓ statusą. */
(function () {
  'use strict';
  if (!location.hostname.endsWith('mail.google.com')) return;

  var CFG = null;
  var ready = false;
  var statusMap = {};        // uid -> {open_count, ...}
  var subjectIndex = {};     // "subject|recip" -> email (best-effort sąrašui)
  var lastStatusFetch = 0;

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
        if (r && r.ok) { CFG = r.cfg; ready = !!(CFG.serverUrl && CFG.apiKey); }
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
  function pixelRegex() {
    if (!CFG || !CFG.serverUrl) return null;
    return new RegExp(CFG.serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/o/([A-Za-z0-9_-]{8,32})');
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
      var em = n.getAttribute('email') || n.getAttribute('data-hovercard-id');
      if (em && em.indexOf('@') > 0) set[em.toLowerCase()] = 1;
    });
    dialog.querySelectorAll('textarea[name="to"], input[name="to"]').forEach(function (n) {
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

      var toggle = document.createElement('div');
      toggle.className = 'mt-toggle mt-track-toggle';
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      function paint() {
        toggle.classList.toggle('on', state.on);
        toggle.title = ready ? (state.on ? 'Sekimas įjungtas' : 'Sekimas išjungtas šiam laiškui') : 'Sukonfigūruokite plėtinį';
        toggle.innerHTML = '<span class="mt-tick">' + (state.on ? '✓✓' : '✓') + '</span><span class="mt-lbl">' + (state.on ? 'Sekama' : 'Sekti') + '</span>';
      }
      paint();
      // Paspaudimus gaudom globaliai capture fazėje (žr. žemiau) – Gmail savo
      // įrankių juostoje perima click'us ir įprastas listener'is nesuveiktų.
      toggle.__mtPaint = paint;
      toggle.__mtState = state;
      if (sendBtn.parentElement) sendBtn.parentElement.insertBefore(toggle, sendBtn.nextSibling);

      // Šablonų mygtukas
      var tplBtn = document.createElement('div');
      tplBtn.className = 'mt-toggle mt-tpl';
      tplBtn.setAttribute('role', 'button');
      tplBtn.tabIndex = 0;
      tplBtn.innerHTML = '<span class="mt-lbl">Šablonai ▾</span>';
      tplBtn.title = 'Įterpti laiško šabloną';
      tplBtn.__mtState = state;
      if (toggle.parentElement) toggle.parentElement.insertBefore(tplBtn, toggle.nextSibling);

      sendBtn.addEventListener('click', function () { beforeSend(state); }, true);
      dialog.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') beforeSend(state);
      }, true);
    });
  }

  var handled = new WeakSet();
  function beforeSend(state) {
    try {
      if (!state || !state.on || !ready) return;
      var body = state.body;
      if (!body || handled.has(body) || body.querySelector('img.mt-px')) return;
      handled.add(body);

      var uid = uidGen();
      var links = [];
      if (CFG.trackLinks) {
        body.querySelectorAll('a[href^="http"]').forEach(function (a, i) {
          var url = a.getAttribute('href');
          if (!url || a.__mt) return;
          if (CFG.serverUrl && url.indexOf(CFG.serverUrl) === 0) return;
          a.setAttribute('href', CFG.serverUrl + '/c/' + uid + '/' + i + '?u=' + b64url(url) + '&s=' + sig(uid, i, url));
          a.__mt = true;
          links.push({ idx: i, url: url });
        });
      }
      var img = document.createElement('img');
      img.className = 'mt-px';
      img.src = CFG.serverUrl + '/o/' + uid + '.gif';
      img.width = 1; img.height = 1; img.alt = '';
      img.setAttribute('style', 'width:1px;height:1px;border:0;opacity:0;display:block');
      body.appendChild(img);

      chrome.runtime.sendMessage({
        type: 'register',
        payload: { uid: uid, subject: getSubject(state.dialog), recipients: getRecipients(state.dialog), links: links, source: 'gmail-chrome' }
      }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) log('Nepavyko įtraukti laiško į eilę', { uid: uid });
      });
    } catch (e) {
      log('beforeSend klaida: ' + (e && e.message), { stack: String(e && e.stack).slice(0, 200) });
    }
  }

  // ================= MINI DASHBOARD GMAIL LANGE (kaip Mailsuite panelė) =================
  var panelEl = null, fabEl = null, panelOpen = false;

  function ensureFab() {
    if (fabEl && document.body.contains(fabEl)) return;
    fabEl = document.createElement('div');
    fabEl.className = 'mt-fab';
    fabEl.title = 'MailTrack Pro – veikla';
    fabEl.innerHTML = '<span class="mt-fab-tick">✓✓</span>';
    // click'ą tvarko globalus capture klausytojas (installClickCapture)
    document.body.appendChild(fabEl);
  }

  function togglePanel() {
    if (!panelEl) buildPanel();
    panelOpen = !panelOpen;
    panelEl.classList.toggle('open', panelOpen);
    if (panelOpen) refreshPanel();
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'mt-panel';
    panelEl.innerHTML =
      '<div class="mt-panel-head">' +
        '<span class="mt-panel-title"><span class="mt-tickg">✓✓</span> MailTrack Pro</span>' +
        '<span class="mt-panel-actions"><a class="mt-panel-dash" target="_blank">Skydelis ↗</a>' +
        '<span class="mt-panel-close" title="Uždaryti">✕</span></span>' +
      '</div>' +
      '<div class="mt-panel-stats">' +
        '<div class="mt-stat"><div class="n" id="mt-s-today">–</div><div class="l">Atidarymai šiandien</div></div>' +
        '<div class="mt-stat"><div class="n" id="mt-s-tracked">–</div><div class="l">Sekami laiškai</div></div>' +
      '</div>' +
      '<div class="mt-panel-sub">Naujausia veikla</div>' +
      '<div class="mt-panel-feed" id="mt-panel-feed"><div class="mt-empty">Kraunama…</div></div>';
    document.body.appendChild(panelEl);
    panelEl.querySelector('.mt-panel-close').addEventListener('click', togglePanel);
    if (CFG && CFG.serverUrl) panelEl.querySelector('.mt-panel-dash').href = CFG.serverUrl;
  }

  function agoTxt(iso) {
    try {
      var d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 60) return 'ką tik';
      if (d < 3600) return 'prieš ' + Math.floor(d / 60) + ' min.';
      if (d < 86400) return 'prieš ' + Math.floor(d / 3600) + ' val.';
      return 'prieš ' + Math.floor(d / 86400) + ' d.';
    } catch (e) { return ''; }
  }
  function iconFor(type) {
    return type === 'open' ? '👁' : type === 'click' ? '🔗' : type === 'doc' ? '📄' : type === 'reminder' ? '⏰' : '✉️';
  }

  function refreshPanel() {
    if (!panelEl) return;
    apiGet('activity?limit=25', function (d) {
      var feed = panelEl.querySelector('#mt-panel-feed');
      if (!d) { feed.innerHTML = '<div class="mt-empty">Nepavyko gauti veiklos. Patikrinkite plėtinio nustatymus.</div>'; return; }
      panelEl.querySelector('#mt-s-today').textContent = d.opens_today != null ? d.opens_today : '–';
      panelEl.querySelector('#mt-s-tracked').textContent = d.tracked != null ? d.tracked : '–';
      if (!d.items || !d.items.length) { feed.innerHTML = '<div class="mt-empty">Kol kas veiklos nėra.</div>'; return; }
      feed.innerHTML = '';
      d.items.forEach(function (n) {
        var it = document.createElement('div');
        it.className = 'mt-fitem';
        var ic = document.createElement('div'); ic.className = 'mt-fic'; ic.textContent = iconFor(n.type);
        var mid = document.createElement('div'); mid.className = 'mt-fmid';
        var t = document.createElement('div'); t.className = 'mt-ft'; t.textContent = n.title;
        var b = document.createElement('div'); b.className = 'mt-fb'; b.textContent = (n.body || '').split('\n')[0];
        var w = document.createElement('div'); w.className = 'mt-fw'; w.textContent = agoTxt(n.created_at);
        mid.appendChild(t); mid.appendChild(b); mid.appendChild(w);
        it.appendChild(ic); it.appendChild(mid);
        it.addEventListener('click', function () { window.open(n.url, '_blank'); });
        feed.appendChild(it);
      });
    });
  }

  // Periodiškai atnaujinam FAB ženkliuką (kiek naujų nuo paskutinio žvilgsnio) ir atvirą panelę
  var seenActivityId = 0;
  function pollFab() {
    if (!ready) return;
    apiGet('activity?limit=1', function (d) {
      if (!d) return;
      if (panelEl && panelOpen) refreshPanel();
      var newest = d.items && d.items[0] ? d.items[0].id : 0;
      if (seenActivityId && newest > seenActivityId && !panelOpen && fabEl) {
        fabEl.classList.add('pulse');
      }
      if (newest && !seenActivityId) seenActivityId = newest;
      if (panelOpen) { seenActivityId = newest; if (fabEl) fabEl.classList.remove('pulse'); }
    });
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
      menu.innerHTML = '';
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
      menu.innerHTML = '';
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

  // ================= SAVO PERŽIŪROS + ATIDARYTO LAIŠKO STATUSAS =================
  var selfviewSent = {};
  function scanOpenedMessages() {
    if (!ready) return;
    var re = pixelRegex();
    if (!re) return;
    // Atidarytų laiškų kūnai
    document.querySelectorAll('div.a3s:not([data-mt-scanned])').forEach(function (msg) {
      msg.setAttribute('data-mt-scanned', '1');
      var html = msg.innerHTML || '';
      var m = html.match(re);
      if (!m) return;
      var uid = m[1];
      // Tai MŪSŲ sekamas laiškas, kurį atidarė pats vartotojas -> selfview
      if (!selfviewSent[uid]) {
        selfviewSent[uid] = Date.now();
        apiPost('selfview', { uid: uid }, function () {});
      }
      apiGet('emails/' + uid, function (d) {
        if (d) { statusMap[uid] = d; injectOpenBanner(msg, d); }
      });
    });
  }

  function injectOpenBanner(msgEl, d) {
    var host = msgEl.closest('.gs, .adn, .h7') || msgEl.parentElement;
    if (!host) host = msgEl;
    var old = host.querySelector(':scope > .mt-banner');
    var opened = d.open_count > 0;
    var txt = opened
      ? '✓✓ MailTrack: atidaryta ' + d.open_count + ' k.' + (d.last_open_at ? ' · paskutinis ' + fmtShort(d.last_open_at) : '')
      : '✓ MailTrack: išsiųsta, dar neatidaryta';
    if (old) { old.className = 'mt-banner ' + (opened ? 'on' : ''); old.textContent = txt; old.title = 'Atidaryti skydelį'; return; }
    var b = document.createElement('div');
    b.className = 'mt-banner ' + (opened ? 'on' : '');
    b.textContent = txt;
    b.title = 'Atidaryti skydelį';
    b.addEventListener('click', function () { window.open(d.dashboard_url, '_blank'); });
    host.insertBefore(b, msgEl);
  }
  function fmtShort(iso) {
    try { var dt = new Date(iso); return dt.toLocaleString(); } catch (e) { return iso; }
  }

  // ================= LAIŠKŲ SĄRAŠAS (best-effort pagal temą) =================
  function refreshStatusIndex(cb) {
    var now = Date.now();
    if (now - lastStatusFetch < 20000) { cb && cb(); return; }
    lastStatusFetch = now;
    apiGet('emails?limit=200', function (d) {
      if (d && d.emails) {
        subjectIndex = {};
        d.emails.forEach(function (e) {
          statusMap[e.uid] = e;
          var key = (e.subject || '').trim().toLowerCase();
          if (key) {
            // jei tema kartojasi – laikom naujausią (sąrašas nuo naujausių)
            if (!subjectIndex[key]) subjectIndex[key] = e;
          }
        });
      }
      cb && cb();
    });
  }

  function decorateList() {
    if (!ready) return;
    // tik "Išsiųsti" rodinyje – ten temos atitikimas patikimesnis
    if (!/#sent/i.test(location.hash)) {
      document.querySelectorAll('.mt-list-badge').forEach(function (n) { n.remove(); });
      return;
    }
    refreshStatusIndex(function () {
      document.querySelectorAll('tr.zA').forEach(function (row) {
        if (row.__mtBadge) {
          // atnaujinam esamą pagal statusMap
        }
        var subjEl = row.querySelector('.bog, .y6 span[id], .bqe, .xT .y6 span');
        var subj = subjEl ? (subjEl.textContent || '').trim().toLowerCase() : '';
        if (!subj) return;
        var e = subjectIndex[subj];
        var cell = row.querySelector('.xW.xY, td.xY, .apU') || subjEl && subjEl.closest('td');
        if (!e) return;
        var opened = e.open_count > 0;
        var badge = row.querySelector('.mt-list-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'mt-list-badge';
          var anchor = row.querySelector('.xW, .y6') || subjEl;
          if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(badge, anchor);
          else return;
        }
        badge.classList.toggle('on', opened);
        badge.textContent = opened ? '✓✓' : '✓';
        badge.title = opened ? ('Atidaryta ' + e.open_count + ' k.') : 'Išsiųsta, neatidaryta';
        row.__mtBadge = true;
      });
    });
  }

  // ================= STEBĖJIMAS =================
  var tick = 0;
  var observer = new MutationObserver(function () {
    clearTimeout(tick);
    tick = setTimeout(function () {
      decorateComposes();
      scanOpenedMessages();
      decorateList();
      if (ready) ensureFab();
    }, 250);
  });

  /* Gmail savo įrankių juostoje perima paspaudimus (stopPropagation capture fazėje),
     todėl mūsų mygtukų click'ai nepasiekdavo jų pačių listener'ių. Sprendimas –
     vienas klausytojas ant document CAPTURE fazėje: jis suveikia PIRMAS. */
  function installClickCapture() {
    if (window.__mtClickCaptureInstalled) return;
    window.__mtClickCaptureInstalled = true;

    // Reaguojam į pointerdown – jis įvyksta anksčiausiai, dar prieš mousedown/click,
    // todėl Gmail nespėja paspaudimo "suvalgyti". click'ą tik nuslopinam.
    function handle(e, act) {
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest('.mt-tpl, .mt-track-toggle, .mt-fab');
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
      if (hit.classList.contains('mt-tpl')) {
        openTemplateMenu(hit, hit.__mtState);
      } else if (hit.classList.contains('mt-track-toggle')) {
        if (hit.__mtState) {
          hit.__mtState.on = !hit.__mtState.on;
          if (hit.__mtPaint) hit.__mtPaint();
        }
      }
    }
    document.addEventListener('pointerdown', function (e) { handle(e, true); }, true);
    document.addEventListener('mousedown', function (e) { handle(e, false); }, true);
    document.addEventListener('click', function (e) { handle(e, false); }, true);
  }
  // Registruojam IŠ KARTO (document_start), kad Gmail neužsiregistruotų anksčiau.
  installClickCapture();

  function boot() {
    loadCfg(function () {
      observer.observe(document.body, { childList: true, subtree: true });
      decorateComposes();
      scanOpenedMessages();
      decorateList();
      if (ready) { ensureFab(); pollFab(); }
      setInterval(pollFab, 20000);
      window.addEventListener('hashchange', function () { setTimeout(decorateList, 400); });
      chrome.storage.onChanged.addListener(function (c, area) { if (area === 'sync') loadCfg(function () { if (ready) ensureFab(); }); });
    });
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
