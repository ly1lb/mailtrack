<?php
$u = $GLOBALS['USER'] ?? null;
$cur = $GLOBALS['path'] ?? '';
$nav = [
    '' => 'Laiškai',
    'new' => 'Naujas',
    'templates' => 'Šablonai',
    'documents' => 'Dokumentai',
    'setup' => 'Įdiegimas',
    'settings' => 'Nustatymai',
];
if ($u && $u['role'] === 'admin') {
    $nav += ['users' => 'Vartotojai', 'logs' => 'Žurnalai', 'diagnostics' => 'Diagnostika'];
}
?><!doctype html>
<html lang="lt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#2a78d6">
<title><?= e($title ?? 'MailTrack Pro') ?></title>
<link rel="stylesheet" href="<?= e(base_url('assets/app.css')) ?>?v=<?= APP_VERSION ?>">
<link rel="manifest" href="<?= e(base_url('assets/manifest.webmanifest')) ?>">
<link rel="icon" href="<?= e(base_url('assets/icon.svg')) ?>" type="image/svg+xml">
<link rel="apple-touch-icon" href="<?= e(base_url('assets/icon-192.png')) ?>">
</head>
<body data-base="<?= e(rtrim((string)cfg('base_url'), '/')) ?>" data-csrf="<?= e(csrf_token()) ?>">
<header class="top">
  <div class="top-in">
    <a class="brand" href="<?= e(base_url('')) ?>"><span class="tick">✓✓</span> MailTrack Pro</a>
    <nav class="nav">
      <?php foreach ($nav as $p => $label): ?>
        <a href="<?= e(base_url($p)) ?>" class="<?= ($cur === $p || ($p !== '' && str_starts_with($cur, $p . '/')) || ($p === '' && str_starts_with($cur, 'email/'))) ? 'on' : '' ?>"><?= e($label) ?></a>
      <?php endforeach; ?>
    </nav>
    <div class="userbox">
      <span class="hide-sm"><?= e($u['email'] ?? '') ?></span>
      <form method="post" action="<?= e(base_url('logout')) ?>" class="inline"><?= csrf_field() ?><button class="btn sm">Atsijungti</button></form>
    </div>
  </div>
</header>
<main class="wrap">
  <?php foreach (flash() as [$type, $msg]): ?>
    <div class="flash <?= $type === 'err' ? 'err' : '' ?>"><?= e($msg) ?></div>
  <?php endforeach; ?>
  <?= $content ?>
</main>
<script src="<?= e(base_url('assets/app.js')) ?>?v=<?= APP_VERSION ?>"></script>
</body>
</html>
