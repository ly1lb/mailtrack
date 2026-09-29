<!doctype html>
<html lang="lt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Prisijungimas – MailTrack Pro</title>
<link rel="stylesheet" href="<?= e(base_url('assets/app.css')) ?>?v=<?= APP_VERSION ?>">
<link rel="manifest" href="<?= e(base_url('assets/manifest.webmanifest')) ?>">
<link rel="icon" href="<?= e(base_url('assets/icon.svg')) ?>" type="image/svg+xml">
</head>
<body>
<div class="login wrap">
  <h1><span style="color:var(--good)">✓✓</span> MailTrack Pro</h1>
  <div class="card">
    <?php if ($error): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" action="<?= e(base_url('login')) ?>">
      <?= csrf_field() ?>
      <label for="email">El. paštas</label>
      <input type="email" id="email" name="email" required autofocus autocomplete="username">
      <label for="password">Slaptažodis</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <p><button class="btn primary" style="width:100%;justify-content:center">Prisijungti</button></p>
    </form>
  </div>
</div>
</body>
</html>
