'use strict';
var $ = function (id) { return document.getElementById(id); };

$('openOpts') && $('openOpts').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });
$('openOpts2') && $('openOpts2').addEventListener('click', function () { chrome.runtime.openOptionsPage(); });

chrome.storage.sync.get({ serverUrl: '', apiKey: '', userEmail: '', trackByDefault: true }, function (c) {
  if (!c.serverUrl || !c.apiKey) {
    $('unconf').style.display = 'block';
    return;
  }
  $('conf').style.display = 'block';
  $('email').textContent = c.userEmail || '✓';
  $('dash').href = c.serverUrl.replace(/\/+$/, '');
  $('trackByDefault').checked = c.trackByDefault;
  $('trackByDefault').addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: 'setDefault', value: this.checked });
  });
});

chrome.storage.local.get({ errors: [] }, function (s) {
  if (s.errors && s.errors.length) {
    var box = $('errbox');
    if (!box) return;
    var last = s.errors[0];
    box.innerHTML = '<div class="err">Paskutinė klaida: ' + (last.m || '').replace(/</g, '&lt;') + '<br><span class="muted">' + last.t + '</span></div>';
  }
});
