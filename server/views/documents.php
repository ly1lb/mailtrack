<?php $title = 'Dokumentai – MailTrack Pro'; ?>
<h1>Sekami dokumentai (PDF ir kt.)</h1>
<p class="help">Įkelkite failą ir vietoje prisegtuko laiške įdėkite sekamą nuorodą. Gausite pranešimą kiekvieną kartą, kai gavėjas atidaro dokumentą (su įrenginiu ir vieta – čia Gmail proxy netrukdo).</p>

<div class="card">
  <form method="post" action="<?= e(base_url('documents')) ?>" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <div class="grid g2">
      <div><label>Failas (iki <?= (int)cfg('max_upload_mb', 20) ?> MB)</label><input type="file" name="file" required></div>
      <div><label>Pavadinimas (neprivaloma)</label><input type="text" name="title" placeholder="pvz. Komercinis pasiūlymas 2026"></div>
    </div>
    <p><button class="btn primary">Įkelti</button></p>
  </form>
</div>

<div class="tbl-wrap">
<table>
  <thead><tr><th>Dokumentas</th><th>Sekama nuoroda</th><th class="num">Peržiūros</th><th class="hide-sm">Paskutinė</th><th></th></tr></thead>
  <tbody>
  <?php if (!$docs): ?><tr><td colspan="5" style="color:var(--muted)">Dokumentų nėra.</td></tr><?php endif; ?>
  <?php foreach ($docs as $d): ?>
    <tr>
      <td><b><?= e($d['title'] ?: $d['filename']) ?></b><div class="recip"><?= e($d['filename']) ?> · <?= round($d['size'] / 1024) ?> KB</div>
        <?php foreach (array_slice($views[$d['id']] ?? [], 0, 5) as $v): ?>
          <div class="recip">👁 <?= e(fmt_dt($v['viewed_at'])) ?> · <?= e(trim($v['device'] . ' ' . $v['os'])) ?> · <?= e(trim($v['city'] . ' ' . $v['country'])) ?></div>
        <?php endforeach; ?>
      </td>
      <td style="min-width:260px"><div class="copy-box"><input type="text" readonly value="<?= e(base_url('d/' . $d['uid'])) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div></td>
      <td class="num"><?= (int)$d['view_count'] ?></td>
      <td class="hide-sm"><?= e(ago($d['last_view_at'])) ?></td>
      <td><form method="post" action="<?= e(base_url('documents/' . $d['id'] . '/delete')) ?>" class="inline" onsubmit="return confirm('Ištrinti?')"><?= csrf_field() ?><button class="btn sm danger">Trinti</button></form></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
