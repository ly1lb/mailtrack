<?php $title = 'Diagnostika – MailTrack Pro'; ?>
<h1>Diagnostika</h1>
<div class="grid g4">
  <div class="tile"><div class="lbl">Klaidos šiandien</div><div class="num" style="color:<?= $errCount ? 'var(--bad)' : 'inherit' ?>"><?= $errCount ?></div><div class="sub"><a href="<?= e(base_url('logs?level=ERROR')) ?>">Peržiūrėti</a></div></div>
  <div class="tile"><div class="lbl">Įspėjimai šiandien</div><div class="num"><?= $warnCount ?></div><div class="sub"><a href="<?= e(base_url('logs?level=WARNING')) ?>">Peržiūrėti</a></div></div>
  <div class="tile"><div class="lbl">Versija</div><div class="num" style="font-size:18px"><?= APP_VERSION ?></div></div>
  <div class="tile"><div class="lbl">Serverio laikas (UTC)</div><div class="num" style="font-size:18px"><?= gmdate('H:i:s') ?></div></div>
</div>

<h2>Patikros</h2>
<div class="tbl-wrap">
<table>
  <?php foreach ($checks as [$name, $ok, $info]): ?>
    <tr><td style="width:36px"><?= $ok ? '<span class="badge good">✓</span>' : '<span class="badge bad">✕</span>' ?></td><td><?= e($name) ?></td><td class="mono"><?= e($info) ?></td></tr>
  <?php endforeach; ?>
  <tr><td id="rw-icon"><span class="badge">…</span></td><td>URL perrašymas (.htaccess) ir API</td><td class="mono" id="rw-info">tikrinama…</td></tr>
</table>
</div>

<h2>Testai</h2>
<div class="card">
  <form method="post" action="<?= e(base_url('diagnostics/mail')) ?>" class="inline"><?= csrf_field() ?><button class="btn">Siųsti bandomąjį laišką sau</button></form>
  <form method="post" action="<?= e(base_url('diagnostics/telegram')) ?>" class="inline"><?= csrf_field() ?><button class="btn">Bandomasis Telegram</button></form>
  <form method="post" action="<?= e(base_url('diagnostics/pixel')) ?>" class="inline"><?= csrf_field() ?><button class="btn">Sukurti testinį sekamą laišką</button></form>
  <p class="help">Cron komanda Hostinger (hPanel → Advanced → Cron Jobs, kas 5 min.):<br>
    <code>/usr/bin/php <?= e(APP_ROOT) ?>/cron.php</code><br>
    arba URL variantas: <code>curl -s "<?= e(base_url('cron.php')) ?>?key=<?= e(substr((string)cfg('cron_key'), 0, 3)) ?>…"</code></p>
</div>

<h2>Duomenys</h2>
<div class="tbl-wrap"><table>
  <?php foreach ($counts as $k => $v): ?><tr><td><?= e($k) ?></td><td class="num"><?= (int)$v ?></td></tr><?php endforeach; ?>
  <tr><td>PHP</td><td class="num mono"><?= e(PHP_VERSION . ' · ' . PHP_SAPI . ' · ' . ($_SERVER['SERVER_SOFTWARE'] ?? '')) ?></td></tr>
  <tr><td>upload_max_filesize / post_max_size</td><td class="num mono"><?= e(ini_get('upload_max_filesize') . ' / ' . ini_get('post_max_size')) ?></td></tr>
</table></div>
<script>
fetch(document.body.dataset.base + '/health').then(r => r.json()).then(d => {
  document.getElementById('rw-icon').innerHTML = '<span class="badge good">✓</span>';
  document.getElementById('rw-info').textContent = 'OK, versija ' + d.version;
}).catch(e => {
  document.getElementById('rw-icon').innerHTML = '<span class="badge bad">✕</span>';
  document.getElementById('rw-info').textContent = 'Neveikia: ' + e + ' – patikrinkite, ar įkeltas .htaccess failas';
});
</script>
