<?php
/** Skydelio puslapiai. Kintamieji $path ir $method ateina iš index.php */

$isPost = $method === 'POST';
if ($isPost) {
    csrf_check();
}

// ---------- Prisijungimas ----------
if ($path === 'login') {
    if (Auth::user()) {
        redirect('');
    }
    $error = '';
    if ($isPost) {
        if (Auth::tooManyAttempts(client_ip())) {
            $error = 'Per daug bandymų. Palaukite 15 min.';
            Logger::warning('Prisijungimas užblokuotas (per daug bandymų)');
        } elseif ($u = Auth::attempt((string)($_POST['email'] ?? ''), (string)($_POST['password'] ?? ''))) {
            Auth::rememberIp($u);
            $to = $_SESSION['after_login'] ?? '';
            unset($_SESSION['after_login']);
            redirect(is_string($to) && str_starts_with($to, '/') ? rtrim((string)cfg('base_url'), '/') . $to : '');
        } else {
            $error = 'Neteisingas el. paštas arba slaptažodis.';
        }
    }
    render('login', ['error' => $error], false);
    exit;
}

if ($path === 'logout' && $isPost) {
    Auth::logout();
    redirect('login');
}

$USER = Auth::requireLogin();
$GLOBALS['USER'] = $USER;
$uid = (int)$USER['id'];

// ---------- Suvestinė ----------
if ($path === '') {
    $filter = (string)($_GET['f'] ?? 'all');
    $q = trim((string)($_GET['q'] ?? ''));
    $page = max(1, (int)($_GET['p'] ?? 1));
    $per = 50;
    $where = 'user_id = :u';
    $params = ['u' => $uid];
    $where .= $filter === 'archived' ? ' AND archived = 1' : ' AND archived = 0';
    if ($filter === 'opened') $where .= ' AND open_count > 0';
    if ($filter === 'unopened') $where .= ' AND open_count = 0';
    if ($filter === 'clicked') $where .= ' AND click_count > 0';
    if ($filter === 'reminders') $where .= ' AND reminder_at IS NOT NULL AND reminder_sent = 0';
    if ($q !== '') {
        $where .= ' AND (subject LIKE :q OR recipients LIKE :q)';
        $params['q'] = '%' . $q . '%';
    }
    $total = (int)DB::value("SELECT COUNT(*) FROM emails WHERE $where", $params);
    $off = ($page - 1) * $per;
    $emails = DB::all("SELECT * FROM emails WHERE $where ORDER BY id DESC LIMIT $per OFFSET $off", $params);

    $since30 = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
    $stats = DB::row('SELECT COUNT(*) sent, SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) opened, SUM(CASE WHEN click_count > 0 THEN 1 ELSE 0 END) clicked FROM emails WHERE user_id = ? AND created_at >= ?', [$uid, $since30]);
    $today = (new DateTime('today', new DateTimeZone($USER['timezone'])))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $opensToday = (int)DB::value('SELECT COUNT(*) FROM opens o JOIN emails e ON e.id = o.email_id WHERE e.user_id = ? AND o.ignored = 0 AND o.opened_at >= ?', [$uid, $today]);

    // atidarymai per 14 d. (grafikui)
    $daily = [];
    $tz = new DateTimeZone($USER['timezone']);
    for ($i = 13; $i >= 0; $i--) {
        $d = (new DateTime("today -$i days", $tz));
        $daily[$d->format('Y-m-d')] = 0;
    }
    $rows = DB::all('SELECT o.opened_at FROM opens o JOIN emails e ON e.id = o.email_id WHERE e.user_id = ? AND o.ignored = 0 AND o.opened_at >= ?', [$uid, gmdate('Y-m-d H:i:s', time() - 15 * 86400)]);
    foreach ($rows as $r) {
        $k = (new DateTime($r['opened_at'], new DateTimeZone('UTC')))->setTimezone($tz)->format('Y-m-d');
        if (isset($daily[$k])) $daily[$k]++;
    }
    $recent = DB::all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 8', [$uid]);
    render('dashboard', compact('emails', 'stats', 'opensToday', 'filter', 'q', 'page', 'per', 'total', 'daily', 'recent'));
    exit;
}

