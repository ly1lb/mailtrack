<?php
$title = 'Laiškai – MailTrack Pro';
$sent = (int)($stats['sent'] ?? 0);
$openRate = $sent ? round(100 * (int)$stats['opened'] / $sent) : 0;
$clickRate = $sent ? round(100 * (int)$stats['clicked'] / $sent) : 0;
$chips = ['all' => 'Visi', 'opened' => 'Atidaryti', 'unopened' => 'Neatidaryti', 'clicked' => 'Su paspaudimais', 'reminders' => 'Priminimai', 'archived' => 'Archyvas'];
$maxDay = max(1, max($daily));
$icons = ['open' => '👁', 'click' => '🔗', 'doc' => '📄', 'reminder' => '⏰'];
?>
<div class="grid g4">
  <div class="tile"><div class="lbl">Išsiųsta (30 d.)</div><div class="num"><?= $sent ?></div></div>
  <div class="tile"><div class="lbl">Atidarymo rodiklis</div><div class="num"><?= $openRate ?>%</div><div class="sub"><?= (int)$stats['opened'] ?> iš <?= $sent ?></div></div>
  <div class="tile"><div class="lbl">Paspaudimų rodiklis</div><div class="num"><?= $clickRate ?>%</div><div class="sub"><?= (int)$stats['clicked'] ?> laiškai</div></div>
  <div class="tile"><div class="lbl">Atidarymai šiandien</div><div class="num"><?= $opensToday ?></div></div>
</div>

<div class="grid g2" style="margin-top:12px">
  <div class="card" style="margin:0">
    <h3>Atidarymai per 14 dienų</h3>
    <?php $w = 560; $h = 150; $pad = 22; $n = count($daily); $bw = ($w - 10) / $n; ?>
    <svg class="chart" viewBox="0 0 <?= $w ?> <?= $h ?>" preserveAspectRatio="none" role="img" aria-label="Atidarymų skaičius per dieną">
      <line class="gl" x1="0" x2="<?= $w ?>" y1="<?= $h - $pad ?>" y2="<?= $h - $pad ?>"/>
      <?php $i = 0; foreach ($daily as $day => $cnt):
        $bh = $cnt ? max(3, ($h - $pad - 14) * $cnt / $maxDay) : 0;
        $x = 5 + $i * $bw + 2; $y = $h - $pad - $bh; ?>
        <g>
          <title><?= e($day) ?>: <?= $cnt ?> atid.</title>
          <rect x="<?= $x - 2 ?>" y="0" width="<?= $bw ?>" height="<?= $h - $pad ?>" fill="transparent"/>
          <?php if ($bh): ?><path class="bar" d="M<?= $x ?>,<?= $h - $pad ?> V<?= $y + 4 ?> Q<?= $x ?>,<?= $y ?> <?= $x + 4 ?>,<?= $y ?> H<?= $x + $bw - 8 ?> Q<?= $x + $bw - 4 ?>,<?= $y ?> <?= $x + $bw - 4 ?>,<?= $y + 4 ?> V<?= $h - $pad ?> Z"/><?php endif; ?>
          <?php if ($cnt && $cnt === $maxDay): ?><text class="axis" x="<?= $x + ($bw - 4) / 2 ?>" y="<?= $y - 3 ?>" text-anchor="middle"><?= $cnt ?></text><?php endif; ?>
          <?php if ($i % 3 === 0 || $i === $n - 1): ?><text class="axis" x="<?= $x + ($bw - 4) / 2 ?>" y="<?= $h - 6 ?>" text-anchor="middle"><?= e(substr($day, 5)) ?></text><?php endif; ?>
        </g>
      <?php $i++; endforeach; ?>
    </svg>
  </div>
  <div class="card" style="margin:0">
    <h3>Naujausia veikla <span class="badge" id="live-badge">tiesiogiai</span></h3>
    <ul class="feed" id="feed">
      <?php if (!$recent): ?><li><div class="mid"><span class="w">Kol kas veiklos nėra.</span></div></li><?php endif; ?>
      <?php foreach ($recent as $n): ?>
        <li>
          <div class="ic"><?= $icons[$n['type']] ?? '✉️' ?></div>
          <div class="mid">
            <a class="t" href="<?= e($n['email_id'] ? base_url('email/' . $n['email_id']) : base_url('documents')) ?>"><?= e(strip_lead_emoji($n['title'])) ?></a>
            <div class="b"><?= e($n['body']) ?></div>
            <div class="w"><?= e(ago($n['created_at'])) ?></div>
          </div>
        </li>
      <?php endforeach; ?>
    </ul>
    <p class="help" style="margin-top:10px">Čia matomi ir atidarymai 👁, ir nuorodų paspaudimai 🔗. Visą paspaudimų istoriją rasite skiltyje <a href="<?= e(base_url('clicks')) ?>">Nuorodos</a>.</p>
  </div>
