<?php
/** Bendros pagalbinės funkcijos. */

function cfg(?string $key = null, $default = null)
{
    $c = $GLOBALS['CONFIG'] ?? [];
    if ($key === null) {
        return $c;
    }
    foreach (explode('.', $key) as $part) {
        if (!is_array($c) || !array_key_exists($part, $c)) {
            return $default;
        }
        $c = $c[$part];
    }
    return $c;
}

function e($s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function base_url(string $path = ''): string
{
    return rtrim((string)cfg('base_url', ''), '/') . '/' . ltrim($path, '/');
}

/** Atsitiktinis URL-saugus identifikatorius. */
function random_uid(int $len = 22): string
{
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $out = '';
    $bytes = random_bytes($len);
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[ord($bytes[$i]) % 62];
    }
    return $out;
}

function valid_uid(string $uid): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{8,32}$/', $uid);
}

function b64url_encode(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_decode(string $s): string
{
    return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
}

/** Nuorodos parašas: pirmi 16 hex simbolių HMAC-SHA256(uid|idx|url, link_secret). Tas pats algoritmas – plėtinyje. */
function link_signature(string $secret, string $uid, int $idx, string $url): string
{
    return substr(hash_hmac('sha256', $uid . '|' . $idx . '|' . $url, $secret), 0, 16);
}

function tracked_link_url(array $user, string $uid, int $idx, string $url): string
{
    return base_url('c/' . $uid . '/' . $idx) . '?u=' . b64url_encode($url) . '&s=' . link_signature($user['link_secret'], $uid, $idx, $url);
}

function pixel_url(string $uid): string
{
    return base_url('o/' . $uid . '.gif');
}

function pixel_html(string $uid): string
{
    return '<img src="' . e(pixel_url($uid)) . '" alt="" width="1" height="1" border="0" '
        . 'style="height:1px!important;width:1px!important;border-width:0!important;margin:0!important;padding:0!important;display:block;overflow:hidden;opacity:0">';
}

function client_ip(): string
{
    if (cfg('trust_proxy_headers')) {
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP'] as $h) {
            if (!empty($_SERVER[$h])) {
                $ip = trim(explode(',', $_SERVER[$h])[0]);
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function redirect(string $path): never
{
    header('Location: ' . (preg_match('#^https?://#', $path) ? $path : base_url($path)));
    exit;
}

function json_out($data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return $_POST;
    }
    $d = json_decode($raw, true);
    return is_array($d) ? $d : $_POST;
}

function flash(?string $msg = null, string $type = 'ok')
{
    if ($msg !== null) {
        $_SESSION['flash'][] = [$type, $msg];
        return null;
    }
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $f;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function csrf_check(): void
{
    $t = $_POST['_csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!is_string($t) || !hash_equals(csrf_token(), $t)) {
        Logger::warning('CSRF patikra nepavyko');
        http_response_code(419);
        exit('Sesija pasibaigė arba neteisinga forma. Grįžkite ir bandykite dar kartą.');
    }
}

/** Atvaizduoja šabloną su bendru išdėstymu. */
function render(string $view, array $vars = [], bool $layout = true): void
{
    extract($vars);
    ob_start();
    require APP_ROOT . '/views/' . $view . '.php';
    $content = ob_get_clean();
    if ($layout) {
        require APP_ROOT . '/views/layout.php';
    } else {
        echo $content;
    }
}

/** UTC datą -> vartotojo laiko juosta. */
function fmt_dt(?string $utc, string $format = 'Y-m-d H:i'): string
{
    if (!$utc) {
        return '—';
    }
    $tz = $GLOBALS['USER']['timezone'] ?? cfg('timezone', 'Europe/Vilnius');
    try {
        $d = new DateTime($utc, new DateTimeZone('UTC'));
        $d->setTimezone(new DateTimeZone($tz));
        return $d->format($format);
    } catch (Throwable $e) {
        return $utc;
    }
}

/** "prieš 5 min." */
function ago(?string $utc): string
{
    if (!$utc) {
        return '—';
    }
    $diff = time() - strtotime($utc . ' UTC');
    if ($diff < 60) return 'ką tik';
    if ($diff < 3600) return 'prieš ' . floor($diff / 60) . ' min.';
    if ($diff < 86400) return 'prieš ' . floor($diff / 3600) . ' val.';
    if ($diff < 86400 * 30) return 'prieš ' . floor($diff / 86400) . ' d.';
    return fmt_dt($utc, 'Y-m-d');
}

function kv_get(string $k, $default = null)
{
    $v = DB::value('SELECT v FROM kv WHERE k = ?', [$k]);
    return $v === null ? $default : $v;
}

function kv_set(string $k, string $v): void
{
    if (DB::value('SELECT COUNT(*) FROM kv WHERE k = ?', [$k])) {
        DB::query('UPDATE kv SET v = ? WHERE k = ?', [$v, $k]);
    } else {
        DB::query('INSERT INTO kv (k, v) VALUES (?, ?)', [$k, $v]);
    }
}

function recipients_text(?string $json): string
{
    $arr = json_decode((string)$json, true);
    if (!is_array($arr)) {
        return (string)$json;
    }
    return implode(', ', array_filter(array_map('strval', $arr)));
}

function http_post_json(string $url, array $data, int $timeout = 5): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($data, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 3,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['code' => $code, 'body' => $body === false ? '' : $body, 'error' => $err];
}

function iso_utc(?string $utc): ?string
{
    return $utc ? str_replace(' ', 'T', $utc) . 'Z' : null;
}