// ---------- Laiško detalės ----------
if (preg_match('#^email/(\d+)(?:/([a-z-]+))?$#', $path, $m)) {
    $email = DB::row('SELECT * FROM emails WHERE id = ? AND user_id = ?', [(int)$m[1], $uid]);
    if (!$email) {
        http_response_code(404);
        render('message', ['title' => 'Nerasta', 'text' => 'Laiškas nerastas.']);
        exit;
    }
    $act = $m[2] ?? '';
    if ($isPost) {
        switch ($act) {
            case 'reminder':
                $days = (float)($_POST['days'] ?? 0);
                if ($days > 0) {
                    DB::update('emails', [
                        'reminder_at' => gmdate('Y-m-d H:i:s', time() + (int)round($days * 86400)),
                        'reminder_mode' => in_array($_POST['mode'] ?? '', ['no_open', 'no_click', 'always'], true) ? $_POST['mode'] : 'no_open',
                        'reminder_sent' => 0,
                    ], 'id = :id', ['id' => $email['id']]);
                    flash('Priminimas nustatytas.');
                } else {
                    DB::update('emails', ['reminder_at' => null, 'reminder_sent' => 0], 'id = :id', ['id' => $email['id']]);
                    flash('Priminimas pašalintas.');
                }
                break;
            case 'note':
                DB::update('emails', ['note' => mb_substr((string)($_POST['note'] ?? ''), 0, 500), 'subject' => mb_substr((string)($_POST['subject'] ?? $email['subject']), 0, 500)], 'id = :id', ['id' => $email['id']]);
                flash('Išsaugota.');
                break;
            case 'archive':
                DB::update('emails', ['archived' => $email['archived'] ? 0 : 1], 'id = :id', ['id' => $email['id']]);
                flash($email['archived'] ? 'Grąžinta iš archyvo.' : 'Perkelta į archyvą.');
                break;
            case 'delete':
                foreach (['opens', 'clicks', 'links', 'selfviews', 'notifications'] as $t) {
                    DB::query("DELETE FROM $t WHERE email_id = ?", [$email['id']]);
                }
                DB::query('DELETE FROM emails WHERE id = ?', [$email['id']]);
                Logger::info('Laiškas ištrintas', ['email' => $email['id']]);
                flash('Laiškas ištrintas.');
                redirect('');
            case 'toggle-open':
                $oid = (int)($_POST['open_id'] ?? 0);
                $o = DB::row('SELECT * FROM opens WHERE id = ? AND email_id = ?', [$oid, $email['id']]);
                if ($o) {
                    DB::update('opens', $o['ignored']
                        ? ['ignored' => 0, 'ignore_reason' => '']
                        : ['ignored' => 1, 'ignore_reason' => 'Pažymėta rankiniu būdu'], 'id = :id', ['id' => $oid]);
                    Tracker::recount((int)$email['id']);
                }
                break;
        }
        redirect('email/' . $email['id']);
    }
    $opens = DB::all('SELECT * FROM opens WHERE email_id = ? ORDER BY id DESC LIMIT 500', [$email['id']]);
    $clicks = DB::all('SELECT c.*, l.url FROM clicks c JOIN links l ON l.id = c.link_id WHERE c.email_id = ? ORDER BY c.id DESC LIMIT 500', [$email['id']]);
    $links = DB::all('SELECT * FROM links WHERE email_id = ? ORDER BY idx', [$email['id']]);
    render('email', compact('email', 'opens', 'clicks', 'links'));
    exit;
}