</div>

<h2>Sekami laiškai</h2>
<div class="filters">
  <div class="chips">
    <?php foreach ($chips as $k => $label): ?>
      <a href="<?= e(base_url('') . '?f=' . $k . ($q !== '' ? '&q=' . urlencode($q) : '')) ?>" class="<?= $filter === $k ? 'on' : '' ?>"><?= e($label) ?></a>
    <?php endforeach; ?>
  </div>
  <form method="get" action="<?= e(base_url('')) ?>">
    <input type="hidden" name="f" value="<?= e($filter) ?>">
    <input type="text" name="q" value="<?= e($q) ?>" placeholder="Ieškoti temos ar gavėjo…">
    <button class="btn">Ieškoti</button>
    <a class="btn hide-sm" href="<?= e(base_url('export.csv')) ?>" title="Eksportuoti CSV">CSV</a>
  </form>
</div>

<div class="tbl-wrap">
<table class="cards">
  <thead><tr><th style="width:44px"></th><th>Tema / gavėjai</th><th class="hide-sm">Išsiųsta</th><th class="num">Atidarymai</th><th class="hide-sm">Paskutinis</th><th class="num">Paspaud.</th></tr></thead>
  <tbody>
  <?php if (!$emails): ?>
    <tr><td colspan="6" class="empty-state">Laiškų nėra.<br>Įdiekite <a href="<?= e(base_url('setup')) ?>">plėtinį ar Gmail priedą</a> arba sukurkite <a href="<?= e(base_url('new')) ?>">sekamą laišką rankiniu būdu</a>.</td></tr>
  <?php endif; ?>
  <?php foreach ($emails as $em): $opened = (int)$em['open_count'] > 0; ?>
    <tr>
      <td><span class="status <?= $opened ? 's1' : 's0' ?>" title="<?= $opened ? 'Atidarytas' : 'Išsiųstas, dar neatidarytas' ?>"><?= $opened ? '✓✓' : '✓' ?></span></td>
      <td>
        <a class="subject" href="<?= e(base_url('email/' . $em['id'])) ?>"><?= e($em['subject'] !== '' ? $em['subject'] : '(be temos)') ?></a>
        <?php if ($em['reminder_at'] && !$em['reminder_sent']): ?> <span class="badge warn">⏰ <?= e(fmt_dt($em['reminder_at'], 'm-d H:i')) ?></span><?php endif; ?>
        <div class="recip"><?= e(recipients_text($em['recipients']) ?: '—') ?></div>
      </td>
      <td class="hide-sm"><?= e(fmt_dt($em['created_at'])) ?></td>
      <td class="num" data-l="Atidarymai"><?= (int)$em['open_count'] ?></td>
      <td class="hide-sm"><?= e(ago($em['last_open_at'])) ?></td>
      <td class="num" data-l="Paspaudimai"><?= (int)$em['click_count'] ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<?php if ($total > $per): ?>
<div class="pager">
  <?php if ($page > 1): ?><a class="btn" href="?f=<?= e($filter) ?>&q=<?= urlencode($q) ?>&p=<?= $page - 1 ?>">← Ankstesni</a><?php endif; ?>
  <span class="badge"><?= $page ?> / <?= (int)ceil($total / $per) ?></span>
  <?php if ($page * $per < $total): ?><a class="btn" href="?f=<?= e($filter) ?>&q=<?= urlencode($q) ?>&p=<?= $page + 1 ?>">Kiti →</a><?php endif; ?>
</div>
<?php endif; ?>
