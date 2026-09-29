<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('APP_VERSION', '1.0.0');

require __DIR__ . '/Logger.php';
require __DIR__ . '/DB.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/UserAgent.php';
require __DIR__ . '/Geo.php';
require __DIR__ . '/Mailer.php';
require __DIR__ . '/Notifier.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Tracker.php';

if (!is_file(APP_ROOT . '/config.php')) {
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, "config.php nerastas – paleiskite install.php\n");
        exit(1);
    }
    header('Location: install.php');
    exit;
}

$GLOBALS['CONFIG'] = require APP_ROOT . '/config.php';

ini_set('display_errors', '0');
error_reporting(E_ALL);
Logger::init(APP_ROOT . '/data/logs', (string)cfg('log_level', 'info'));
Logger::registerHandlers((bool)cfg('debug_display', false));
date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

try {
    DB::connect(cfg('db'));
} catch (Throwable $e) {
    Logger::error('Nepavyko prisijungti prie DB: ' . $e->getMessage());
    if (PHP_SAPI !== 'cli') {
        http_response_code(503);
    }
    exit('Duomenų bazė nepasiekiama. Klaidos ID: ' . Logger::requestId());
}

// Lengvos migracijos – naujos lentelės esamiems diegimams (nereikia iš naujo diegti).
try {
    $auto = DB::driver() === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY';
    DB::pdo()->exec("CREATE TABLE IF NOT EXISTS templates (
        id $auto,
        user_id INT NOT NULL,
        name VARCHAR(190) NOT NULL,
        subject VARCHAR(500) NOT NULL DEFAULT '',
        body_html TEXT NULL,
        use_count INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NULL
    )");

    // Naujos users stulpeliai esamiems diegimams
    $cols = [];
    if (DB::driver() === 'sqlite') {
        foreach (DB::all('PRAGMA table_info(users)') as $c) {
            $cols[] = $c['name'];
        }
    } else {
        foreach (DB::all('SHOW COLUMNS FROM users') as $c) {
            $cols[] = $c['Field'];
        }
    }
    if (!in_array('prefetch_seconds', $cols, true)) {
        DB::pdo()->exec('ALTER TABLE users ADD COLUMN prefetch_seconds INT NOT NULL DEFAULT 150');
        Logger::info('Migracija: pridėtas users.prefetch_seconds');
    }
    if (!in_array('prefetch_mode', $cols, true)) {
        DB::pdo()->exec("ALTER TABLE users ADD COLUMN prefetch_mode VARCHAR(10) NOT NULL DEFAULT 'flag'");
        Logger::info('Migracija: pridėtas users.prefetch_mode');
    }
} catch (Throwable $e) {
    Logger::warning('Migracijos klaida: ' . $e->getMessage());
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = str_starts_with((string)cfg('base_url'), 'https://');
    session_name('mtpro');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    $dir = APP_ROOT . '/data/sessions';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    if (is_writable($dir)) {
        session_save_path($dir);
    }
    session_start();
}
