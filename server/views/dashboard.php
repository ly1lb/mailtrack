<?php
$title = 'Laiškai – MailTrack Pro';
$sent = (int)($stats['sent'] ?? 0);
$openedN = (int)($stats['opened'] ?? 0);
$clickedN = (int)($stats['clicked'] ?? 0);
$openRate = $sent ? round(100 * $openedN / $sent) : 0;
$clickRate = $sent ? round(100 * $clickedN / $sent) : 0;
$chips = ['all' => 'Visi', 'opened' => 'Atidaryti', 'unopened' => 'Neatidaryti', 'clicked' => 'Su paspaudimais', 'reminders' => 'Priminimai', 'archived' => 'Archyvas'];
$maxDay = max(1, max($daily));
$icons = ['open' => '👁', 'click' => '🔗', 'doc' => '📄', 'reminder' => '⏰'];
$verbs = ['open' => 'atidarė laišką', 'click' => 'paspaudė nuorodą', 'doc' => 'peržiūrėjo dokumentą', 'reminder' => 'priminimas'];

// Žiedinė diagrama (gauge): procentas viename hue prieš neutralų taką.
function donut(int $pct, string $var, string $centerTop, string $centerSub): string
{
    $pct = max(0, min(100, $pct));
    $r = 52; $c = 2 * M_PI * $r; $off = $c * (1 - $pct / 100);
    ob_start(); ?>
    <div class="donut">
      <svg viewBox="0 0 128 128" role="img" aria-label="<?= e($centerSub . ': ' . $pct . '%') ?>">
        <circle class="donut-track" cx="64" cy="64" r="<?= $r ?>"></circle>
        <circle class="donut-val" cx="64" cy="64" r="<?= $r ?>"
          style="stroke:var(<?= e($var) ?>);stroke-dasharray:<?= round($c, 1) ?>;stroke-dashoffset:<?= round($off, 1) ?>"></circle>
        <text class="donut-num" x="64" y="60"><?= $pct ?>%</text>
        <text class="donut-cap" x="64" y="80"><?= e($centerTop) ?></text>
      </svg>
      <div class="donut-label"><?= e($centerSub) ?></div>
    </div>
    <?php return ob_get_clean();
}
?>
<div class="grid g4">
  <div class="tile"><div class="lbl">Išsiųsta (30 d.)</div><div class="num"><?= $sent ?></div></div>
  <div class="tile"><div class="lbl">Atidaryta laiškų</div><div class="num"><?= $openedN ?></div><div class="sub">iš <?= $sent ?> išsiųstų</div></div>
  <div class="tile"><div class="lbl">Su paspaudimais</div><div class="num"><?= $clickedN ?></div><div class="sub"><?= $clickRate ?>% laiškų</div></div>
  <div class="tile"><div class="lbl">Atidarymai šiandien</div><div class="num"><?= $opensToday ?></div></div>
</div>

