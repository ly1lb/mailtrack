<?php $title = 'Nuorodų paspaudimai – MailTrack Pro'; ?>
<h1>Nuorodų paspaudimai</h1>
<p class="help">Visi sekamų nuorodų paspaudimai. Perbraukti įrašai neįskaičiuoti (jūsų pačių IP, botai, dublikatai) – juos matote, kad būtų aišku, kas vyksta.
<b>Testuodami patys</b> paspauskite nuorodą iš kito įrenginio arba mobiliojo interneto – kitaip paspaudimas bus atmestas kaip „Jūsų IP adresas“.</p>

<div class="filters">
  <div class="chips">
    <a href="<?= e(base_url('clicks')) ?>" class="<?= $showAll ? '' : 'on' ?>">Tik įskaičiuoti</a>
    <a href="<?= e(base_url('clicks?all=1')) ?>" class="<?= $showAll ? 'on' : '' ?>">Visi (su atmestais)</a>
  </div>
</div>

<?php if ($topLinks): ?>
<div class="card">
  <h3 style="margin-top:0">Populiariausios nuorodos</h3>
  <?php $max = max(array_map(fn($l) => (int)$l['cnt'], $topLinks)); ?>
  <table class="toplinks">
    <?php foreach ($topLinks as $l): ?>
      <tr>
        <td style="word-break:break-all"><a href="<?= e($l['url']) ?>" target="_blank" rel="noopener noreferrer"><?= e($l['url']) ?></a></td>
        <td style="width:45%">
          <div style="background:var(--surface-2);border-radius:4px;height:16px;overflow:hidden">
            <div style="background:var(--bar);height:16px;border-radius:4px;width:<?= $max ? round(100 * (int)$l['cnt'] / $max) : 0 ?>%"></div>
          </div>
        </td>
        <td class="num" style="width:70px"><?= (int)$l['cnt'] ?></td>
      </tr>
    <?php endforeach; ?>
  </table>
</div>
<?php endif; ?>

<h2>Istorija (<?= (int)$total ?>)</h2>
<div class="tbl-wrap">
<table class="cards">
  <thead><tr><th>Laikas</th><th>Laiškas</th><th>Nuoroda</th><th class="hide-sm">Įrenginys</th><th>Vieta</th><th></th></tr></thead>
  <tbody>
  <?php if (!$clicks): ?>
    <tr><td colspan="6" class="empty-state">
      Paspaudimų nėra.<br><span class="help">Nuorodos perrašomos automatiškai, kai rašote laišką su plėtiniu (turi būti įjungtas „✓✓ Sekama“ ir nustatymuose – nuorodų sekimas).</span>
    </td></tr>
  <?php endif; ?>
  <?php foreach ($clicks as $c): ?>
    <tr class="<?= $c['ignored'] ? 'ignored' : '' ?>">
      <td data-l="Laikas"><?= e(fmt_dt($c['clicked_at'], 'Y-m-d H:i:s')) ?></td>
      <td><a href="<?= e(base_url('email/' . $c['eid'])) ?>"><?= e($c['subject'] !== '' ? $c['subject'] : '(be temos)') ?></a>
        <div class="recip"><?= e(recipients_text($c['recipients'])) ?></div></td>
      <td data-l="Nuoroda" style="word-break:break-all;max-width:320px"><?= e($c['url']) ?></td>
      <td class="hide-sm"><?= e(trim($c['device'] . ' ' . $c['os'] . ' ' . $c['client'])) ?></td>
      <td data-l="Vieta"><?= e(trim($c['city'] . ($c['city'] && $c['country'] ? ', ' : '') . $c['country']) ?: '—') ?></td>
      <td><?php if ($c['ignored']): ?><span class="badge"><?= e($c['ignore_reason']) ?></span><?php endif; ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<?php if ($total > $per): ?>
<div class="pager">
  <?php if ($page > 1): ?><a class="btn" href="?<?= $showAll ? 'all=1&' : '' ?>p=<?= $page - 1 ?>">← Ankstesni</a><?php endif; ?>
  <span class="badge"><?= $page ?> / <?= (int)ceil($total / $per) ?></span>
  <?php if ($page * $per < $total): ?><a class="btn" href="?<?= $showAll ? 'all=1&' : '' ?>p=<?= $page + 1 ?>">Kiti →</a><?php endif; ?>
</div>
<?php endif; ?>
