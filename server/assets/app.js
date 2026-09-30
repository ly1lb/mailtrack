(function () {
  'use strict';
  var base = document.body.dataset.base || '';
  var csrf = document.body.dataset.csrf || '';

  // Klientinių klaidų siuntimas į serverio žurnalą
  function logRemote(level, message, context) {
    try {
      fetch(base + '/api/log', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ level: level, message: message, context: context, source: 'skydelis' })
      });
    } catch (e) { /* tyliai */ }
  }
  window.addEventListener('error', function (e) {
    logRemote('error', 'JS: ' + e.message, { file: e.filename, line: e.lineno, page: location.pathname });
  });

  function stripLeadEmoji(t) {
    return String(t || '').replace(/^(?:[\u2190-\u27BF\u2B00-\u2BFF\uFE0F\u2705\u2713\u2714]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]|\s)+/, '').trim();
  }

  // Mobilusis meniu
  var burger = document.getElementById('burger');
  var navEl = document.getElementById('nav');
  if (burger && navEl) {
    burger.addEventListener('click', function () {
      var open = navEl.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.textContent = open ? '✕' : '☰';
    });
  }

  // Kopijavimo mygtukai
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-copy]');
    if (b) {
      var input = b.parentElement.querySelector('input,textarea');
      if (!input) return;
      input.select();
      (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).catch(function () { document.execCommand('copy'); });
      flashBtn(b);
      return;
    }
    var h = ev.target.closest('[data-copy-html]');
    if (h) {
      var html = h.getAttribute('data-copy-html');
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([' '], { type: 'text/plain' })
        })]).then(function () { flashBtn(h); }).catch(function (e) { fallbackHtmlCopy(html); flashBtn(h); });
      } else {
        fallbackHtmlCopy(html);
        flashBtn(h);
      }
    }
  });
  function fallbackHtmlCopy(html) {
    var d = document.createElement('div');
    d.contentEditable = 'true';
    d.innerHTML = html + '&nbsp;';
    d.style.position = 'fixed'; d.style.left = '-9999px';
    document.body.appendChild(d);
    var r = document.createRange(); r.selectNodeContents(d);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy');
    s.removeAllRanges(); d.remove();
  }
  function flashBtn(b) {
    var t = b.textContent; b.textContent = '✓ Nukopijuota';
    setTimeout(function () { b.textContent = t; }, 1500);
  }

  // Tiesioginiai pranešimai (tikro laiko įspėjimai kol skydelis atidarytas)
  var feed = document.getElementById('feed');
  var lastId = 0;
  function toast(title, body, url) {
    var t = document.createElement('a');
    t.className = 'toast'; t.href = url || '#';
    t.innerHTML = '<div class="t"></div><div class="b"></div>';
    t.querySelector('.t').textContent = title;
    t.querySelector('.b').textContent = body || '';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 8000);
  }
  function poll() {
    fetch(base + '/api/notifications?since=' + lastId, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var first = lastId === 0;
        lastId = d.last_id || lastId;
        if (first) return;
        (d.items || []).forEach(function (n) {
          toast(n.title, n.body, n.url);
          if (window.Notification && Notification.permission === 'granted') {
            try { var no = new Notification(n.title, { body: n.body, icon: base + '/assets/icon-192.png', tag: 'mt-' + n.id }); no.onclick = function () { window.focus(); location.href = n.url; }; } catch (e) {}
          }
          if (feed) {
            var icons = { open: '👁', click: '🔗', doc: '📄', reminder: '⏰' };
            var li = document.createElement('li');
            li.innerHTML = '<span class="avatar h0">•</span><div class="mid"><a class="line"><b class="who"></b> <span class="subj"></span></a><div class="meta"><span class="ic-type"></span><span class="w">ką tik</span></div></div>';
            li.querySelector('.ic-type').textContent = icons[n.type] || '✉️';
            var a = li.querySelector('a');
            a.href = n.url;
            a.querySelector('.who').textContent = stripLeadEmoji(n.title);
            a.querySelector('.subj').textContent = '';
            var b1 = (n.body || '').split('\n')[0];
            if (b1) { var w = document.createElement('span'); w.className = 'where'; w.textContent = b1; li.querySelector('.meta').appendChild(w); }
            var em = feed.querySelector('.feed-empty'); if (em) em.remove();
            feed.insertBefore(li, feed.firstChild);
            while (feed.children.length > 12) feed.removeChild(feed.lastChild);
          }
        });
      })
      .catch(function () { /* tinklas gali trūkinėti – bandom vėl */ });
  }
  if (document.querySelector('.top')) {
    poll();
    setInterval(poll, 15000);
    if (window.Notification && Notification.permission === 'default') {
      document.addEventListener('click', function ask() {
        Notification.requestPermission();
        document.removeEventListener('click', ask);
      }, { once: true });
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(base + '/sw.js').catch(function (e) { logRemote('warning', 'SW registracija: ' + e); });
  }
})();
