'use strict';
var $ = function (id) { return document.getElementById(id); };
var msg = $('msg');

function show(type, text) { msg.className = 'msg ' + type; msg.textContent = text; }

function load() {
  chrome.storage.sync.get({ serverUrl: '', apiKey: '', trackByDefault: true, trackLinks: true, desktopNotify: true }, function (c) {
    $('serverUrl').value = c.serverUrl;
    $('apiKey').value = c.apiKey;
    $('trackByDefault').checked = c.trackByDefault;
    $('trackLinks').checked = c.trackLinks;
    $('desktopNotify').checked = c.desktopNotify;
  });
}

function ping(url, key) {
  return fetch(url.replace(/\/+$/, '') + '/api/ping', { headers: { 'X-Api-Key': key } })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); });
}

function save(testOnly) {
  var url = $('serverUrl').value.trim().replace(/\/+$/, '');
  var key = $('apiKey').value.trim();
  if (!/^https?:\/\//.test(url)) { show('err', 'Adresas turi prasidėti https://'); return; }
  if (key.length < 20) { show('err', 'API raktas atrodo per trumpas.'); return; }
  show('ok', 'Tikrinama…');
  ping(url, key).then(function (res) {
    if (res.status !== 200 || !res.d || !res.d.ok) {
      show('err', 'Ryšys nepavyko (HTTP ' + res.status + '). ' + ((res.d && res.d.error) || 'Patikrinkite adresą ir raktą.'));
      return;
    }
    var store = {
      serverUrl: url, apiKey: key,
      linkSecret: res.d.link_secret || '',
      userEmail: (res.d.user && res.d.user.email) || '',
      trackByDefault: $('trackByDefault').checked,
      trackLinks: $('trackLinks').checked,
      desktopNotify: $('desktopNotify').checked
    };
    if (testOnly) {
      show('ok', 'Ryšys veikia ✓ Prisijungta kaip ' + store.userEmail);
      return;
    }
    chrome.storage.sync.set(store, function () {
      show('ok', 'Išsaugota ✓ Prisijungta kaip ' + store.userEmail + '. Perkraukite Gmail skirtuką.');
    });
  }).catch(function (e) {
    show('err', 'Klaida jungiantis: ' + e + '\nGalimos priežastys: neteisingas adresas, serveris neatsako, arba .htaccess neįkeltas.');
  });
}

$('save').addEventListener('click', function () { save(false); });
$('test').addEventListener('click', function () { save(true); });
load();
