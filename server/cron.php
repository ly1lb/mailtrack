<?php
/**
 * Periodinės užduotys: priminimai, dienos ataskaitos, valymas.
 * Hostinger hPanel → Advanced → Cron Jobs (kas 5 min.):
 *   /usr/bin/php /home/uXXXX/domains/DOMENAS/public_html/SUBDOMENAS/cron.php
 * arba per HTTP: https://track.domenas.lt/cron.php?key=CRON_KEY
 */
require __DIR__ . '/app/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    $key = (string)($_GET['key'] ?? '');
    if ($key === '' || !hash_equals((string)cfg('cron_key'), $key)) {
        Logger::warning('cron.php iškviestas be teisingo rakto');
        http_response_code(403);
        exit('Forbidden');
    }
    header('Content-Type: text/plain; charset=utf-8');
}

$lock = fopen(APP_ROOT . '/data/cron.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    Logger::warning('cron jau vykdomas – praleidžiama');
    exit("Jau vykdoma\n");
}

$started = microtime(true);
$stats = ['reminders' => 0, 'reports' => 0];

// ---- 1. Priminimai ----
try {
    $due = DB::all('SELECT * FROM emails WHERE reminder_sent = 0 AND reminder_at IS NOT NULL AND reminder_at <= ? LIMIT 200', [now()]);
    foreach ($due as $em) {
        $user = Auth::userById((int)$em['user_id']);
        DB::update('emails', ['reminder_sent' => 1], 'id = :id', ['id' => $em['id']]);
        if (!$user) continue;
        $fire = match ($em['reminder_mode']) {
            'no_click' => (int)$em['click_count'] === 0,
            'always' => true,
            default => (int)$em['open_count'] === 0,
        };
        if (!$fire) {
            Logger::info('Priminimas nereikalingas (sąlyga neįvykdyta)', ['email' => $em['id']]);
            continue;
        }
        $subj = $em['subject'] ?: '(be temos)';
        $why = match ($em['reminder_mode']) {
            'no_click' => 'Gavėjas nepaspaudė nė vienos nuorodos.',
            'always' => 'Suplanuotas priminimas.',
            default => 'Laiškas vis dar neatidarytas.',
        };
        Notifier::notify($user, 'reminder', '⏰ Priminimas: ' . $subj, $why . "\nGavėjai: " . (recipients_text($em['recipients']) ?: '—') . "\nIšsiųsta: " . fmt_dt($em['created_at']) . "\nMetas parašyti follow-up!", (int)$em['id']);
        $stats['reminders']++;
    }
} catch (Throwable $e) {
    Logger::error('Cron priminimų klaida: ' . $e->getMessage());
}

// ---- 2. Dienos ataskaitos ----
try {
    foreach (DB::all('SELECT * FROM users WHERE daily_report = 1') as $user) {
        $GLOBALS['USER'] = $user;
        $tz = new DateTimeZone($user['timezone'] ?: 'Europe/Vilnius');
        $local = new DateTime('now', $tz);
        if ((int)$local->format('G') < (int)$user['report_hour'] || $user['last_report_date'] === $local->format('Y-m-d')) {
            continue;
        }
        DB::update('users', ['last_report_date' => $local->format('Y-m-d')], 'id = :id', ['id' => $user['id']]);
        $since = gmdate('Y-m-d H:i:s', time() - 86400);
        $sent = DB::all('SELECT * FROM emails WHERE user_id = ? AND created_at >= ? ORDER BY id DESC', [$user['id'], $since]);
        $opened = DB::all('SELECT e.*, COUNT(o.id) n FROM opens o JOIN emails e ON e.id = o.email_id WHERE e.user_id = ? AND o.ignored = 0 AND o.opened_at >= ? GROUP BY e.id ORDER BY n DESC LIMIT 30', [$user['id'], $since]);
        $clicks = (int)DB::value('SELECT COUNT(*) FROM clicks c JOIN emails e ON e.id = c.email_id WHERE e.user_id = ? AND c.ignored = 0 AND c.clicked_at >= ?', [$user['id'], $since]);
        $unopened = DB::all('SELECT * FROM emails WHERE user_id = ? AND open_count = 0 AND archived = 0 AND created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 15', [$user['id'], gmdate('Y-m-d H:i:s', time() - 7 * 86400), gmdate('Y-m-d H:i:s', time() - 86400)]);
        if (!$sent && !$opened && !$unopened) {
            continue;
        }
        $row = fn($e, $extra) => '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee"><a href="' . e(base_url('email/' . $e['id'])) . '">' . e($e['subject'] ?: '(be temos)') . '</a><br><span style="color:#888;font-size:12px">' . e(recipients_text($e['recipients'])) . '</span></td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">' . $extra . '</td></tr>';
        $html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:640px">'
            . '<h2>📊 Dienos ataskaita – ' . e($local->format('Y-m-d')) . '</h2>'
            . '<p>Per 24 val.: išsiųsta <b>' . count($sent) . '</b> sekamų laiškų, atidaryta <b>' . count($opened) . '</b> skirtingų laiškų, nuorodų paspaudimų – <b>' . $clicks . '</b>.</p>';
        if ($opened) {
            $html .= '<h3>✓✓ Atidaryti</h3><table style="width:100%;border-collapse:collapse">' . implode('', array_map(fn($e) => $row($e, (int)$e['n'] . '×'), $opened)) . '</table>';
        }
        if ($unopened) {
            $html .= '<h3>✓ Neatidaryti (1–7 d.) – verta priminti</h3><table style="width:100%;border-collapse:collapse">' . implode('', array_map(fn($e) => $row($e, e(fmt_dt($e['created_at'], 'm-d'))), $unopened)) . '</table>';
        }
        $html .= '<p><a href="' . e(base_url('')) . '">Atidaryti skydelį</a></p></div>';
        Mailer::send($user['email'], 'MailTrack Pro: dienos ataskaita ' . $local->format('Y-m-d'), $html);
        $stats['reports']++;
    }
} catch (Throwable $e) {
    Logger::error('Cron ataskaitų klaida: ' . $e->getMessage());
}

// ---- 3. Valymas ----
try {
    Logger::cleanup((int)cfg('log_keep_days', 30));
    DB::query('DELETE FROM login_attempts WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 86400)]);
    DB::query('DELETE FROM selfviews WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 86400)]);
    DB::query('DELETE FROM notifications WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 90 * 86400)]);
    DB::query('DELETE FROM geo_cache WHERE created_at < ?', [gmdate('Y-m-d H:i:s', time() - 60 * 86400)]);
} catch (Throwable $e) {
    Logger::error('Cron valymo klaida: ' . $e->getMessage());
}

kv_set('cron_last_run', now());
$msg = sprintf('Cron baigtas per %.2fs: priminimai=%d, ataskaitos=%d', microtime(true) - $started, $stats['reminders'], $stats['reports']);
Logger::info($msg);
echo $msg . "\n";
flock($lock, LOCK_UN);
