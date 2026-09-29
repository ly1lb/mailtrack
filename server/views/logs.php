<?php $title = 'Žurnalai – MailTrack Pro'; ?>
<h1>Žurnalai (klaidų diagnostika)</h1>
<form method="get" action="<?= e(base_url('logs')) ?>" class="filters">
  <select name="file" style="width:auto"><?php foreach ($files as $f): ?><option <?= $f === $file ? 'selected' : '' ?>><?= e($f) ?></option><?php endforeach; ?></select>
  <select name="level" style="width:auto">
    <option value="">Visi lygiai</option>
    <?php foreach (['ERROR', 'WARNING', 'INFO', 'DEBUG'] as $lv): ?><option <?= $level === $lv ? 'selected' : '' ?>><?= $lv ?></option><?php endforeach; ?>
  </select>
  <input type="text" name="s" value="<?= e($search) ?>" placeholder="Paieška (pvz. req:ab12cd arba uid)" style="width:260px">
  <button class="btn">Rodyti</button>
  <?php if ($file): ?>
    <a class="btn" href="<?= e(base_url('logs/download') . '?file=' . urlencode($file)) ?>">Atsisiųsti</a>
  <?php endif; ?>
</form>
<?php if ($file): ?>
<form method="post" action="<?= e(base_url('logs/clear') . '?file=' . urlencode($file)) ?>" onsubmit="return confirm('Ištrinti šį žurnalą?')" style="margin-bottom:10px"><?= csrf_field() ?><button class="btn sm danger">Ištrinti šį žurnalą</button></form>
<?php endif; ?>
<p class="help">Rodoma iki 1000 naujausių eilučių (naujausios viršuje). Laikas – UTC. Kiekviena užklausa turi <code>req:ID</code> – klaidos puslapyje rodomas tas pats ID.
Žurnalo lygis nustatomas <code>config.php</code> → <code>log_level</code> (<code>debug</code> – daugiausiai informacijos).</p>
<div class="log">
  <?php if (!$lines): ?><div>Įrašų nėra.</div><?php endif; ?>
  <?php foreach ($lines as $ln): preg_match('/\[(ERROR|WARNING|INFO|DEBUG)\]/', $ln, $mm); ?>
    <div class="<?= e($mm[1] ?? '') ?>"><?= e($ln) ?></div>
  <?php endforeach; ?>
</div>