// ---------- Naujas sekamas laiškas rankiniu būdu ----------
if ($path === 'new') {
    $created = null;
    if ($isPost) {
        $links = [];
        foreach (preg_split('/\s+/', trim((string)($_POST['links'] ?? '')), -1, PREG_SPLIT_NO_EMPTY) as $i => $url) {
            $links[] = ['idx' => $i, 'url' => $url];
        }
        $created = Tracker::createEmail($USER, [
            'subject' => $_POST['subject'] ?? '',
            'recipients' => $_POST['recipients'] ?? '',
            'source' => 'manual',
            'links' => $links,
            'reminder_days' => $_POST['reminder_days'] ?? 0,
        ]);
        $created['tracked_links'] = array_map(fn($l) => ['url' => $l['url'], 'tracked' => tracked_link_url($USER, $created['uid'], (int)$l['idx'], $l['url'])], DB::all('SELECT * FROM links WHERE email_id = ? ORDER BY idx', [$created['id']]));
    }
    render('new', ['created' => $created]);
    exit;
}

// ---------- Dokumentai (PDF sekimas) ----------
if ($path === 'documents' || preg_match('#^documents/(\d+)/delete$#', $path, $m)) {
    if ($isPost && isset($m[1])) {
        $doc = DB::row('SELECT * FROM documents WHERE id = ? AND user_id = ?', [(int)$m[1], $uid]);
        if ($doc) {
            @unlink(APP_ROOT . '/data/uploads/' . basename($doc['stored_name']));
            DB::query('DELETE FROM doc_views WHERE document_id = ?', [$doc['id']]);
            DB::query('DELETE FROM documents WHERE id = ?', [$doc['id']]);
            flash('Dokumentas ištrintas.');
        }
        redirect('documents');
    }
    if ($isPost) {
        $f = $_FILES['file'] ?? null;
        $max = (int)cfg('max_upload_mb', 20) * 1024 * 1024;
        $allowed = ['pdf' => 'application/pdf', 'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls' => 'application/vnd.ms-excel', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt' => 'application/vnd.ms-powerpoint', 'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'zip' => 'application/zip', 'txt' => 'text/plain'];
        $ext = strtolower(pathinfo((string)($f['name'] ?? ''), PATHINFO_EXTENSION));
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            Logger::warning('Įkėlimo klaida', ['code' => $f['error'] ?? 'nėra failo']);
            flash('Įkėlimas nepavyko (klaidos kodas ' . ($f['error'] ?? '?') . '). Patikrinkite failo dydį.', 'err');
        } elseif ($f['size'] > $max) {
            flash('Failas per didelis.', 'err');
        } elseif (!isset($allowed[$ext])) {
            flash('Neleidžiamas failo tipas. Leidžiami: ' . implode(', ', array_keys($allowed)), 'err');
        } else {
            $stored = random_uid(24) . '.' . $ext;
            if (move_uploaded_file($f['tmp_name'], APP_ROOT . '/data/uploads/' . $stored)) {
                DB::insert('documents', [
                    'user_id' => $uid, 'uid' => random_uid(16), 'title' => mb_substr(trim((string)($_POST['title'] ?? '')), 0, 250),
                    'filename' => mb_substr(basename((string)$f['name']), 0, 250), 'stored_name' => $stored, 'mime' => $allowed[$ext],
                    'size' => (int)$f['size'], 'created_at' => now(),
                ]);
                Logger::info('Įkeltas dokumentas', ['file' => $f['name']]);
                flash('Dokumentas įkeltas. Nukopijuokite sekamą nuorodą ir įdėkite į laišką.');
            } else {
                Logger::error('move_uploaded_file nepavyko – patikrinkite data/uploads teises');
                flash('Nepavyko išsaugoti failo (teisės?).', 'err');
            }
        }
        redirect('documents');
    }
    $docs = DB::all('SELECT * FROM documents WHERE user_id = ? ORDER BY id DESC', [$uid]);
    $views = [];
    foreach (DB::all('SELECT v.* FROM doc_views v JOIN documents d ON d.id = v.document_id WHERE d.user_id = ? ORDER BY v.id DESC LIMIT 200', [$uid]) as $v) {
        $views[$v['document_id']][] = $v;
    }
    render('documents', compact('docs', 'views'));
    exit;
}

