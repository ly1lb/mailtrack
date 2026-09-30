<?php
/** Pagrindinė sekimo logika: laiškų registravimas, atidarymai, paspaudimai, dokumentų peržiūros. */
final class Tracker
{
    public const SELFVIEW_WINDOW = 90;   // sek. – atidarymai šiame lange po "savos peržiūros" ignoruojami
    public const DUPLICATE_WINDOW = 30;  // sek. – pasikartojantys užklausimai iš to paties IP+UA
    public const PROXY_DEDUP_WINDOW = 180; // sek. (3 min) – sujungiam Google prefetch + iškart sekantį render,
                                           // bet tikrus vėlesnius pakartotinius atidarymus vis tiek skaičiuojam

    /**
     * Sukuria (arba atnaujina, jei uid jau yra) sekamą laišką.
     * @param array $links [['idx'=>0,'url'=>'https://...'], ...]
     */
    public static function createEmail(array $user, array $in): array
    {
        $uid = (string)($in['uid'] ?? '');
        if ($uid === '' || !valid_uid($uid)) {
            $uid = random_uid();
        }
        $subject = mb_substr(trim((string)($in['subject'] ?? '')), 0, 500);
        $recips = $in['recipients'] ?? [];
        if (is_string($recips)) {
            $recips = preg_split('/[,;\s]+/', $recips, -1, PREG_SPLIT_NO_EMPTY);
        }
        $recips = array_values(array_unique(array_filter(array_map(fn($r) => mb_substr(trim((string)$r), 0, 190), (array)$recips))));
        $source = preg_replace('/[^a-z_]/', '', (string)($in['source'] ?? 'api')) ?: 'api';

        $existing = DB::row('SELECT * FROM emails WHERE uid = ?', [$uid]);
        if ($existing && (int)$existing['user_id'] !== (int)$user['id']) {
            Logger::warning('uid priklauso kitam vartotojui – generuojamas naujas', ['uid' => $uid]);
            $uid = random_uid();
            $existing = null;
        }
        if ($existing) {
            $upd = [];
            if ($subject !== '' && $existing['subject'] === '') $upd['subject'] = $subject;
            if ($recips && recipients_text($existing['recipients']) === '') $upd['recipients'] = json_encode($recips, JSON_UNESCAPED_UNICODE);
            if ($upd) DB::update('emails', $upd, 'id = :id', ['id' => $existing['id']]);
            $id = (int)$existing['id'];
        } else {
            $id = DB::insert('emails', [
                'user_id' => $user['id'],
                'uid' => $uid,
                'subject' => $subject,
                'recipients' => json_encode($recips, JSON_UNESCAPED_UNICODE),
                'source' => $source,
                'created_at' => now(),
            ]);
            Logger::info('Užregistruotas sekamas laiškas', ['id' => $id, 'uid' => $uid, 'source' => $source]);
        }

        foreach ((array)($in['links'] ?? []) as $l) {
            if (!isset($l['idx'], $l['url'])) continue;
            self::registerLink($id, (int)$l['idx'], (string)$l['url']);
        }

        $days = (float)($in['reminder_days'] ?? 0);
        if ($days > 0) {
            $mode = in_array($in['reminder_mode'] ?? '', ['no_open', 'no_click', 'always'], true) ? $in['reminder_mode'] : 'no_open';
            DB::update('emails', [
                'reminder_at' => gmdate('Y-m-d H:i:s', time() + (int)round($days * 86400)),
                'reminder_mode' => $mode,
                'reminder_sent' => 0,
            ], 'id = :id', ['id' => $id]);
        }
        return DB::row('SELECT * FROM emails WHERE id = ?', [$id]);
    }

    public static function registerLink(int $emailId, int $idx, string $url): ?int
    {
        if (!preg_match('#^https?://#i', $url)) {
            return null;
        }
        $row = DB::row('SELECT id FROM links WHERE email_id = ? AND idx = ?', [$emailId, $idx]);
        if ($row) {
            return (int)$row['id'];
        }
        return DB::insert('links', ['email_id' => $emailId, 'idx' => $idx, 'url' => $url, 'created_at' => now()]);
    }

