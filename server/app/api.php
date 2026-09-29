<?php
/**
 * JSON API – naudoja Chrome plėtinys, Gmail priedas (telefonui) ir skydelio JS.
 * Autentifikacija: antraštė "X-Api-Key: <raktas>" (arba prisijungusio vartotojo sesija).
 *
 * GET  /api/ping                     – patikrina raktą, grąžina nustatymus plėtiniui
 * POST /api/emails                   – užregistruoja sekamą laišką {uid?, subject, recipients[], links[], source, reminder_days}
 * GET  /api/emails?limit=50          – paskutiniai laiškai su statistika
 * GET  /api/emails/{uid}             – vieno laiško detalės (atidarymai, paspaudimai)
 * POST /api/emails/{uid}/meta        – papildo temą/gavėjus (Gmail priedas po išsiuntimo)
 * POST /api/selfview                 – {uid} siuntėjas pats peržiūri laišką
 * POST /api/links                    – {uid, url} sugeneruoja sekamą nuorodą
 * GET  /api/notifications?since=ID   – nauji pranešimai (tikro laiko įspėjimams)
 * POST /api/log                      – {level, message, context, source} klientų klaidų žurnalas
 */

// CORS: plėtinys kviečia API iš chrome-extension:// kilmės
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key, X-CSRF-Token');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Max-Age: 86400');
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$hasKey = !empty($_SERVER['HTTP_X_API_KEY']) || !empty($_GET['key']);
if (!$hasKey) {
    start_session(); // skydelio JS naudoja sesiją
}
$user = Auth::apiUser();
$sub = substr($path, 4); // be "api/"

if (!$user) {
    // /api/log leidžiamas ir be rakto (kad matytume konfigūracijos klaidas), bet apribotas
    if ($sub === 'log' && $method === 'POST') {
        $in = json_input();
        Logger::write('warning', '[klientas be rakto] ' . mb_substr((string)($in['message'] ?? ''), 0, 500), ['source' => mb_substr((string)($in['source'] ?? ''), 0, 40)]);
        json_out(['ok' => true]);
    }
    json_out(['ok' => false, 'error' => 'Neteisingas arba trūkstamas API raktas'], 401);
}
if (!$hasKey && $method === 'POST') {
    csrf_check();
}