// ---------- Nuorodų paspaudimai (kaip Mailsuite „Link clicks“) ----------
if ($path === 'clicks') {
    $page = max(1, (int)($_GET['p'] ?? 1));
    $per = 100;
    $off = ($page - 1) * $per;
    $showAll = !empty($_GET['all']);
    $where = $showAll ? '' : ' AND c.ignored = 0';
    $total = (int)DB::value("SELECT COUNT(*) FROM clicks c JOIN emails e ON e.id = c.email_id WHERE e.user_id = ?$where", [$uid]);
    $clicks = DB::all(
        "SELECT c.*, l.url, e.subject, e.recipients, e.id eid
         FROM clicks c JOIN links l ON l.id = c.link_id JOIN emails e ON e.id = c.email_id
         WHERE e.user_id = ?$where ORDER BY c.id DESC LIMIT $per OFFSET $off",
        [$uid]
    );
    $topLinks = DB::all(
        'SELECT l.url, SUM(l.click_count) cnt FROM links l JOIN emails e ON e.id = l.email_id
         WHERE e.user_id = ? GROUP BY l.url HAVING cnt > 0 ORDER BY cnt DESC LIMIT 15',
        [$uid]
    );
    render('clicks', compact('clicks', 'topLinks', 'total', 'page', 'per', 'showAll'));
    exit;
}

