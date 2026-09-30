<?php $title = 'Šablonai – MailTrack Pro'; ?>
<h1>Laiškų šablonai</h1>
<p class="help">Šablonus įterpsite Gmail rašymo lange (plėtinio mygtukas „Šablonai“) arba telefone per Gmail priedą. HTML leidžiamas (pvz. <code>&lt;b&gt;</code>, <code>&lt;a href&gt;</code>). Kintamieji: <code>{{vardas}}</code> ir kt. įrašysite ranka prieš siųsdami.</p>

<div class="grid g2">
  <div class="card" style="margin:0">
    <h3 style="margin-top:0"><?= $edit ? 'Redaguoti šabloną' : 'Naujas šablonas' ?></h3>
    <form method="post" action="<?= e(base_url('templates')) ?>">
      <?= csrf_field() ?>
      <?php if ($edit): ?><input type="hidden" name="id" value="<?= (int)$edit['id'] ?>"><?php endif; ?>
      <label>Pavadinimas</label>
      <input type="text" name="name" required value="<?= e($edit['name'] ?? '') ?>" placeholder="pvz. Pasiūlymas fotosesijai">
      <label>Tema</label>
      <input type="text" name="subject" value="<?= e($edit['subject'] ?? '') ?>" placeholder="pvz. Fotosesijos pasiūlymas">
      <label>Turinys (HTML)</label>
      <textarea name="body_html" style="min-height:200px;font-family:ui-monospace,monospace;font-size:12.5px"><?= e($edit['body_html'] ?? '') ?></textarea>
      <p>
        <button class="btn primary"><?= $edit ? 'Išsaugoti' : 'Sukurti' ?></button>
        <?php if ($edit): ?><a class="btn" href="<?= e(base_url('templates')) ?>">Atšaukti</a><?php endif; ?>
      </p>
    </form>
  </div>
  <div class="card" style="margin:0">
    <h3 style="margin-top:0">Peržiūra</h3>
    <div id="preview" style="border:1px solid var(--border);border-radius:8px;padding:12px;min-height:120px;background:var(--surface)"></div>
    <p class="help">Peržiūra atnaujinama rašant turinį kairėje.</p>
  </div>
</div>

<h2>Jūsų šablonai (<?= count($templates) ?>)</h2>
<div class="tbl-wrap">
<table class="cards">
  <thead><tr><th>Pavadinimas</th><th>Tema</th><th class="num hide-sm">Panaudota</th><th></th></tr></thead>
  <tbody>
  <?php if (!$templates): ?><tr><td colspan="4" class="empty-state">Šablonų dar nėra.</td></tr><?php endif; ?>
  <?php foreach ($templates as $t): ?>
    <tr>
      <td><b><?= e($t['name']) ?></b></td>
      <td class="recip"><?= e($t['subject'] ?: '—') ?></td>
      <td class="num hide-sm"><?= (int)$t['use_count'] ?></td>
      <td>
        <a class="btn sm" href="<?= e(base_url('templates?edit=' . $t['id'])) ?>">Redaguoti</a>
        <form method="post" action="<?= e(base_url('templates/' . $t['id'] . '/delete')) ?>" class="inline" onsubmit="return confirm('Ištrinti šabloną?')"><?= csrf_field() ?><button class="btn sm danger">Trinti</button></form>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<script>
(function(){
  var ta = document.querySelector('textarea[name="body_html"]');
  var pv = document.getElementById('preview');
  function upd(){ if(pv) pv.innerHTML = ta ? ta.value : ''; }
  if(ta){ ta.addEventListener('input', upd); upd(); }
})();
</script>
