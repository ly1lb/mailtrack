/* MailTrack Pro – Gmail turinio skriptas.
   Prideda "✓✓ Sekti" jungiklį į rašymo langą, o paspaudus "Siųsti":
   - įterpia nematomą sekimo pikselį į laiško HTML;
   - (jei įjungta) perrašo nuorodas per sekimo peradresavimą su HMAC parašu;
   - užregistruoja laišką serveryje (temą, gavėjus, uid).
   Sąrašo rodinyje prie sekamų laiškų rodo ✓ / ✓✓ statusą. */
(function () {
  'use strict';
  if (!location.hostname.endsWith('mail.google.com')) return;

  var CFG = null;
  var ready = false;

  function log(message, context) {
    try { chrome.runtime.sendMessage({ type: 'log', message: message, context: context }); } catch (e) {}
  }

  function loadCfg(cb) {
    try {
      chrome.runtime.sendMessage({ type: 'config' }, function (r) {
        if (chrome.runtime.lastError) { return; }
        if (r && r.ok) { CFG = r.cfg; ready = !!(CFG.serverUrl && CFG.apiKey); }
        cb && cb();
      });
    } catch (e) { /* plėtinys perkraunamas */ }
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

  // ---- Rašymo langų aptikimas ----
  function findComposes() {
    // Gmail rašymo dialogas turi table.iN su siųsti mygtuku [role=button][data-tooltip*="Send"] / "Siųsti"
    return Array.prototype.slice.call(document.querySelectorAll('div.M9, table.cf.An'))
      .map(function (n) { return n.closest('div.aoI, div.nH.aHU, div.M9') || n; });
  }

  function getSendButton(dialog) {
    var btns = dialog.querySelectorAll('div[role="button"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var tip = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').toLowerCase();
      if (/(^|\b)(send|siųsti|siunčia)/.test(tip) && !/schedule|later|vėliau/.test(tip)) return b;
    }
    return null;
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
    // laukai „Kam“ su tekstiniu įvedimu
    dialog.querySelectorAll('textarea[name="to"], input[name="to"]').forEach(function (n) {
      (n.value || '').split(/[,;\s]+/).forEach(function (e) { if (e.indexOf('@') > 0) set[e.toLowerCase()] = 1; });
    });
    return Object.keys(set);
  }

  function getSubject(dialog) {
    var s = dialog.querySelector('input[name="subjectbox"]');
    return s ? s.value : '';
  }

  // ---- Jungiklio įdėjimas ----
  function decorateCompose(dialog) {
    if (dialog.__mtDone) return;
    var sendBtn = getSendButton(dialog);
    var body = getBodyEl(dialog);
    if (!sendBtn || !body) return;
    dialog.__mtDone = true;

    var toolbar = sendBtn.closest('td, div');
    var toggle = document.createElement('div');
    toggle.className = 'mt-toggle';
    toggle.setAttribute('role', 'button');
    toggle.tabIndex = 0;
    var on = ready && CFG.trackByDefault;
    function paint() {
      toggle.classList.toggle('on', on);
      toggle.title = ready ? (on ? 'Sekimas įjungtas – atidarymai bus stebimi' : 'Sekimas išjungtas šiam laiškui') : 'Sukonfigūruokite plėtinį (spauskite ikoną)';
      toggle.innerHTML = '<span class="mt-tick">' + (on ? '✓✓' : '✓') + '</span><span class="mt-lbl">' + (on ? 'Sekama' : 'Sekti') + '</span>';
    }
    paint();
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!ready) { chrome.runtime.sendMessage({ type: 'config' }); alert('MailTrack Pro: spauskite plėtinio ikoną viršuje ir įveskite serverio adresą bei API raktą.'); return; }
      on = !on;
      paint();
    });
    dialog.__mtState = { get on() { return on; }, body: body, dialog: dialog };

    if (sendBtn.parentElement) {
      sendBtn.parentElement.insertBefore(toggle, sendBtn.nextSibling);
    }

    // Perimame "Siųsti": mygtukas ir Ctrl+Enter
    sendBtn.addEventListener('click', function () { beforeSend(dialog); }, true);
    dialog.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') beforeSend(dialog);
    }, true);
  }

  var handled = new WeakSet();
  function beforeSend(dialog) {
    try {
      var st = dialog.__mtState;
      if (!st || !st.on || !ready) return;
      if (handled.has(dialog)) return;
      handled.add(dialog);
      var body = st.body;
      if (!body || body.querySelector('img.mt-px')) return;

      var uid = uidGen();
      var links = [];

      if (CFG.trackLinks) {
        var anchors = body.querySelectorAll('a[href^="http"]');
        anchors.forEach(function (a, i) {
          var url = a.getAttribute('href');
          if (!url || a.__mt) return;
          if (CFG.serverUrl && url.indexOf(CFG.serverUrl) === 0) return; // savų nekeičiam
          var tracked = CFG.serverUrl + '/c/' + uid + '/' + i + '?u=' + b64url(url) + '&s=' + sig(uid, i, url);
          a.setAttribute('href', tracked);
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

      var payload = {
        uid: uid,
        subject: getSubject(dialog),
        recipients: getRecipients(dialog),
        links: links,
        source: 'gmail-chrome'
      };
      chrome.runtime.sendMessage({ type: 'register', payload: payload }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) log('Nepavyko įtraukti laiško į eilę', { uid: uid });
      });
    } catch (e) {
      log('beforeSend klaida: ' + (e && e.message), { stack: String(e && e.stack).slice(0, 200) });
    }
  }

  // ---- Statusas laiškų sąraše ----
  function decorateList() {
    // Nieko nedarome be konfigūracijos
    if (!ready) return;
    // (Papildomai galima tikrinti serveryje; kad neapkrautume, statusą rodome tik rašymo lange.)
  }

  // ---- Stebėjimas ----
  var observer = new MutationObserver(function () {
    findComposes().forEach(decorateCompose);
  });

  function boot() {
    loadCfg(function () {
      observer.observe(document.body, { childList: true, subtree: true });
      findComposes().forEach(decorateCompose);
      chrome.storage.onChanged.addListener(function (c, area) {
        if (area === 'sync') loadCfg();
      });
    });
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
