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
  var lastComposeState = null;   // paskutinis aptiktas rašymo langas
  var statusMap = {};        // uid -> {open_count, ...}
  var subjectIndex = {};     // "subject|recip" -> email (best-effort sąrašui)
  var lastStatusFetch = 0;
  var trackSenders = {};     // siuntėjų domenai, kurių laiškuose aptikome sekiklį (rodom tašką sąraše)

  function loadTrackSenders() {
    try {
      chrome.storage.local.get({ trackSenders: {} }, function (s) {
        if (chrome.runtime.lastError) return;
        trackSenders = s.trackSenders || {};
      });
    } catch (e) {}
  }
  function rememberTrackSender(domain, label) {
    if (!domain) return;
    if (trackSenders[domain]) return;
    trackSenders[domain] = label || domain;
    try {
      // apribojam iki ~800 įrašų, kad neaugtų be galo
      var keys = Object.keys(trackSenders);
      if (keys.length > 800) { delete trackSenders[keys[0]]; }
      chrome.storage.local.set({ trackSenders: trackSenders });
    } catch (e) {}
    // ką tik sužinojom – perpiešiam sąrašą, kad iškart atsirastų taškas
    safe('decorateList', decorateList);
  }
  function domainOf(email) {
    var at = String(email || '').lastIndexOf('@');
    if (at === -1) return '';
    var host = email.slice(at + 1).toLowerCase().trim();
    var parts = host.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : host;
  }

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
      lastComposeState = state; // kad šabloną būtų galima įterpti ir iš plėtinio lango

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
      // Gmail proxy gali URL-koduoti mūsų pikselio nuorodą – tikrinam ir atkoduotus img src
      if (!m) {
        var imgs = msg.querySelectorAll('img');
        for (var k = 0; k < imgs.length && !m; k++) {
          var raw = imgs[k].getAttribute('src') || imgs[k].getAttribute('data-src') || '';
          m = (deproxy(raw) || '').match(re);
        }
      }
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
    detectForeignTrackers();
  }

  /* Ar KITI seka mus? Mailsuite rodo žalią tašką, kai gavėjas irgi naudoja Mailsuite.
     Naudingesnis variantas: aptinkam, kai gautame laiške yra sekimo pikselis – t.y.
     siuntėjas seka, ar jūs perskaitėte. Rodom ženklą su sekiklio pavadinimu. */
  var TRACKERS = [
    [/mailtrack\.io|mailtrack\.me/i, 'Mailtrack'],
    [/mailsuite\.com|\bmlsnd\b/i, 'Mailsuite'],
    [/yesware\.com/i, 'Yesware'],
    [/streak\.com|mailfoogae/i, 'Streak'],
    [/hubspot\.com|hubspotemail|hs-sites|hubspotlinks/i, 'HubSpot'],
    [/mixmax\.com/i, 'Mixmax'],
    [/bananatag\.com/i, 'Bananatag'],
    [/saleshandy\.com/i, 'Saleshandy'],
    [/snov\.io/i, 'Snov.io'],
    [/gmass\.co/i, 'GMass'],
    [/contactmonkey\.com/i, 'ContactMonkey'],
    [/cirrusinsight\.com/i, 'Cirrus Insight'],
    [/getnotify\.com|didtheyreadit/i, 'GetNotify'],
    [/outreach\.io/i, 'Outreach'],
    [/apollo\.io/i, 'Apollo'],
    [/sendgrid\.net|sendgrid\.com/i, 'SendGrid'],
    [/mailchimp\.com|list-manage\.com|mcusercontent/i, 'Mailchimp'],
    [/sparkpostmail|sparkpost\.com/i, 'SparkPost'],
    [/mailgun\.org|mailgun\.net|mailgun\.com|mailgunapp/i, 'Mailgun'],
    [/sendinblue\.com|sibautomation|brevo\.com/i, 'Brevo/Sendinblue'],
    [/customer\.io|customeriomail|track\.customer/i, 'Customer.io'],
    [/klaviyo\.com|kmail-lists/i, 'Klaviyo'],
    [/hubs\.ly/i, 'HubSpot'],
    [/mandrillapp\.com/i, 'Mandrill'],
    [/postmarkapp\.com|pstmrk\.it/i, 'Postmark'],
    [/mailerlite\.com|ml\.mailerlite|mlsend\.com|mlsend\.net/i, 'MailerLite'],
    [/constantcontact\.com|rs6\.net|ctctcdn/i, 'Constant Contact'],
    [/activehosted\.com|activecampaign/i, 'ActiveCampaign'],
    [/getresponse\.com|grsm\.io/i, 'GetResponse'],
    [/aweber\.com|awtrack/i, 'AWeber'],
    [/convertkit|ck\.page|kit\.com/i, 'ConvertKit'],
    [/marketo\.com|mktoresp|mkto\b/i, 'Marketo'],
    [/pardot\.com|pi\.pardot/i, 'Pardot'],
    [/salesforce\.com\/.*\/email|exct\.net|exacttarget/i, 'Salesforce'],
    [/intercom|intercomcdn|intercomassets/i, 'Intercom'],
    [/amazonses|amazonaws\.com\/.*open/i, 'Amazon SES'],
    [/sendpulse\.com/i, 'SendPulse'],
    [/moosend\.com/i, 'Moosend'],
    [/omnisend\.com/i, 'Omnisend'],
    [/drip\.com|getdrip/i, 'Drip'],
    [/woodpecker\.co/i, 'Woodpecker'],
    [/lemlist\.com|lemwarm/i, 'Lemlist'],
    [/reply\.io/i, 'Reply.io'],
    [/close\.com|close\.io/i, 'Close CRM'],
    [/pipedrive|pipedrivemail/i, 'Pipedrive'],
    [/zoho\.com\/.*open|zohomail|zcsend/i, 'Zoho'],
    [/mailjet\.com|mjt\.lu/i, 'Mailjet'],
    [/elasticemail/i, 'Elastic Email'],
    [/benchmarkemail/i, 'Benchmark'],
    [/campaign-archive|cmail\d|createsend\.com/i, 'Campaign Monitor'],
    [/tinyletter/i, 'TinyLetter'],
    [/substack\.com\/.*open|substackcdn/i, 'Substack'],
    [/bit\.ly\/.*\.gif|beacon|open\.aspx/i, 'sekimo pikselis']
  ];

  /* Gmail VISAS gautų laiškų paveikslėlių nuorodas persiunčia per savo tarpinį
     serverį (googleusercontent.com Image Proxy). Tikroji sekiklio nuoroda lieka
     po „#" (fragmente) arba URL-kode. Be jos atkodavimo sekiklio nepamatytume –
     dėl to anksčiau nieko nerodė. Čia atkoduojam originalią nuorodą. */
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

    // 1) Žinomi sekimo/rinkodaros paslaugų teikėjai (pagal domeną atkoduotame URL'e)
    for (var i = 0; i < TRACKERS.length; i++) {
      if (TRACKERS[i][0].test(src)) return TRACKERS[i][1];
    }

    var host;
    try { host = new URL(src, location.href).hostname.toLowerCase(); } catch (e) { return null; }
    // mūsų pačių serveris – praleidžiam
    if (CFG && CFG.serverUrl) { try { if (new URL(CFG.serverUrl).hostname.toLowerCase() === host) return null; } catch (e) {} }
    // Jei net po atkodavimo liko Google domenas – tai tikras Google turinys
    // (emoji, nuotraukos), NE sekiklis; praleidžiam.
    if (/(^|\.)(google|googleusercontent|gstatic|ggpht|youtube|ytimg|googleapis|gmail)\.com$/i.test(host)) return null;
    if (/(^|\.)google\.[a-z.]+$/i.test(host)) return null;

    var w = parseInt(img.getAttribute('width') || '0', 10);
    var h = parseInt(img.getAttribute('height') || '0', 10);
    var st = (img.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
    var tiny = (w > 0 && w <= 3) || (h > 0 && h <= 3)
      || img.naturalWidth === 1 || img.naturalHeight === 1
      || (img.naturalWidth > 0 && img.naturalWidth <= 2 && img.naturalHeight > 0 && img.naturalHeight <= 2);
    var hidden = /display:none|visibility:hidden|opacity:0|width:0|height:0|width:1px|height:1px/.test(st)
      || (img.offsetParent === null && img.getBoundingClientRect().width <= 3);
    var trackyUrl = /(open|pixel|beacon|track|trk|trackable|wf\/open|\/o\/|\/t\/|\/e\/|utm_|mkt_tok|email=|recipient=|mid=|sig=|eid=|subscriber|campaign|newsletter|\bimg\.php|spacer\.gif|clear\.gif|1x1|blank\.gif|\.gif(\?|#|$))/i.test(src);

    if (tiny || hidden || trackyUrl) {
      var parts = host.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : host;
    }
    return null;
  }

  function detectForeignTrackers() {
    document.querySelectorAll('div.a3s').forEach(function (msg) {
      // Jei jau pažymėta – nebeskanuojam
      if (msg.previousElementSibling && msg.previousElementSibling.classList.contains('mt-tracked-by')) return;
      // Ribotas kartojimas: paveikslėliai kraunasi ne iškart (Gmail proxy),
      // todėl bandom kelis ciklus, kol pikselis užsikrauna arba pasiduodam.
      var tries = parseInt(msg.getAttribute('data-mt-tries') || '0', 10);
      if (tries >= 12) return;
      msg.setAttribute('data-mt-tries', String(tries + 1));

      var found = {};
      var pending = false;
      msg.querySelectorAll('img').forEach(function (img) {
        var raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-surl') || '';
        if (!raw) return;
        var name = trackerFromSrc(raw, img);
        if (name) { found[name] = 1; return; }
        // dar neužsikrovęs paveikslėlis – gali būti pikselis; perskenuosim jam užsikrovus
        if ((!img.complete || img.naturalWidth === 0) && !img.__mtLoadHook) {
          img.__mtLoadHook = 1;
          pending = true;
          img.addEventListener('load', function () { safe('detectForeignTrackers', detectForeignTrackers); }, { once: true });
          img.addEventListener('error', function () { safe('detectForeignTrackers', detectForeignTrackers); }, { once: true });
        }
      });
      var names = Object.keys(found);
      if (!names.length) {
        // jei liko nekrautų paveikslėlių – dar bandysim kitą ciklą (per observer/pollFab)
        return;
      }
      // Trumpas ženklas: tik 🔴 + sekiklio pavadinimas (be litanijos).
      var b = document.createElement('div');
      b.className = 'mt-tracked-by';
      b.textContent = '🔴 ' + names.join(' · ');
      b.title = 'Šis laiškas jus seka – siuntėjas mato, ar ir kada jį atidarėte (' + names.join(', ') + '). Kad nesektų, Gmail nustatymuose išjunkite automatinį paveikslėlių rodymą.';
      insertBefore(b, msg);

      // Įsimenam siuntėjo domeną – kad tašką galėtume rodyti ir laiškų SĄRAŠE.
      var sender = senderOf(msg);
      if (sender) rememberTrackSender(domainOf(sender), names[0]);
    });
  }

  /* Atidaryto laiško siuntėjo el. paštas (iš antraštės). Reikia, kad sąraše
     galėtume pažymėti tašku laiškus iš to paties sekančio siuntėjo. */
  function senderOf(msg) {
    var box = msg.closest('.gs, .adn, .h7, [data-message-id]') || msg.parentElement;
    for (var hop = 0; box && hop < 4; hop++) {
      var el = box.querySelector('span[email], [data-hovercard-id]');
      if (el) {
        var em = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
        if (em.indexOf('@') !== -1) return em;
      }
      box = box.parentElement;
    }
    return '';
  }

  /* SVARBU: įterpiam tik į TIKRĄ tėvinį elementą.
     Anksčiau čia buvo host = msg.closest('.gs, .adn, .h7'), o toks protėvis
     būna keliais lygiais aukščiau – tada insertBefore(b, msg) meta
     NotFoundError ir nutraukia visą ciklą (nebeveikia sąrašo ženklai,
     mini dashboardas ir kt.). */
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

  function injectOpenBanner(msgEl, d) {
    var opened = d.open_count > 0;
    var txt = opened
      ? '✓✓ MailTrack: atidaryta ' + d.open_count + ' k.' + (d.last_open_at ? ' · paskutinis ' + fmtShort(d.last_open_at) : '')
      : '✓ MailTrack: išsiųsta, dar neatidaryta';
    if (d.forwarded) txt += ' · ↪ galimai persiųstas';
    var cls = 'mt-banner ' + (opened ? 'on' : '') + (d.forwarded ? ' fwd' : '');
    var tip = d.forwarded && d.forward_reason ? d.forward_reason + ' · atidaryti skydelį' : 'Atidaryti skydelį';
    var prev = msgEl.previousElementSibling;
    if (prev && prev.classList.contains('mt-banner')) {
      prev.className = cls;
      prev.textContent = txt;
      prev.title = tip;
      return;
    }
    var b = document.createElement('div');
    b.className = cls;
    b.textContent = txt;
    b.title = tip;
    b.addEventListener('click', function () { window.open(d.dashboard_url, '_blank'); });
    insertBefore(b, msgEl);
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
          var key = normSubject(e.subject);
          if (key) {
            // jei tema kartojasi – laikom naujausią (sąrašas nuo naujausių)
            if (!subjectIndex[key]) subjectIndex[key] = e;
          }
        });
      }
      cb && cb();
    });
  }

  // Temą normalizuojam: nuimam Re:/Fwd:/Fw: priešdėlius ir sutraukiam tarpus,
  // kad sekamą laišką atpažintume ir gijoje (atsakymuose), ir persiųstą.
  function normSubject(s) {
    s = String(s || '').toLowerCase().trim();
    var prev;
    do { prev = s; s = s.replace(/^\s*(re|fwd|fw|atsak|persi)\s*:\s*/i, ''); } while (s !== prev);
    return s.replace(/\s+/g, ' ').trim();
  }

  function decorateList() {
    if (!ready) return;
    // Rodom VISUOSE sąrašuose (Gauti, Išsiųsti, Visi, paieška, etiketės) – kaip
    // Mailsuite žalią tašką. Sekamą laišką atpažįstam pagal normalizuotą temą,
    // todėl matomas ir gijoje su atsakymais.
    refreshStatusIndex(function () {
      document.querySelectorAll('tr.zA').forEach(function (row) {
        var subjEl = row.querySelector('.bog, .y6 span[id], .bqe, .xT .y6 span, .y6 > span');
        var anchor = row.querySelector('.xW, .y6') || subjEl;

        // (A) RAUDONAS taškas: laiškas iš siuntėjo, kurio laiškuose aptikome sekiklį
        //     (kaip Mailsuite – matai dar sąraše, kad tave seka).
        var sEl = row.querySelector('.yW span[email], .zF[email], span[email], [data-hovercard-id]');
        var sEmail = sEl ? (sEl.getAttribute('email') || sEl.getAttribute('data-hovercard-id') || '') : '';
        var sDom = domainOf(sEmail);
        var trk = row.querySelector('.mt-list-trk');
        if (sDom && trackSenders[sDom]) {
          if (!trk && anchor && anchor.parentElement) {
            trk = document.createElement('span');
            trk.className = 'mt-list-trk';
            trk.textContent = '●';
            anchor.parentElement.insertBefore(trk, anchor);
          }
          if (trk) trk.title = 'Šis siuntėjas jus seka (' + trackSenders[sDom] + ') – mato, ar atidarėte laišką.';
        } else if (trk) {
          trk.remove();
        }

        // (B) ŽALIAS/PILKAS taškas: MŪSŲ pačių sekamas laiškas (pagal temą)
        var subj = subjEl ? normSubject(subjEl.textContent) : '';
        var e = subj ? subjectIndex[subj] : null;
        var badge = row.querySelector('.mt-list-badge');
        if (!e) {
          if (badge) badge.remove();
          row.__mtBadge = false;
          return;
        }
        var opened = e.open_count > 0;
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'mt-list-badge';
          if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(badge, anchor);
          else return;
        }
        badge.classList.toggle('on', opened);
        badge.classList.toggle('fwd', !!e.forwarded);
        badge.textContent = e.forwarded ? '↪' : '●';
        badge.title = (opened
          ? ('MailTrack: atidaryta ' + e.open_count + ' k.' + (e.last_open_at ? ' · ' + fmtShort(e.last_open_at) : ''))
          : 'MailTrack: sekama · dar neatidaryta') + (e.forwarded ? ' · galimai persiųstas' : '');
        row.__mtBadge = true;
      });
    });
  }

  // ================= STEBĖJIMAS =================
  /* Kiekvieną dalį vykdom atskirai. Anksčiau viena klaida (pvz. insertBefore su
     netinkamu tėvu) nutraukdavo VISĄ ciklą – tada nebeveikdavo nei sąrašo ženklai,
     nei mini dashboardas. Dabar sugedusi dalis nebetrukdo kitoms. */
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

  var tick = 0;
  var observer = new MutationObserver(function () {
    clearTimeout(tick);
    tick = setTimeout(runCycle, 250);
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
  }
  // Registruojam IŠ KARTO (document_start), kad Gmail neužsiregistruotų anksčiau.
  installClickCapture();

  /* Šablono įterpimas IŠ PLĖTINIO LANGO (popup).
     Tai patikimiausias kelias: paspaudimas įvyksta mūsų pačių lange, kur Gmail
     įvykių neperima, o čia atliekama tik DOM operacija. */
  function currentComposeState() {
    if (lastComposeState && document.contains(lastComposeState.body)) return lastComposeState;
    var el = document.querySelector('div[aria-label][contenteditable="true"], div[g_editable="true"][contenteditable="true"]');
    if (!el) return null;
    var dlg = el.closest('div[role="dialog"]') || el.closest('div.M9, div.aoI, div.nH') || el.parentElement;
    return { on: true, dialog: dlg, body: el };
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
    loadTrackSenders();
    loadCfg(function () {
      safe('observe', function () { observer.observe(document.body, { childList: true, subtree: true }); });
      runCycle();
      if (ready) safe('pollFab', pollFab);
      setInterval(function () { safe('pollFab', pollFab); }, 20000);
      window.addEventListener('hashchange', function () {
        setTimeout(function () { safe('decorateList', decorateList); }, 400);
      });
      safe('storageListener', function () {
        chrome.storage.onChanged.addListener(function (c, area) {
          if (area === 'sync') loadCfg(function () { if (ready) safe('ensureFab', ensureFab); });
        });
      });
    });
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
