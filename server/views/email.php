<?php
$title = ($email['subject'] ?: 'Laiškas') . ' – MailTrack Pro';
$eid = (int)$email['id'];
$opened = (int)$email['open_count'] > 0;
?>
<p><a href="<?= e(base_url('')) ?>">← Visi laiškai</a></p>
<h1><span class="status <?= $opened ? 's1' : 's0' ?>"><?= $opened ? '✓✓' : '✓' ?></span> <?= e($email['subject'] ?: '(be temos)') ?></h1>

<div class="grid g4">
  <div class="tile"><div class="lbl">Atidarymai</div><div class="num"><?= (int)$email['open_count'] ?></div></div>
  <div class="tile"><div class="lbl">Pirmas atidarymas</div><div class="num" style="font-size:16px"><?= e(fmt_dt($email['first_open_at'])) ?></div><div class="sub"><?= e(ago($email['first_open_at'])) ?></div></div>
  <div class="tile"><div class="lbl">Paskutinis atidarymas</div><div class="num" style="font-size:16px"><?= e(fmt_dt($email['last_open_at'])) ?></div><div class="sub"><?= e(ago($email['last_open_at'])) ?></div></div>
  <div class="tile"><div class="lbl">Nuorodų paspaudimai</div><div class="num"><?= (int)$email['click_count'] ?></div></div>
</div>

<div class="grid g2" style="margin-top:12px">
  <div class="card" style="margin:0">
    <table>
      <tr><th style="width:130px">Gavėjai</th><td><?= e(recipients_text($email['recipients']) ?: '—') ?></td></tr>
      <tr><th>Išsiųsta</th><td><?= e(fmt_dt($email['created_at'], 'Y-m-d H:i:s')) ?></td></tr>
      <tr><th>Šaltinis</th><td><?= e($email['source']) ?></td></tr>
      <tr><th>Sekimo ID</th><td class="mono"><?= e($email['uid']) ?></td></tr>
      <tr><th>Pikselis</th><td><div class="copy-box"><input type="text" readonly value="<?= e(pixel_url($email['uid'])) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div></td></tr>
    </table>
    <form method="post" action="<?= e(base_url("email/$eid/note")) ?>">
      <?= csrf_field() ?>
      <label>Tema</label><input type="text" name="subject" value="<?= e($email['subject']) ?>">
      <label>Pastaba</label><input type="text" name="note" value="<?= e($email['note']) ?>" placeholder="pvz. pasiūlymas klientui X">
      <p><button class="btn">Išsaugoti</button></p>
    </form>
  </div>
  <div class="card" style="margin:0">
    <h3 style="margin-top:0">⏰ Priminimas</h3>
    <?php if ($email['reminder_at']): ?>
      <p><?= $email['reminder_sent'] ? '<span class="badge">Įvykdytas</span>' : '<span class="badge warn">Laukia</span>' ?> <?= e(fmt_dt($email['reminder_at'])) ?>
        (<?= e(['no_open' => 'jei neatidarytas', 'no_click' => 'jei nepaspausta nuoroda', 'always' => 'visada'][$email['reminder_mode']] ?? '') ?>)</p>
    <?php endif; ?>
    <form method="post" action="<?= e(base_url("email/$eid/reminder")) ?>">
      <?= csrf_field() ?>
      <div class="grid g2">
        <div><label>Po kiek dienų</label>
          <select name="days"><option value="0">Be priminimo</option><option value="0.0417">Po 1 val.</option><option value="1">Po 1 d.</option><option value="2">Po 2 d.</option><option value="3" selected>Po 3 d.</option><option value="7">Po 7 d.</option><option value="14">Po 14 d.</option></select></div>
        <div><label>Sąlyga</label>
          <select name="mode"><option value="no_open">Jei neatidarytas</option><option value="no_click">Jei nepaspausta nuoroda</option><option value="always">Visada</option></select></div>
      </div>
      <p><button class="btn">Nustatyti</button></p>
    </form>
    <hr style="border:0;border-top:1px solid var(--border)">
    <form method="post" action="<?= e(base_url("email/$eid/archive")) ?>" class="inline"><?= csrf_field() ?><button class="btn"><?= $email['archived'] ? 'Grąžinti iš archyvo' : 'Archyvuoti' ?></button></form>
    <form method="post" action="<?= e(base_url("email/$eid/delete")) ?>" class="inline" onsubmit="return confirm('Ištrinti laišką ir visą jo istoriją?')"><?= csrf_field() ?><button class="btn danger">Ištrinti</button></form>
  </div>