    /** Pikselio užklausa. */
    public static function recordOpen(string $uid): void
    {
        $email = DB::row('SELECT * FROM emails WHERE uid = ?', [$uid]);
        if (!$email) {
            Logger::warning('Pikselis nežinomam laiškui (dar neužregistruotas ar ištrintas)', ['uid' => $uid, 'ua' => $_SERVER['HTTP_USER_AGENT'] ?? '']);
            return;
        }
        $user = Auth::userById((int)$email['user_id']);
        if (!$user) {
            return;
        }
        $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
        $ip = client_ip();
        $p = UserAgent::parse($ua);
        $cl = self::classify($user, $email, $ip, $ua, $p, 'opens', 'opened_at');

        $geo = ['country' => '', 'city' => ''];
        if ($p['proxy'] === '' && !$p['bot']) {
            $geo = Geo::lookup($ip);
        }
        DB::insert('opens', [
            'email_id' => $email['id'],
            'opened_at' => now(),
            'ip' => $ip,
            'user_agent' => $ua,
            'client' => $p['client'],
            'device' => $p['device'],
            'os' => $p['os'],
            'proxy' => $p['proxy'],
            'country' => $geo['country'],
            'city' => $geo['city'],
            'ignored' => $cl['ignored'],
            'ignore_reason' => $cl['reason'],
        ]);
        if ($cl['ignored']) {
            Logger::debug('Atidarymas ignoruotas', ['email' => $email['id'], 'reason' => $cl['reason']]);
            return;
        }
        self::recount((int)$email['id']);
        $count = (int)DB::value('SELECT open_count FROM emails WHERE id = ?', [$email['id']]);
        Logger::info('Laiškas atidarytas', ['email' => $email['id'], 'count' => $count, 'client' => $p['client']]);

        $where = self::whereText($p, $geo);
        if ($cl['reason'] !== '') {
            $where .= "\n" . $cl['reason'];
        }
        $subj = $email['subject'] !== '' ? $email['subject'] : '(be temos)';
        $to = recipients_text($email['recipients']);

        // Ar apie šį atidarymą pranešti (Telegram / el. paštu).
        // Svarbu: „įtartinas" (galimas prefetch) atidarymas neturi suvalgyti
        // pirmojo pranešimo – kitaip apie TIKRĄ atidarymą nebepraneštume.
        $suspect = $cl['reason'] !== '';
        $mode = (string)($user['notify_mode'] ?? 'every');
        $skipPrefetch = !isset($user['notify_skip_prefetch']) || !empty($user['notify_skip_prefetch']);
        $realCount = (int)DB::value(
            "SELECT COUNT(*) FROM opens WHERE email_id = ? AND ignored = 0 AND ignore_reason = ''",
            [$email['id']]
        );
        if ($mode === 'off') {
            $push = false;
        } elseif ($suspect) {
            $push = !$skipPrefetch && $mode === 'every';
        } elseif ($mode === 'every') {
            $push = true;
        } else { // 'first'
            $push = $realCount === 1;
        }
        Notifier::notify(
            $user,
            'open',
            ($count === 1 ? '✓✓ Atidarytas: ' : "✓✓ Atidarytas ($count k.): ") . $subj,
            ($to ? "Gavėjas: $to\n" : '') . $where,
            (int)$email['id'],
            null,
            $push,
            ['email_uid' => $email['uid'], 'subject' => $email['subject'], 'open_count' => $count]
        );
    }

    /** Nuorodos paspaudimas. Grąžina URL nukreipimui arba null. */
    public static function recordClick(string $uid, int $idx, string $u, string $sig): ?string
    {
        $email = DB::row('SELECT * FROM emails WHERE uid = ?', [$uid]);
        if (!$email) {
            Logger::warning('Paspaudimas nežinomam laiškui', ['uid' => $uid, 'idx' => $idx]);
            return null;
        }
        $user = Auth::userById((int)$email['user_id']);
        if (!$user) {
            return null;
        }
        $link = DB::row('SELECT * FROM links WHERE email_id = ? AND idx = ?', [$email['id'], $idx]);
        if (!$link) {
            $url = b64url_decode($u);
            if ($url === '' || !hash_equals(link_signature($user['link_secret'], $uid, $idx, $url), $sig) || !preg_match('#^https?://#i', $url)) {
                Logger::warning('Neteisingas nuorodos parašas (galimas atviro nukreipimo bandymas)', ['uid' => $uid, 'idx' => $idx]);
                return null;
            }
            $linkId = self::registerLink((int)$email['id'], $idx, $url);
            $link = DB::row('SELECT * FROM links WHERE id = ?', [$linkId]);
        }

        $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
        $ip = client_ip();
        $p = UserAgent::parse($ua);
        $reason = self::classify($user, $email, $ip, $ua, $p, 'clicks', 'clicked_at', false)['reason_if_ignored'];
        $geo = $p['bot'] ? ['country' => '', 'city' => ''] : Geo::lookup($ip);
        DB::insert('clicks', [
            'email_id' => $email['id'],
            'link_id' => $link['id'],
            'clicked_at' => now(),
            'ip' => $ip,
            'user_agent' => $ua,
            'client' => $p['client'],
            'device' => $p['device'],
            'os' => $p['os'],
            'country' => $geo['country'],
            'city' => $geo['city'],
            'ignored' => $reason === '' ? 0 : 1,
            'ignore_reason' => $reason,
        ]);
        if ($reason === '') {
            self::recount((int)$email['id']);
            Logger::info('Nuoroda paspausta', ['email' => $email['id'], 'link' => $link['id']]);
            // Į veiklos srautą rašom VISADA – nustatymas „pranešti apie paspaudimus“
            // valdo tik išsiuntimą (Telegram/el. paštas), o ne istoriją skydelyje.
            $subj = $email['subject'] !== '' ? $email['subject'] : '(be temos)';
            Notifier::notify(
                $user,
                'click',
                '🔗 Paspausta nuoroda: ' . $subj,
                "Nuoroda: {$link['url']}\n" . self::whereText($p, $geo),
                (int)$email['id'],
                null,
                !empty($user['notify_clicks']),
                ['email_uid' => $email['uid'], 'url' => $link['url']]
            );
        }
        return $link['url'];
    }