// ---------- Šablonai ----------
if ($path === 'templates' || preg_match('#^templates/(\d+)/(delete)$#', $path, $m)) {
    if ($isPost && isset($m[1])) {
        DB::query('DELETE FROM templates WHERE id = ? AND user_id = ?', [(int)$m[1], $uid]);
        flash('Šablonas ištrintas.');
        redirect('templates');
    }
    if ($isPost) {
        $id = (int)($_POST['id'] ?? 0);
        $data = [
            'name' => mb_substr(trim((string)($_POST['name'] ?? '')), 0, 190),
            'subject' => mb_substr((string)($_POST['subject'] ?? ''), 0, 500),
            'body_html' => mb_substr((string)($_POST['body_html'] ?? ''), 0, 50000),
        ];
        if ($data['name'] === '') {
            flash('Įveskite šablono pavadinimą.', 'err');
        } elseif ($id && DB::value('SELECT COUNT(*) FROM templates WHERE id = ? AND user_id = ?', [$id, $uid])) {
            DB::update('templates', $data + ['updated_at' => now()], 'id = :id AND user_id = :u', ['id' => $id, 'u' => $uid]);
            flash('Šablonas atnaujintas.');
        } else {
            DB::insert('templates', $data + ['user_id' => $uid, 'created_at' => now()]);
            flash('Šablonas sukurtas. Jis pasirodys Gmail rašymo lange (mygtukas „Šablonai“).');
        }
        redirect('templates');
    }
    $templates = DB::all('SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [$uid]);
    $edit = null;
    if (isset($_GET['edit'])) {
        $edit = DB::row('SELECT * FROM templates WHERE id = ? AND user_id = ?', [(int)$_GET['edit'], $uid]);
    }
    render('templates', compact('templates', 'edit'));
    exit;
}

// ---------- Nustatymai ----------
if ($path === 'settings' || preg_match('#^settings/([a-z-]+)$#', $path, $m)) {
    $act = $m[1] ?? '';
    if ($isPost) {
        switch ($act) {
            case '':
                $tz = (string)($_POST['timezone'] ?? 'Europe/Vilnius');
                if (!in_array($tz, DateTimeZone::listIdentifiers(), true)) $tz = 'Europe/Vilnius';
                DB::update('users', [
                    'name' => mb_substr(trim((string)($_POST['name'] ?? '')), 0, 190),
                    'timezone' => $tz,
                    'notify_email' => isset($_POST['notify_email']) ? 1 : 0,
                    'notify_telegram' => isset($_POST['notify_telegram']) ? 1 : 0,
                    'notify_clicks' => isset($_POST['notify_clicks']) ? 1 : 0,
                    'notify_old_opens' => isset($_POST['notify_old_opens']) ? 1 : 0,
                    'notify_mode' => in_array($_POST['notify_mode'] ?? '', ['every', 'first', 'off'], true) ? $_POST['notify_mode'] : 'every',
                    'notify_skip_prefetch' => isset($_POST['notify_skip_prefetch']) ? 1 : 0,
                    'telegram_chat_id' => preg_replace('/[^0-9-]/', '', (string)($_POST['telegram_chat_id'] ?? '')),
                    'webhook_url' => mb_substr(trim((string)($_POST['webhook_url'] ?? '')), 0, 500),
                    'daily_report' => isset($_POST['daily_report']) ? 1 : 0,
                    'report_hour' => max(0, min(23, (int)($_POST['report_hour'] ?? 8))),
                    'ignore_seconds' => max(0, min(600, (int)($_POST['ignore_seconds'] ?? 20))),
                    'prefetch_seconds' => max(0, min(1800, (int)($_POST['prefetch_seconds'] ?? 150))),
                    'prefetch_mode' => in_array($_POST['prefetch_mode'] ?? '', ['flag', 'ignore', 'off'], true) ? $_POST['prefetch_mode'] : 'flag',
                    'auto_ignore_ips' => isset($_POST['auto_ignore_ips']) ? 1 : 0,
                ], 'id = :id', ['id' => $uid]);
                flash('Nustatymai išsaugoti.');
                break;
            case 'password':
                $p1 = (string)($_POST['new_password'] ?? '');
                if (!password_verify((string)($_POST['current_password'] ?? ''), $USER['password_hash'])) {
                    flash('Neteisingas dabartinis slaptažodis.', 'err');
                } elseif (strlen($p1) < 8) {
                    flash('Naujas slaptažodis turi būti bent 8 simbolių.', 'err');
                } else {
                    DB::update('users', ['password_hash' => password_hash($p1, PASSWORD_DEFAULT)], 'id = :id', ['id' => $uid]);
                    flash('Slaptažodis pakeistas.');
                }
                break;
            case 'apikey':
                DB::update('users', ['api_key' => bin2hex(random_bytes(20))], 'id = :id', ['id' => $uid]);
                Logger::info('API raktas pakeistas', ['user' => $uid]);
                flash('Sugeneruotas naujas API raktas. Atnaujinkite jį plėtinyje ir Gmail priede.');
                break;
            case 'ip-add':
                $ip = trim((string)($_POST['ip'] ?? ''));
                if (filter_var($ip, FILTER_VALIDATE_IP) && !Tracker::isOwnIp($uid, $ip)) {
                    DB::insert('user_ips', ['user_id' => $uid, 'ip' => $ip, 'note' => mb_substr((string)($_POST['note'] ?? 'Rankinis'), 0, 120), 'created_at' => now(), 'last_seen_at' => now()]);
                    flash('IP pridėtas.');
                } else {
                    flash('Neteisingas arba jau esantis IP.', 'err');
                }
                break;
            case 'ip-delete':
                DB::query('DELETE FROM user_ips WHERE id = ? AND user_id = ?', [(int)($_POST['id'] ?? 0), $uid]);
                flash('IP pašalintas.');
                break;
            case 'telegram-token':
                $tok = trim((string)($_POST['telegram_bot_token'] ?? ''));
                if ($tok !== '' && !preg_match('#^\d{6,}:[A-Za-z0-9_-]{30,}$#', $tok)) {
                    flash('Boto raktas atrodo neteisingas. Formatas: 123456789:AAE... (iš @BotFather).', 'err');
                    break;
                }
                kv_set('telegram_bot_token', $tok);
                flash($tok === '' ? 'Telegram boto raktas pašalintas.' : 'Telegram boto raktas išsaugotas. Dabar parašykite botui /start ir spauskite „Aptikti chat ID“.');
                break;
            case 'telegram-test':
                if (($USER['telegram_chat_id'] ?? '') === '') {
                    flash('Nėra chat ID. Pirmiausia „Aptikti chat ID“.', 'err');
                    break;
                }
                $ok = Notifier::telegram($USER['telegram_chat_id'], '🔔 MailTrack Pro bandomoji žinutė – viskas veikia!');
                flash($ok ? 'Bandomoji žinutė išsiųsta į Telegram.' : 'Nepavyko išsiųsti – žr. Žurnalus (galbūt neteisingas chat ID ar serveris be interneto).', $ok ? 'ok' : 'err');
                break;
            case 'telegram-detect':
                $token = telegram_token();
                if ($token === '') {
                    flash('Pirmiausia įveskite Telegram boto raktą (laukelis aukščiau).', 'err');
                    break;
                }
                $r = http_post_json("https://api.telegram.org/bot$token/getUpdates", ['limit' => 20], 6);
                $d = json_decode($r['body'], true);
                if ($r['code'] !== 200 || !is_array($d) || empty($d['ok'])) {
                    Logger::warning('Telegram getUpdates klaida', ['code' => $r['code'], 'resp' => substr($r['body'], 0, 300), 'err' => $r['error']]);
                    flash('Telegram klaida (HTTP ' . $r['code'] . '): ' . (($d['description'] ?? '') ?: ($r['error'] ?: 'patikrinkite boto raktą')) . '. Ar serveris turi interneto prieigą? Žr. Žurnalus.', 'err');
                    break;
                }
                $chat = null;
                foreach (array_reverse($d['result'] ?? []) as $upd) {
                    $c = $upd['message']['chat']['id'] ?? ($upd['channel_post']['chat']['id'] ?? null);
                    if ($c !== null) { $chat = (string)$c; break; }
                }
                if ($chat) {
                    DB::update('users', ['telegram_chat_id' => $chat, 'notify_telegram' => 1], 'id = :id', ['id' => $uid]);
                    $ok = Notifier::telegram($chat, '✅ MailTrack Pro prijungtas! Čia gausite pranešimus apie atidarymus ir paspaudimus.');
                    flash($ok ? 'Telegram prijungtas (chat ID ' . $chat . '). Turėjote gauti bandomąją žinutę.' : 'Chat ID rastas, bet žinutės išsiųsti nepavyko – žr. Žurnalus.', $ok ? 'ok' : 'err');
                } else {
                    flash('Boto raktas veikia, bet dar negauta jokių žinučių. Telegram programėlėje suraskite savo botą, paspauskite START arba parašykite /start, tada bandykite dar kartą.', 'err');
                }
                break;
        }
        Auth::forget($uid);
        redirect('settings');
    }
    $ips = DB::all('SELECT * FROM user_ips WHERE user_id = ? ORDER BY last_seen_at DESC', [$uid]);
    $botName = '';
    render('settings', compact('ips', 'botName'));
    exit;
}

// ---------- Įdiegimas (plėtinys, telefonas) ----------
if ($path === 'setup') {
    render('setup');
    exit;
}

// ---------- CSV eksportas ----------
if ($path === 'export.csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="mailtrack-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['ID', 'Tema', 'Gavėjai', 'Išsiųsta', 'Atidarymai', 'Pirmas atidarymas', 'Paskutinis atidarymas', 'Paspaudimai', 'Šaltinis'], ';', '"', '');
    foreach (DB::all('SELECT * FROM emails WHERE user_id = ? ORDER BY id DESC', [$uid]) as $e) {
        fputcsv($out, [$e['id'], $e['subject'], recipients_text($e['recipients']), fmt_dt($e['created_at']), $e['open_count'], fmt_dt($e['first_open_at']), fmt_dt($e['last_open_at']), $e['click_count'], $e['source']], ';', '"', '');
    }
    exit;
}

// ---------- Vartotojai (admin) ----------
if ($path === 'users') {
    Auth::requireAdmin();
    if ($isPost) {
        $act = $_POST['action'] ?? '';
        if ($act === 'create') {
            $em = trim((string)($_POST['email'] ?? ''));
            $pw = (string)($_POST['password'] ?? '');
            if (!filter_var($em, FILTER_VALIDATE_EMAIL) || strlen($pw) < 8) {
                flash('Neteisingas el. paštas arba per trumpas slaptažodis (min. 8).', 'err');
            } elseif (DB::value('SELECT COUNT(*) FROM users WHERE email = ?', [mb_strtolower($em)])) {
                flash('Toks vartotojas jau yra.', 'err');
            } else {
                Auth::createUser($em, $pw, (string)($_POST['name'] ?? ''), ($_POST['role'] ?? '') === 'admin' ? 'admin' : 'user');
                flash('Vartotojas sukurtas.');
            }
        } elseif ($act === 'delete' && (int)$_POST['id'] !== $uid) {
            DB::query('DELETE FROM users WHERE id = ?', [(int)$_POST['id']]);
            flash('Vartotojas ištrintas.');
        }
        redirect('users');
    }
    $users = DB::all('SELECT u.*, (SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id) emails FROM users u ORDER BY id');
    render('users', compact('users'));
    exit;
}

// ---------- Žurnalai ----------
if ($path === 'logs' || $path === 'logs/download' || $path === 'logs/clear') {
    Auth::requireAdmin();
    $files = Logger::files();
    $file = (string)($_GET['file'] ?? ($files[0] ?? ''));
    if (!in_array($file, $files, true)) {
        $file = $files[0] ?? '';
    }
    $full = $file ? Logger::dir() . '/' . $file : '';
    if ($path === 'logs/clear' && $isPost) {
        if ($full) {
            @unlink($full);
        }
        flash('Žurnalas ištrintas.');
        redirect('logs');
    }
    if ($path === 'logs/download' && $full) {
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $file . '"');
        readfile($full);
        exit;
    }
    $level = strtoupper((string)($_GET['level'] ?? ''));
    $search = (string)($_GET['s'] ?? '');
    $lines = [];
    if ($full && is_file($full)) {
        // skaitom paskutinius ~2 MB
        $size = filesize($full);
        $fh = fopen($full, 'r');
        if ($size > 2_000_000) {
            fseek($fh, $size - 2_000_000);
            fgets($fh);
        }
        while (($ln = fgets($fh)) !== false) {
            if ($level !== '' && !str_contains($ln, "[$level]")) continue;
            if ($search !== '' && stripos($ln, $search) === false) continue;
            $lines[] = rtrim($ln);
        }
        fclose($fh);
        $lines = array_reverse(array_slice($lines, -1000));
    }
    render('logs', compact('files', 'file', 'lines', 'level', 'search'));
    exit;
}

