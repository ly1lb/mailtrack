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
      sendBtn.__mtDecorated = true;

      var state = { on: ready && CFG.trackByDefault, dialog: dialog, body: body };
      sendBtn.__mtState = state;

      var toggle = document.createElement('div');
      toggle.className = 'mt-toggle';
      toggle.setAttribute('role', 'button');
      toggle.tabIndex = 0;
      function paint() {
        toggle.classList.toggle('on', state.on);
        toggle.title = ready ? (state.on ? 'Sekimas įjungtas' : 'Sekimas išjungtas šiam laiškui') : 'Sukonfigūruokite plėtinį';
        toggle.innerHTML = '<span class="mt-tick">' + (state.on ? '✓✓' : '✓') + '</span><span class="mt-lbl">' + (state.on ? 'Sekama' : 'Sekti') + '</span>';
      }
      paint();
      toggle.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        if (!ready) { alert('MailTrack Pro: spauskite plėtinio ikoną ir įveskite serverio adresą bei API raktą.'); return; }
        state.on = !state.on; paint();
      });
      if (sendBtn.parentElement) sendBtn.parentElement.insertBefore(toggle, sendBtn.nextSibling);

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
    }, 250);
  });

  function boot() {
    loadCfg(function () {
      observer.observe(document.body, { childList: true, subtree: true });
      decorateComposes();
      scanOpenedMessages();
      decorateList();
      window.addEventListener('hashchange', function () { setTimeout(decorateList, 400); });
      chrome.storage.onChanged.addListener(function (c, area) { if (area === 'sync') loadCfg(); });
    });
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
