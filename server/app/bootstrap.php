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