// ---------- Diagnostika ----------
if ($path === 'diagnostics' || preg_match('#^diagnostics/(mail|telegram|pixel)$#', $path, $m)) {
    Auth::requireAdmin();
    if ($isPost && isset($m[1])) {
        if ($m[1] === 'mail') {
            $ok = Mailer::send($USER['email'], 'MailTrack Pro – bandomasis laiškas', '<p>Jei matote šį laišką – siuntimas veikia ✅</p>');
            flash($ok ? 'Bandomasis laiškas išsiųstas į ' . $USER['email'] : 'Siuntimas nepavyko – žr. Žurnalus.', $ok ? 'ok' : 'err');
        } elseif ($m[1] === 'telegram') {
            $ok = $USER['telegram_chat_id'] !== '' && Notifier::telegram($USER['telegram_chat_id'], '🔔 MailTrack Pro – bandomasis pranešimas');
            flash($ok ? 'Telegram žinutė išsiųsta.' : 'Telegram nepavyko – patikrinkite boto raktą ir chat ID (žr. Žurnalus).', $ok ? 'ok' : 'err');
        } elseif ($m[1] === 'pixel') {
            $test = Tracker::createEmail($USER, ['subject' => 'Diagnostikos testas ' . date('H:i:s'), 'source' => 'test']);
            DB::update('emails', ['created_at' => gmdate('Y-m-d H:i:s', time() - 3600)], 'id = :id', ['id' => $test['id']]);
            flash('Sukurtas testinis laiškas. Atidarykite pikselio nuorodą kitame įrenginyje (ne iš savo IP) ir stebėkite atidarymą.');
            redirect('email/' . $test['id']);
        }
        redirect('diagnostics');
    }
    $checks = [];
    $checks[] = ['PHP versija ≥ 8.0', version_compare(PHP_VERSION, '8.0.0', '>='), PHP_VERSION];
    foreach (['pdo', 'curl', 'mbstring', 'openssl', 'json'] as $ext) {
        $checks[] = ["PHP plėtinys: $ext", extension_loaded($ext), extension_loaded($ext) ? 'įjungtas' : 'TRŪKSTA'];
    }
    $checks[] = ['DB tvarkyklė', true, DB::driver()];
    foreach (['data/logs', 'data/uploads', 'data/sessions'] as $d) {
        $checks[] = ["Rašymo teisės: $d", is_writable(APP_ROOT . '/' . $d), is_writable(APP_ROOT . '/' . $d) ? 'OK' : 'NĖRA (nustatykite 755/775)'];
    }
    $checks[] = ['base_url naudoja HTTPS', str_starts_with((string)cfg('base_url'), 'https://'), (string)cfg('base_url')];
    $checks[] = ['install.php pašalintas', !is_file(APP_ROOT . '/install.php'), is_file(APP_ROOT . '/install.php') ? 'IŠTRINKITE install.php!' : 'OK'];
    $lastCron = kv_get('cron_last_run');
    $cronOk = $lastCron && strtotime($lastCron . ' UTC') > time() - 3600;
    $checks[] = ['Cron paleistas per paskutinę valandą', (bool)$cronOk, $lastCron ? fmt_dt($lastCron) . ' (' . ago($lastCron) . ')' : 'niekada'];
    $checks[] = ['Telegram botas sukonfigūruotas', telegram_token() !== '', telegram_token() ? 'taip' : 'ne (neprivaloma)'];
    $smtpHost = (string)cfg('mail.smtp.host');
    $smtpCreds = $smtpHost !== '' && cfg('mail.smtp.user') && cfg('mail.smtp.pass');
    $checks[] = ['El. pašto siuntimas', $smtpHost === '' || $smtpCreds, $smtpHost === '' ? 'mail()' : ($smtpCreds ? $smtpHost . ' (su prisijungimu)' : $smtpHost . ' – TRŪKSTA user/pass (el. laiškai nesiunčiami)')];
    $checks[] = ['Geolokacija', (bool)cfg('geo_enabled'), cfg('geo_enabled') ? 'ip-api.com' : 'išjungta'];
    $checks[] = ['LiteSpeed/FPM greitas atsakymas', function_exists('litespeed_finish_request') || function_exists('fastcgi_finish_request'), function_exists('litespeed_finish_request') ? 'litespeed_finish_request' : (function_exists('fastcgi_finish_request') ? 'fastcgi_finish_request' : 'nėra (pikselis šiek tiek lėtesnis)')];

    $today = Logger::dir() . '/app-' . gmdate('Y-m-d') . '.log';
    $errCount = 0;
    $warnCount = 0;
    if (is_file($today)) {
        $txt = file_get_contents($today);
        $errCount = substr_count($txt, '[ERROR]');
        $warnCount = substr_count($txt, '[WARNING]');
    }
    $counts = [
        'Vartotojai' => DB::value('SELECT COUNT(*) FROM users'),
        'Laiškai' => DB::value('SELECT COUNT(*) FROM emails'),
        'Atidarymai (viso įrašų)' => DB::value('SELECT COUNT(*) FROM opens'),
        'Paspaudimai' => DB::value('SELECT COUNT(*) FROM clicks'),
        'Dokumentai' => DB::value('SELECT COUNT(*) FROM documents'),
    ];
    render('diagnostics', compact('checks', 'errCount', 'warnCount', 'counts'));
    exit;
}

http_response_code(404);
Logger::info('404', ['path' => $path]);
render('message', ['title' => '404', 'text' => 'Puslapis nerastas.']);