</div>

<h2>Atidarymų istorija</h2>
<p class="help">Perbraukti įrašai neįskaičiuoti (jūsų pačių peržiūros, botai, dublikatai). Paspauskite „Įskaičiuoti/Ignoruoti“, jei norite pataisyti rankiniu būdu.
Gmail gavėjų atidarymai eina per Google Image Proxy – todėl tikslios vietos ir įrenginio Gmail neatskleidžia (taip pat ir Mailtrack).</p>
<div class="tbl-wrap">
<table>
  <thead><tr><th>Laikas</th><th>Klientas</th><th class="hide-sm">Įrenginys</th><th>Vieta</th><th class="hide-sm">IP</th><th></th></tr></thead>
  <tbody>
  <?php if (!$opens): ?><tr><td colspan="6" style="color:var(--muted)">Dar neatidarytas.</td></tr><?php endif; ?>
  <?php foreach ($opens as $o): ?>
    <tr class="<?= $o['ignored'] ? 'ignored' : '' ?>" title="<?= e($o['user_agent']) ?>">
      <td><?= e(fmt_dt($o['opened_at'], 'Y-m-d H:i:s')) ?></td>
      <td><?= e($o['client']) ?><?php if ($o['proxy']): ?><div class="recip"><?= e($o['proxy']) ?></div><?php endif; ?></td>
      <td class="hide-sm"><?= e(trim($o['device'] . ' ' . $o['os'])) ?></td>
      <td><?= e(trim($o['city'] . ($o['city'] && $o['country'] ? ', ' : '') . $o['country']) ?: '—') ?></td>
      <td class="hide-sm mono"><?= e($o['ip']) ?></td>
      <td>
        <?php if ($o['ignored']): ?><span class="badge"><?= e($o['ignore_reason']) ?></span><?php endif; ?>
        <form method="post" action="<?= e(base_url("email/$eid/toggle-open")) ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="open_id" value="<?= (int)$o['id'] ?>"><button class="btn sm"><?= $o['ignored'] ? 'Įskaičiuoti' : 'Ignoruoti' ?></button></form>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>

<h2>Nuorodos</h2>
<div class="tbl-wrap">
<table>
  <thead><tr><th>#</th><th>URL</th><th class="num">Paspaudimai</th></tr></thead>
  <tbody>
  <?php if (!$links): ?><tr><td colspan="3" style="color:var(--muted)">Sekamų nuorodų nėra.</td></tr><?php endif; ?>
  <?php foreach ($links as $l): ?>
    <tr><td><?= (int)$l['idx'] + 1 ?></td><td style="word-break:break-all"><a href="<?= e($l['url']) ?>" target="_blank" rel="noopener noreferrer"><?= e($l['url']) ?></a></td><td class="num"><?= (int)$l['click_count'] ?></td></tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>

<?php if ($clicks): ?>
<h2>Paspaudimų istorija</h2>
<div class="tbl-wrap">
<table>
  <thead><tr><th>Laikas</th><th>URL</th><th class="hide-sm">Įrenginys</th><th>Vieta</th><th class="hide-sm">IP</th></tr></thead>
  <tbody>
  <?php foreach ($clicks as $c): ?>
    <tr class="<?= $c['ignored'] ? 'ignored' : '' ?>" title="<?= e($c['user_agent']) ?>">
      <td><?= e(fmt_dt($c['clicked_at'], 'Y-m-d H:i:s')) ?><?php if ($c['ignored']): ?><div><span class="badge"><?= e($c['ignore_reason']) ?></span></div><?php endif; ?></td>
      <td style="word-break:break-all"><?= e($c['url']) ?></td>
      <td class="hide-sm"><?= e(trim($c['device'] . ' ' . $c['os'] . ' ' . $c['client'])) ?></td>
      <td><?= e(trim($c['city'] . ($c['city'] && $c['country'] ? ', ' : '') . $c['country']) ?: '—') ?></td>
      <td class="hide-sm mono"><?= e($c['ip']) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<?php endif; ?>