    /** Siuntėjas pats peržiūri laišką (plėtinys / Gmail priedas praneša). */
    public static function selfView(array $email): void
    {
        DB::insert('selfviews', ['email_id' => $email['id'], 'created_at' => now()]);
        $since = gmdate('Y-m-d H:i:s', time() - self::SELFVIEW_WINDOW);
        $n = DB::query(
            "UPDATE opens SET ignored = 1, ignore_reason = 'Jūsų peržiūra (plėtinys/priedas)' WHERE email_id = ? AND ignored = 0 AND opened_at >= ?",
            [$email['id'], $since]
        )->rowCount();
        if ($n > 0) {
            self::recount((int)$email['id']);
            DB::query("DELETE FROM notifications WHERE email_id = ? AND type = 'open' AND created_at >= ?", [$email['id'], $since]);
            Logger::info('Savos peržiūros atidarymai atšaukti', ['email' => $email['id'], 'count' => $n]);
        }
    }

    public static function recount(int $emailId): void
    {
        $o = DB::row('SELECT COUNT(*) c, MIN(opened_at) f, MAX(opened_at) l FROM opens WHERE email_id = ? AND ignored = 0', [$emailId]);
        $c = (int)DB::value('SELECT COUNT(*) FROM clicks WHERE email_id = ? AND ignored = 0', [$emailId]);
        DB::update('emails', [
            'open_count' => (int)$o['c'],
            'first_open_at' => $o['f'],
            'last_open_at' => $o['l'],
            'click_count' => $c,
        ], 'id = :id', ['id' => $emailId]);
        DB::query('UPDATE links SET click_count = (SELECT COUNT(*) FROM clicks WHERE clicks.link_id = links.id AND clicks.ignored = 0) WHERE email_id = ?', [$emailId]);
    }

