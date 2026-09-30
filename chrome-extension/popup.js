'use strict';
var $ = function (id) { return document.getElementById(id); };

$('openOpts') && $('openOpts').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

function ago(iso) {
  try {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'ką tik';
    if (d < 3600) return 'prieš ' + Math.floor(d / 60) + ' min.';
    if (d < 86400) return 'prieš ' + Math.floor(d / 3600) + ' val.';
    return 'prieš ' + Math.floor(d / 86400) + ' d.';
  } catch (e) { return ''; }
}
function icon(type) {
  return type === 'open' ? '👁' : type === 'click' ? '🔗' : type === 'doc' ? '📄' : type === 'reminder' ? '⏰' : '✉️';
}

chrome.storage.sync.get({ serverUrl: '', apiKey: '', userEmail: '', trackByDefault: true }, function (c) {
  if (!c.serverUrl || !c.apiKey) { $('unconf').style.display = 'block'; return; }
  $('conf').style.display = 'block';
  $('dash').href = c.serverUrl.replace(/\/+$/, '');
  $('trackByDefault').checked = c.trackByDefault;
  $('trackByDefault').addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: 'setDefault', value: this.checked });
  });
  loadActivity();
  loadTemplates();
});

/* Šablonai plėtinio lange – patikimiausias kelias, nes paspaudimas įvyksta
   MŪSŲ lange (Gmail čia įvykių neperima), o įterpimas yra tik DOM operacija. */
function loadTemplates() {
  var list = $('tplList');
  chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: 'templates' }, function (r) {
    if (chrome.runtime.lastError || !r || !r.ok) {
      list.innerHTML = '<li class="empty">Nepavyko gauti šablonų.</li>';
      return;
    }
    var items = (r.data && r.data.templates) || [];
    if (!items.length) {
      list.innerHTML = '<li class="empty">Šablonų nėra. Sukurkite skydelyje → Šablonai.</li>';
      return;
    }
    list.innerHTML = '';
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.style.cursor = 'pointer';
      var mid = document.createElement('div'); mid.style.flex = '1';
      var nm = document.createElement('div'); nm.className = 't'; nm.textContent = t.name;
      var sb = document.createElement('div'); sb.className = 'b'; sb.textContent = t.subject || '(be temos)';
      mid.appendChild(nm); mid.appendChild(sb);
      li.appendChild(mid);
      li.addEventListener('click', function () { insertTemplate(t, li); });
      list.appendChild(li);
    });
    $('tplHint').textContent = '– spauskite, kad įterptumėte';
  });
}

function insertTemplate(t, li) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'mt-insert-template', template: t }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) {
        var why = (res && res.error) || 'atidarykite Gmail ir pradėkite rašyti laišką';
        li.querySelector('.b').textContent = '⚠ ' + why;
        li.querySelector('.b').style.color = '#b3261e';
        return;
      }
      chrome.runtime.sendMessage({ type: 'api', method: 'POST', path: 'templates/' + t.id + '/use' });
      li.querySelector('.b').textContent = '✓ Įterpta';
      li.querySelector('.b').style.color = '#16803c';
      setTimeout(function () { window.close(); }, 500);
    });
  });
}

function loadActivity() {
  chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: 'activity?limit=20' }, function (r) {
    if (chrome.runtime.lastError || !r || !r.ok) {
      $('feed').innerHTML = '<li class="empty">Nepavyko gauti veiklos.</li>';
      showErr(r && r.error);
      return;
    }
    var d = r.data;
    $('s-today').textContent = d.opens_today != null ? d.opens_today : '–';
    $('s-tracked').textContent = d.tracked != null ? d.tracked : '–';
    var feed = $('feed');
    if (!d.items || !d.items.length) { feed.innerHTML = '<li class="empty">Kol kas veiklos nėra.</li>'; return; }
    feed.innerHTML = '';
    d.items.forEach(function (n) {
      var li = document.createElement('li');
      var ic = document.createElement('div'); ic.className = 'ic'; ic.textContent = icon(n.type);
      var mid = document.createElement('div'); mid.style.flex = '1';
      var t = document.createElement('div'); t.className = 't'; t.textContent = n.title;
      var b = document.createElement('div'); b.className = 'b'; b.textContent = (n.body || '').split('\n')[0];
      var w = document.createElement('div'); w.className = 'w'; w.textContent = ago(n.created_at);
      mid.appendChild(t); mid.appendChild(b); mid.appendChild(w);
      li.appendChild(ic); li.appendChild(mid);
      li.addEventListener('click', function () { chrome.tabs.create({ url: n.url }); });
      feed.appendChild(li);
    });
  });
}

function showErr(msg) {
  chrome.storage.local.get({ errors: [] }, function (s) {
    if (s.errors && s.errors.length) {
      var last = s.errors[0];
      $('errbox').innerHTML = '<div class="err">Klaida: ' + (last.m || msg || '').replace(/</g, '&lt;') + '</div>';
    } else if (msg) {
      $('errbox').innerHTML = '<div class="err">' + String(msg).replace(/</g, '&lt;') + '</div>';
    }
  });
}
