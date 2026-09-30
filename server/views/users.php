<?php $title = 'Vartotojai – MailTrack Pro'; ?>
<h1>Vartotojai</h1>
<div class="tbl-wrap">
<table class="cards">
  <thead><tr><th>El. paštas</th><th>Vardas</th><th>Rolė</th><th class="num">Laiškai</th><th class="hide-sm">Paskutinis prisijungimas</th><th></th></tr></thead>
  <?php foreach ($users as $x): ?>
    <tr><td><?= e($x['email']) ?></td><td><?= e($x['name']) ?></td><td><?= e($x['role']) ?></td><td class="num"><?= (int)$x['emails'] ?></td><td class="hide-sm"><?= e(fmt_dt($x['last_login_at'])) ?></td>
      <td><?php if ((int)$x['id'] !== (int)$GLOBALS['USER']['id']): ?>
        <form method="post" action="<?= e(base_url('users')) ?>" class="inline" onsubmit="return confirm('Ištrinti vartotoją?')"><?= csrf_field() ?><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="<?= (int)$x['id'] ?>"><button class="btn sm danger">Trinti</button></form>
      <?php endif; ?></td></tr>
  <?php endforeach; ?>
</table>
</div>
<div class="card" style="margin-top:16px">
  <h3 style="margin-top:0">Naujas vartotojas</h3>
  <form method="post" action="<?= e(base_url('users')) ?>">
    <?= csrf_field() ?><input type="hidden" name="action" value="create">
    <div class="grid g2">
      <div><label>El. paštas</label><input type="email" name="email" required></div>
      <div><label>Vardas</label><input type="text" name="name"></div>
      <div><label>Slaptažodis</label><input type="password" name="password" required minlength="8" autocomplete="new-password"></div>
      <div><label>Rolė</label><select name="role"><option value="user">Vartotojas</option><option value="admin">Administratorius</option></select></div>
    </div>
    <p><button class="btn primary">Sukurti</button></p>
  </form>
</div>
