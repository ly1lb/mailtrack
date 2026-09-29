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
            var li = document.createElement('li');
            li.innerHTML = '<a class="t"></a><div class="b"></div><div class="w">ką tik</div>';
            li.querySelector('a').textContent = n.title; li.querySelector('a').href = n.url;
            li.querySelector('.b').textContent = n.body;
            feed.insertBefore(li, feed.firstChild);
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