    public static function recordDocView(array $doc): void
    {
        $user = Auth::userById((int)$doc['user_id']);
        $ua = mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500);
        $ip = client_ip();
        $p = UserAgent::parse($ua);
        if ($p['bot'] || !$user) {
            Logger::debug('Dokumento peržiūra ignoruota (botas)', ['doc' => $doc['id'], 'ua' => $ua]);
            return;
        }
        if (self::isOwnIp((int)$user['id'], $ip) || !empty($_SESSION['uid'])) {
            Logger::debug('Dokumento peržiūra ignoruota (savininkas)', ['doc' => $doc['id']]);
            return;
        }
        $geo = Geo::lookup($ip);
        DB::insert('doc_views', [
            'document_id' => $doc['id'], 'viewed_at' => now(), 'ip' => $ip, 'user_agent' => $ua,
            'device' => $p['device'], 'os' => $p['os'], 'country' => $geo['country'], 'city' => $geo['city'],
        ]);
        DB::query('UPDATE documents SET view_count = view_count + 1, last_view_at = ? WHERE id = ?', [now(), $doc['id']]);
        Notifier::notify($user, 'doc', '📄 Peržiūrėtas dokumentas: ' . ($doc['title'] ?: $doc['filename']), self::whereText($p, $geo), null, (int)$doc['id']);
    }

    public static function isOwnIp(int $userId, string $ip): bool
    {
        return (bool)DB::value('SELECT COUNT(*) FROM user_ips WHERE user_id = ? AND ip = ?', [$userId, $ip]);
    }

    /**
     * Įvertina atidarymą/paspaudimą.
     * @return array{ignored:int, reason:string, reason_if_ignored:string}
     *   ignored=1 – neskaičiuojamas; ignored=0 su reason – skaičiuojamas, bet pažymėtas
     *   (pvz. galimas Gmail prefetch – rodom kaip Mailsuite, tik sąžiningai pažymėtą).
     */
    private static function classify(array $user, array $email, string $ip, string $ua, array $p, string $table, string $col, bool $checkEarly = true): array
    {
        $drop = fn(string $r) => ['ignored' => 1, 'reason' => $r, 'reason_if_ignored' => $r];
        $keep = fn(string $r = '') => ['ignored' => 0, 'reason' => $r, 'reason_if_ignored' => ''];

        $age = time() - strtotime($email['created_at'] . ' UTC');
        if ($checkEarly && $age < (int)$user['ignore_seconds']) {
            return $drop('Per anksti po išsiuntimo (tikėtina – jūsų peržiūra)');
        }
        $sv = DB::value('SELECT COUNT(*) FROM selfviews WHERE email_id = ? AND created_at >= ?', [$email['id'], gmdate('Y-m-d H:i:s', time() - self::SELFVIEW_WINDOW)]);
        if ($sv && $table === 'opens') {
            return $drop('Jūsų peržiūra (plėtinys/priedas)');
        }
        if (self::isOwnIp((int)$user['id'], $ip)) {
            return $drop('Jūsų IP adresas');
        }
        if ($p['bot']) {
            return $drop('Botas / saugumo skeneris');
        }
        // Proxy IP kaskart skiriasi, o laiškas gali būti užkraunamas kelis kartus,
        // todėl proxy atidarymus sujungiam lange ignoruodami IP/UA.
        if ($table === 'opens' && $p['proxy'] !== '') {
            $dupProxy = DB::value(
                "SELECT COUNT(*) FROM opens WHERE email_id = ? AND proxy = ? AND ignored = 0 AND opened_at >= ?",
                [$email['id'], $p['proxy'], gmdate('Y-m-d H:i:s', time() - self::PROXY_DEDUP_WINDOW)]
            );
            if ($dupProxy) {
                return $drop('Pasikartojanti proxy užklausa');
            }
        }
        $dup = DB::value(
            "SELECT COUNT(*) FROM $table WHERE email_id = ? AND ip = ? AND user_agent = ? AND ignored = 0 AND $col >= ?",
            [$email['id'], $ip, $ua, gmdate('Y-m-d H:i:s', time() - self::DUPLICATE_WINDOW)]
        );
        if ($dup) {
            return $drop('Pasikartojanti užklausa');
        }

        // Gmail iš anksto užkrauna paveikslėlius vos laiškui atkeliavus (jei gavėjas
        // turi aktyvią Gmail sesiją) – pikselis suveikia be žmogaus. Kadangi vėliau
        // Google gali paveikslėlį kešuoti, visiškas ignoravimas rizikuoja prarasti
        // vienintelį signalą. Todėl pagal nutylėjimą SKAIČIUOJAM, bet PAŽYMIM.
        if ($table === 'opens' && $p['proxy'] !== '' && $age < (int)($user['prefetch_seconds'] ?? 150)) {
            $mode = (string)($user['prefetch_mode'] ?? 'flag');
            if ($mode === 'ignore') {
                return $drop('Gmail išankstinis užkrovimas (prefetch) – neskaičiuota');
            }
            if ($mode === 'flag') {
                return $keep('⚠ Galimas Gmail prefetch – gavėjas galėjo dar neatidaryti');
            }
        }
        return $keep();
    }

    private static function whereText(array $p, array $geo): string
    {
        $parts = [];
        if ($p['proxy'] !== '') {
            $parts[] = 'Per ' . $p['proxy'] . ' (vieta ir įrenginys paslėpti)';
        } else {
            $dev = trim($p['device'] . ($p['os'] ? ', ' . $p['os'] : '') . ($p['client'] !== 'Nežinomas' ? ', ' . $p['client'] : ''));
            $parts[] = 'Įrenginys: ' . $dev;
            $loc = trim($geo['city'] . ($geo['city'] && $geo['country'] ? ', ' : '') . $geo['country']);
            if ($loc !== '') {
                $parts[] = 'Vieta: ' . $loc;
            }
        }
        return implode("\n", $parts);
    }
}
