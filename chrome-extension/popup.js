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
});

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
