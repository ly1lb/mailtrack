<?php
/**
 * MailTrack Pro – diegimo vedlys.
 * Paleiskite vieną kartą: https://jusu-subdomenas/install.php
 * Po sėkmingo diegimo IŠTRINKITE šį failą per FTP.
 */
declare(strict_types=1);
define('APP_ROOT', __DIR__);
require __DIR__ . '/app/Logger.php';
require __DIR__ . '/app/DB.php';
require __DIR__ . '/app/helpers.php';

Logger::init(__DIR__ . '/data/logs', 'debug');
Logger::registerHandlers(true);
date_default_timezone_set('UTC');

$done = is_file(__DIR__ . '/config.php') || is_file(__DIR__ . '/data/install.lock');
$errors = [];
$ok = false;

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$guessBase = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');

$req = [];
foreach (['pdo', 'json', 'mbstring', 'curl', 'openssl'] as $ext) {
    $req[$ext] = extension_loaded($ext);
}
$writable = is_writable(__DIR__) && is_writable(__DIR__ . '/data');

if (!$done && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $in = fn($k, $d = '') => trim((string)($_POST[$k] ?? $d));
    $driver = $in('db_driver') === 'sqlite' ? 'sqlite' : 'mysql';
    $config = [
        'base_url' => rtrim($in('base_url', $guessBase), '/'),
        'db' => [
            'driver' => $driver,
            'host' => $in('db_host', 'localhost'),
            'port' => (int)$in('db_port', '3306'),
            'name' => $in('db_name'),
            'user' => $in('db_user'),
            'pass' => (string)($_POST['db_pass'] ?? ''),
            'sqlite_path' => __DIR__ . '/data/mailtrack.sqlite',
        ],
        'app_secret' => bin2hex(random_bytes(32)),
        'timezone' => 'Europe/Vilnius',
        'log_level' => 'info',
        'log_keep_days' => 30,
        'geo_enabled' => true,
        'trust_proxy_headers' => false,
        'mail' => [
            'from_email' => $in('from_email', $in('admin_email')),
            'from_name' => 'MailTrack Pro',
            'smtp' => [
                'host' => $in('smtp_host'),
                'port' => (int)$in('smtp_port', '465'),
                'encryption' => in_array($in('smtp_enc'), ['ssl', 'tls', 'none'], true) ? $in('smtp_enc') : 'ssl',
                'user' => $in('smtp_user'),
                'pass' => (string)($_POST['smtp_pass'] ?? ''),
            ],
        ],
        'telegram_bot_token' => $in('telegram_bot_token'),
        'cron_key' => bin2hex(random_bytes(12)),
        'max_upload_mb' => 20,
    ];
    $GLOBALS['CONFIG'] = $config;
    $email = strtolower($in('admin_email'));
    $pass = (string)($_POST['admin_pass'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'Neteisingas administratoriaus el. paštas.';
    if (strlen($pass) < 8) $errors[] = 'Slaptažodis turi būti bent 8 simbolių.';
    if (!preg_match('#^https?://#', $config['base_url'])) $errors[] = 'Neteisingas adresas (turi prasidėti https://).';
    if (!$writable) $errors[] = 'Nėra rašymo teisių į aplanką arba data/ (nustatykite 755).';

    if (!$errors) {
        try {
            DB::connect($config['db']);
            DB::runSchema(__DIR__ . '/app/schema.' . $driver . '.sql');
            require __DIR__ . '/app/Auth.php';
            if (!DB::value('SELECT COUNT(*) FROM users WHERE email = ?', [$email])) {
                Auth::createUser($email, $pass, $in('admin_name'), 'admin');
            }
            $php = "<?php\n// Sugeneravo install.php " . gmdate('Y-m-d H:i:s') . " UTC. Žr. config.sample.php aprašymus.\nreturn " . var_export($config, true) . ";\n";
            if (file_put_contents(__DIR__ . '/config.php', $php, LOCK_EX) === false) {
                throw new RuntimeException('Nepavyko įrašyti config.php');
            }
            @chmod(__DIR__ . '/config.php', 0640);
            file_put_contents(__DIR__ . '/data/install.lock', gmdate('c'));
            foreach (['logs', 'uploads', 'sessions'] as $d) {
                @mkdir(__DIR__ . '/data/' . $d, 0755, true);
            }
            Logger::info('Įdiegta sėkmingai', ['driver' => $driver, 'base' => $config['base_url']]);
            $ok = true;
        } catch (Throwable $e) {
            Logger::error('Diegimo klaida: ' . $e->getMessage());
            $errors[] = 'Klaida: ' . $e->getMessage();
        }
    }
}
?><!doctype html>
<html lang="lt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>MailTrack Pro diegimas</title>
<link rel="stylesheet" href="assets/app.css"></head>
<body><main class="wrap" style="max-width:720px">
<h1><span style="color:var(--good)">✓✓</span> MailTrack Pro – diegimas</h1>
<?php if ($ok): ?>
  <div class="flash">Įdiegta sėkmingai!</div>
  <div class="card">
    <ol class="steps">
      <li><b>Per FTP ištrinkite <code>install.php</code></b> (saugumo sumetimais).</li>
      <li>Hostinger hPanel → <b>Advanced → Cron Jobs</b> pridėkite (kas 5 min.):<br><code>/usr/bin/php <?= e(__DIR__) ?>/cron.php</code></li>
      <li><a class="btn primary" href="<?= e($config['base_url']) ?>/login">Prisijungti prie skydelio →</a></li>
    </ol>
  </div>
<?php elseif ($done): ?>
  <div class="flash err">Sistema jau įdiegta. Ištrinkite install.php. Norėdami įdiegti iš naujo – ištrinkite config.php ir data/install.lock.</div>
<?php else: ?>
  <div class="card">
    <h3 style="margin-top:0">Serverio patikra</h3>
    <p>PHP <?= e(PHP_VERSION) ?> <?= version_compare(PHP_VERSION, '8.0.0', '>=') ? '✅' : '❌ (reikia ≥ 8.0 – hPanel → Advanced → PHP Configuration)' ?><br>
    <?php foreach ($req as $k => $v): ?><?= e($k) ?>: <?= $v ? '✅' : '❌' ?> &nbsp; <?php endforeach; ?><br>
    PDO MySQL: <?= extension_loaded('pdo_mysql') ? '✅' : '❌' ?> &nbsp; PDO SQLite: <?= extension_loaded('pdo_sqlite') ? '✅' : '❌' ?><br>
    Rašymo teisės: <?= $writable ? '✅' : '❌' ?></p>
  </div>
  <?php foreach ($errors as $er): ?><div class="flash err"><?= e($er) ?></div><?php endforeach; ?>
  <form method="post" class="card">
    <h3 style="margin-top:0">1. Adresas</h3>
    <label>Subdomeno adresas</label><input type="url" name="base_url" value="<?= e($_POST['base_url'] ?? $guessBase) ?>" required>
    <div class="help">pvz. https://track.jusudomenas.lt (be galinio /)</div>

    <h3>2. Duomenų bazė</h3>
    <label>Tipas</label>
    <select name="db_driver"><option value="mysql">MySQL / MariaDB (rekomenduojama)</option><option value="sqlite" <?= ($_POST['db_driver'] ?? '') === 'sqlite' ? 'selected' : '' ?>>SQLite (be DB kūrimo)</option></select>
    <div class="help">Hostinger: hPanel → Databases → MySQL Databases → sukurkite DB ir vartotoją. Host dažniausiai <code>localhost</code>.</div>
    <div class="grid g2">
      <div><label>Host</label><input type="text" name="db_host" value="<?= e($_POST['db_host'] ?? 'localhost') ?>"></div>
      <div><label>Portas</label><input type="text" name="db_port" value="<?= e($_POST['db_port'] ?? '3306') ?>"></div>
      <div><label>DB pavadinimas</label><input type="text" name="db_name" value="<?= e($_POST['db_name'] ?? '') ?>" placeholder="u123456789_mailtrack"></div>
      <div><label>DB vartotojas</label><input type="text" name="db_user" value="<?= e($_POST['db_user'] ?? '') ?>"></div>
    </div>
    <label>DB slaptažodis</label><input type="password" name="db_pass">

    <h3>3. Administratorius</h3>
    <div class="grid g2">
      <div><label>El. paštas</label><input type="email" name="admin_email" value="<?= e($_POST['admin_email'] ?? '') ?>" required></div>
      <div><label>Vardas</label><input type="text" name="admin_name" value="<?= e($_POST['admin_name'] ?? '') ?>"></div>
    </div>
    <label>Slaptažodis (min. 8)</label><input type="password" name="admin_pass" required minlength="8">

    <h3>4. Pranešimų siuntimas (galima užpildyti vėliau config.php)</h3>
    <div class="help">Hostinger: hPanel → Emails → sukurkite pvz. track@jusudomenas.lt. SMTP: smtp.hostinger.com, 465, SSL.</div>
    <div class="grid g2">
      <div><label>Siuntėjo el. paštas</label><input type="email" name="from_email" value="<?= e($_POST['from_email'] ?? '') ?>"></div>
      <div><label>SMTP host</label><input type="text" name="smtp_host" value="<?= e($_POST['smtp_host'] ?? 'smtp.hostinger.com') ?>"></div>
      <div><label>SMTP portas</label><input type="text" name="smtp_port" value="<?= e($_POST['smtp_port'] ?? '465') ?>"></div>
      <div><label>Šifravimas</label><select name="smtp_enc"><option>ssl</option><option>tls</option><option>none</option></select></div>
      <div><label>SMTP vartotojas</label><input type="text" name="smtp_user" value="<?= e($_POST['smtp_user'] ?? '') ?>"></div>
      <div><label>SMTP slaptažodis</label><input type="password" name="smtp_pass"></div>
    </div>
    <label>Telegram boto raktas (neprivaloma)</label><input type="text" name="telegram_bot_token" value="<?= e($_POST['telegram_bot_token'] ?? '') ?>" placeholder="123456:ABC-DEF...">
    <p><button class="btn primary">Įdiegti</button></p>
  </form>
<?php endif; ?>
</main></body></html>
