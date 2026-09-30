<?php
/**
 * MailTrack Pro – priekinis valdiklis (front controller).
 * Visi URL keliauja čia per .htaccess. Be mod_rewrite galima naudoti index.php?r=/kelias
 */
// Kai naudojamas PHP įtaisytas serveris (php -S ... index.php) – realius failus (cron.php,
// install.php, assets/…) atiduodam tiesiogiai. Apache/LiteSpeed tai daro per .htaccess.
if (PHP_SAPI === 'cli-server') {
    $f = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (is_file($f) && realpath($f) !== __FILE__ && basename($f) !== 'index.php') {
        return false;
    }
}

require __DIR__ . '/app/bootstrap.php';

// ---- Kelio nustatymas ----
$basePath = rtrim((string)parse_url((string)cfg('base_url'), PHP_URL_PATH), '/');
$path = isset($_GET['r']) ? (string)$_GET['r'] : (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($basePath !== '' && str_starts_with($path, $basePath)) {
    $path = substr($path, strlen($basePath));
}
$path = trim(rawurldecode($path), '/');
if ($path === 'index.php') {
    $path = '';
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ---- 1. Sekimo pikselis: /o/{uid}.gif ----
if (preg_match('#^o/([A-Za-z0-9_-]{8,32})(?:\.(?:gif|png))?$#', $path, $m)) {
    $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    header('Content-Type: image/gif');
    header('Content-Length: ' . strlen($gif));
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private');
    header('Pragma: no-cache');
    header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');
    echo $gif;
    // Atsakome iškart, apdorojame po to (LiteSpeed / PHP-FPM)
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } elseif (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        @ob_end_flush();
        @flush();
    }
    ignore_user_abort(true);
    try {
        Tracker::recordOpen($m[1]);
    } catch (Throwable $e) {
        Logger::error('Atidarymo įrašymo klaida: ' . $e->getMessage(), ['uid' => $m[1], 'file' => $e->getFile(), 'line' => $e->getLine()]);
    }
    exit;
}

// ---- 2. Nuorodos paspaudimas: /c/{uid}/{idx}?u=...&s=... ----
if (preg_match('#^c/([A-Za-z0-9_-]{8,32})/(\d{1,4})$#', $path, $m)) {
    $url = null;
    try {
        $url = Tracker::recordClick($m[1], (int)$m[2], (string)($_GET['u'] ?? ''), (string)($_GET['s'] ?? ''));
    } catch (Throwable $e) {
        Logger::error('Paspaudimo įrašymo klaida: ' . $e->getMessage(), ['uid' => $m[1]]);
        // SAUGUMAS: DB sutrikus NEnukreipiam į neverifikuotą ?u= (tai būtų atviras
        // nukreipimas – phishingas per patikimą domeną). Parodom laikiną klaidą.
        header('Cache-Control: no-store');
        http_response_code(503);
        header('Retry-After: 30');
        exit('Nuoroda laikinai neprieinama. Bandykite dar kartą po kelių sekundžių.');
    }
    header('Cache-Control: no-store');
    if ($url) {
        header('Location: ' . $url, true, 302);
        exit;
    }
    http_response_code(404);
    exit('Nuoroda nerasta.');
}

// ---- 3. Sekamas dokumentas: /d/{uid} ----
if (preg_match('#^d/([A-Za-z0-9_-]{8,32})$#', $path, $m)) {
    start_session();
    $doc = DB::row('SELECT * FROM documents WHERE uid = ?', [$m[1]]);
    $file = $doc ? APP_ROOT . '/data/uploads/' . basename($doc['stored_name']) : '';
    if (!$doc || !is_file($file)) {
        Logger::warning('Dokumentas nerastas', ['uid' => $m[1]]);
        http_response_code(404);
        exit('Dokumentas nerastas.');
    }
    try {
        Tracker::recordDocView($doc);
    } catch (Throwable $e) {
        Logger::error('Dokumento peržiūros įrašymo klaida: ' . $e->getMessage());
    }
    header('Content-Type: ' . $doc['mime']);
    header('Content-Length: ' . filesize($file));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $doc['filename']) . '"');
    header('Cache-Control: private, no-store');
    header('X-Robots-Tag: noindex');
    readfile($file);
    exit;
}

// ---- 4. Sveikatos patikra (rewrite testas) ----
if ($path === 'health') {
    json_out(['ok' => true, 'version' => APP_VERSION, 'time' => gmdate('c')]);
}

// ---- 5. API ----
if (str_starts_with($path, 'api/') || $path === 'api') {
    require __DIR__ . '/app/api.php';
    exit;
}

// ---- 6. Skydelis ----
start_session();
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
require __DIR__ . '/app/pages.php';