<div class="dash-main">
  <!-- Mano rezultatai -->
  <section class="card perf">
    <h3>Mano rezultatai <span class="muted-note">(30 d.)</span></h3>
    <div class="donuts">
      <?= donut($openRate, '--good', $openedN . '/' . $sent, 'Atidarymo rodiklis') ?>
      <?= donut($clickRate, '--accent', $clickedN . '/' . $sent, 'Paspaudimų rodiklis') ?>
    </div>
    <div class="perf-links">
      <a class="btn sm" href="<?= e(base_url('clicks')) ?>">Nuorodų statistika →</a>
      <a class="btn sm" href="<?= e(base_url('export.csv')) ?>">Eksportuoti CSV</a>
    </div>
  </section>

  <!-- Naujausia veikla -->
  <section class="card activity">
    <h3>Naujausia veikla <span class="badge live" id="live-badge">tiesiogiai</span></h3>
    <ul class="feed" id="feed">
      <?php if (!$recent): ?>
        <li class="feed-empty"><div class="mid"><span class="w">Kol kas veiklos nėra. Išsiųskite sekamą laišką ir čia matysite atidarymus realiu laiku.</span></div></li>
      <?php endif; ?>
      <?php foreach ($recent as $n):
        $recips = json_decode((string)($n['e_recipients'] ?? ''), true);
        $who = is_array($recips) && $recips ? (string)$recips[0] : '';
        $whoName = $who !== '' ? pretty_name($who) : 'Gavėjas';
        $ini = avatar_initial($whoName);
        $hue = avatar_hue($who !== '' ? $who : $n['title']);
        $subj = subject_after($n['title']);
        $verb = $verbs[$n['type']] ?? 'veiksmas';
        $isOld = str_contains($n['title'], 'senas laiškas');
        // pakartotinių atidarymų skaičius iš antraštės „(N k.)"
        $times = '';
        if ($n['type'] === 'open' && preg_match('/\((\d+)\s*k\.\)/u', $n['title'], $mm)) $times = $mm[1];
        $href = $n['email_id'] ? base_url('email/' . $n['email_id']) : base_url('documents');
      ?>
        <li>
          <span class="avatar h<?= $hue ?>" title="<?= e($who) ?>"><?= e($ini) ?></span>
          <div class="mid">
            <a class="line" href="<?= e($href) ?>">
              <b class="who"><?= e($whoName) ?></b>
              <span class="verb"><?= e($verb) ?></span>
              <?php if ($subj !== ''): ?><span class="subj">„<?= e($subj) ?>"</span><?php endif; ?>
            </a>
            <div class="meta">
              <span class="ic-type" title="<?= e($n['type']) ?>"><?= $icons[$n['type']] ?? '✉️' ?></span>
              <span class="w"><?= e(ago($n['created_at'])) ?></span>
              <?php if ($times !== '' && (int)$times > 1): ?><span class="badge times"><?= (int)$times ?> k.</span><?php endif; ?>
              <?php if ($isOld): ?><span class="badge old">senas laiškas</span><?php endif; ?>
              <?php
                $b1 = trim(explode("\n", (string)$n['body'])[0] ?? '');
                if ($b1 !== '' && stripos($b1, 'Gavėjas') !== 0): ?>
                <span class="where"><?= e($b1) ?></span>
              <?php endif; ?>
            </div>
          </div>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>
</div>

<!-- Atidarymai per 14 dienų -->
<section class="card chart-card">
  <h3>Atidarymai per 14 dienų</h3>
  <?php $w = 900; $h = 170; $pad = 24; $n = count($daily); $bw = ($w - 10) / $n; ?>
  <svg class="chart" viewBox="0 0 <?= $w ?> <?= $h ?>" preserveAspectRatio="none" role="img" aria-label="Atidarymų skaičius per dieną">
    <line class="gl" x1="0" x2="<?= $w ?>" y1="<?= $h - $pad ?>" y2="<?= $h - $pad ?>"/>
    <?php $i = 0; foreach ($daily as $day => $cnt):
      $bh = $cnt ? max(3, ($h - $pad - 16) * $cnt / $maxDay) : 0;
      $x = 5 + $i * $bw + 3; $y = $h - $pad - $bh; ?>
      <g>
        <title><?= e($day) ?>: <?= $cnt ?> atid.</title>
        <rect x="<?= $x - 3 ?>" y="0" width="<?= $bw ?>" height="<?= $h - $pad ?>" fill="transparent"/>
        <?php if ($bh): ?><path class="bar" d="M<?= $x ?>,<?= $h - $pad ?> V<?= $y + 4 ?> Q<?= $x ?>,<?= $y ?> <?= $x + 4 ?>,<?= $y ?> H<?= $x + $bw - 10 ?> Q<?= $x + $bw - 6 ?>,<?= $y ?> <?= $x + $bw - 6 ?>,<?= $y + 4 ?> V<?= $h - $pad ?> Z"/><?php endif; ?>
        <?php if ($cnt && $cnt === $maxDay): ?><text class="axis val" x="<?= $x + ($bw - 6) / 2 ?>" y="<?= $y - 4 ?>" text-anchor="middle"><?= $cnt ?></text><?php endif; ?>
        <?php if ($i % 2 === 0 || $i === $n - 1): ?><text class="axis" x="<?= $x + ($bw - 6) / 2 ?>" y="<?= $h - 7 ?>" text-anchor="middle"><?= e(substr($day, 5)) ?></text><?php endif; ?>
      </g>
    <?php $i++; endforeach; ?>
  </svg>
</section>

<div class="section-head">
  <h2>Sekami laiškai</h2>
</div>
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
