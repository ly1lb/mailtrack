<?php $title = 'Naujas sekamas laiškas – MailTrack Pro'; ?>
<h1>Naujas sekamas laiškas (rankiniu būdu)</h1>
<p class="help">Naudokite, kai neturite plėtinio (pvz., kitas kompiuteris, Outlook, kitas pašto klientas). Telefone patogiau naudoti <a href="<?= e(base_url('setup')) ?>#mobile">Gmail priedą</a>.</p>

<?php if ($created): ?>
<div class="card">
  <h3 style="margin-top:0">✅ Sukurta. Įdėkite į laišką:</h3>
  <p><b>1 būdas (Gmail naršyklėje):</b> paspauskite „Kopijuoti pikselį“ ir įklijuokite (Ctrl+V) laiško gale.</p>
  <p>
    <button class="btn primary" data-copy-html="<?= e(pixel_html($created['uid'])) ?>">Kopijuoti pikselį</button>
    <span class="help">Nematomas 1×1 paveikslėlis</span>
  </p>
  <p><b>2 būdas (HTML parašas / kiti klientai):</b></p>
  <div class="copy-box"><input type="text" readonly value="<?= e(pixel_html($created['uid'])) ?>"><button class="btn sm" data-copy>Kopijuoti HTML</button></div>
  <?php if (!empty($created['tracked_links'])): ?>
    <h3>Sekamos nuorodos</h3>
    <?php foreach ($created['tracked_links'] as $l): ?>
      <div class="help"><?= e($l['url']) ?></div>
      <div class="copy-box" style="margin-bottom:8px"><input type="text" readonly value="<?= e($l['tracked']) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div>
    <?php endforeach; ?>
  <?php endif; ?>
  <p><a href="<?= e(base_url('email/' . $created['id'])) ?>">Atidaryti laiško statistiką →</a></p>
</div>
<?php endif; ?>

<div class="card">
  <form method="post" action="<?= e(base_url('new')) ?>">
    <?= csrf_field() ?>
    <label>Tema</label>
    <input type="text" name="subject" required>
    <label>Gavėjai</label>
    <input type="text" name="recipients" placeholder="vardas@imone.lt, kitas@imone.lt">
    <label>Nuorodos, kurias sekti (po vieną eilutėje)</label>
    <textarea name="links" placeholder="https://jusu-svetaine.lt/pasiulymas"></textarea>
    <label>Priminimas, jei neatidarytas</label>
    <select name="reminder_days"><option value="0">Nėra</option><option value="1">Po 1 d.</option><option value="3">Po 3 d.</option><option value="7">Po 7 d.</option></select>
    <p><button class="btn primary">Sukurti sekimą</button></p>
  </form>
</div>