try {
    // ping
    if ($sub === 'ping') {
        Auth::rememberIp($user, 'Plėtinys/priedas');
        json_out([
            'ok' => true,
            'version' => APP_VERSION,
            'user' => ['email' => $user['email'], 'name' => $user['name']],
            'base_url' => rtrim((string)cfg('base_url'), '/'),
            'link_secret' => $user['link_secret'],
            'pixel_prefix' => base_url('o/'),
            'click_prefix' => base_url('c/'),
        ]);
    }

    if ($sub === 'emails' && $method === 'POST') {
        $in = json_input();
        $email = Tracker::createEmail($user, $in);
        json_out(['ok' => true] + email_json($email) + ['pixel_html' => pixel_html($email['uid'])]);
    }

    if ($sub === 'emails' && $method === 'GET') {
        $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));
        $rows = DB::all("SELECT * FROM emails WHERE user_id = ? AND archived = 0 ORDER BY id DESC LIMIT $limit", [$user['id']]);
        json_out(['ok' => true, 'emails' => array_map('email_json', $rows)]);
    }

    if (preg_match('#^emails/([A-Za-z0-9_-]{8,32})(/meta)?$#', $sub, $mm)) {
        $email = DB::row('SELECT * FROM emails WHERE uid = ? AND user_id = ?', [$mm[1], $user['id']]);
        if (!$email) {
            json_out(['ok' => false, 'error' => 'Laiškas nerastas'], 404);
        }
        if (!empty($mm[2]) && $method === 'POST') {
            $in = json_input();
            $in['uid'] = $email['uid'];
            $email = Tracker::createEmail($user, ['uid' => $email['uid'], 'subject' => $in['subject'] ?? '', 'recipients' => $in['recipients'] ?? []]);
            json_out(['ok' => true] + email_json($email));
        }
        $opens = DB::all('SELECT opened_at, client, device, os, proxy, country, city, ignored, ignore_reason FROM opens WHERE email_id = ? ORDER BY id DESC LIMIT 100', [$email['id']]);
        $clicks = DB::all('SELECT c.clicked_at, c.device, c.os, c.country, c.city, c.ignored, l.url FROM clicks c JOIN links l ON l.id = c.link_id WHERE c.email_id = ? ORDER BY c.id DESC LIMIT 100', [$email['id']]);
        json_out(['ok' => true] + email_json($email) + ['opens' => $opens, 'clicks' => $clicks]);
    }

    if ($sub === 'selfview' && $method === 'POST') {
        $in = json_input();
        $uids = array_slice((array)($in['uids'] ?? [$in['uid'] ?? '']), 0, 20);
        $done = 0;
        foreach ($uids as $uid) {
            $email = DB::row('SELECT * FROM emails WHERE uid = ? AND user_id = ?', [(string)$uid, $user['id']]);
            if ($email) {
                Tracker::selfView($email);
                $done++;
            }
        }
        json_out(['ok' => true, 'marked' => $done]);
    }

    if ($sub === 'links' && $method === 'POST') {
        $in = json_input();
        $url = trim((string)($in['url'] ?? ''));
        if (!preg_match('#^https?://#i', $url)) {
            $url = 'https://' . ltrim($url, '/');
        }
        $email = Tracker::createEmail($user, ['uid' => (string)($in['uid'] ?? ''), 'source' => (string)($in['source'] ?? 'addon')]);
        $idx = (int)DB::value('SELECT COALESCE(MAX(idx), -1) + 1 FROM links WHERE email_id = ?', [$email['id']]);
        Tracker::registerLink((int)$email['id'], $idx, $url);
        json_out(['ok' => true, 'uid' => $email['uid'], 'idx' => $idx, 'tracked_url' => tracked_link_url($user, $email['uid'], $idx, $url)]);
    }

    if ($sub === 'notifications' && $method === 'GET') {
        $since = (int)($_GET['since'] ?? 0);
        if ($since <= 0) {
            // pirmas kvietimas – grąžinam tik paskutinį ID, kad nebūtų senų pranešimų lavinos
            $last = (int)DB::value('SELECT COALESCE(MAX(id), 0) FROM notifications WHERE user_id = ?', [$user['id']]);
            json_out(['ok' => true, 'last_id' => $last, 'items' => []]);
        }
        $items = DB::all('SELECT id, type, title, body, email_id, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT 50', [$user['id'], $since]);
        foreach ($items as &$it) {
            $it['created_at'] = iso_utc($it['created_at']);
            $it['url'] = $it['email_id'] ? base_url('email/' . $it['email_id']) : base_url('');
        }
        unset($it);
        $last = $items ? (int)end($items)['id'] : $since;
        json_out(['ok' => true, 'last_id' => $last, 'items' => $items]);
    }

    if ($sub === 'log' && $method === 'POST') {
        $in = json_input();
        $lvl = in_array($in['level'] ?? '', ['debug', 'info', 'warning', 'error'], true) ? $in['level'] : 'warning';
        Logger::write($lvl, '[' . mb_substr((string)($in['source'] ?? 'klientas'), 0, 40) . '] ' . mb_substr((string)($in['message'] ?? ''), 0, 1000), [
            'user' => $user['id'],
            'context' => is_array($in['context'] ?? null) ? $in['context'] : mb_substr((string)($in['context'] ?? ''), 0, 2000),
        ]);
        json_out(['ok' => true]);
    }

    json_out(['ok' => false, 'error' => 'Nežinomas API kelias: ' . $sub], 404);
} catch (Throwable $e) {
    Logger::error('API klaida: ' . $e->getMessage(), ['path' => $sub, 'file' => $e->getFile(), 'line' => $e->getLine()]);
    json_out(['ok' => false, 'error' => 'Serverio klaida', 'request_id' => Logger::requestId()], 500);
}

function email_json(array $e): array
{
    return [
        'id' => (int)$e['id'],
        'uid' => $e['uid'],
        'subject' => $e['subject'],
        'recipients' => recipients_text($e['recipients']),
        'sent_at' => iso_utc($e['created_at']),
        'open_count' => (int)$e['open_count'],
        'click_count' => (int)$e['click_count'],
        'first_open_at' => iso_utc($e['first_open_at']),
        'last_open_at' => iso_utc($e['last_open_at']),
        'pixel_url' => pixel_url($e['uid']),
        'dashboard_url' => base_url('email/' . $e['id']),
    ];
}
