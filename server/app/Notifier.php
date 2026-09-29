<?php
/** Pranešimai: skydelio srautas (DB), el. paštas, Telegram, webhook. */
final class Notifier
{
    /**
     * @param bool $push ar siųsti į išorinius kanalus (el. paštas / Telegram / webhook)
     */
    public static function notify(array $user, string $type, string $title, string $body, ?int $emailId = null, ?int $docId = null, bool $push = true, array $payload = []): void
    {
        try {
            DB::insert('notifications', [
                'user_id' => $user['id'],
                'type' => $type,
                'email_id' => $emailId,
                'document_id' => $docId,
                'title' => mb_substr($title, 0, 250),
                'body' => mb_substr($body, 0, 990),
                'created_at' => now(),
                'is_read' => 0,
            ]);
        } catch (Throwable $e) {
            Logger::error('Nepavyko įrašyti pranešimo: ' . $e->getMessage());
        }
        if (!$push) {
            return;
        }
        $link = $emailId ? base_url('email/' . $emailId) : ($docId ? base_url('documents') : base_url(''));

        if (!empty($user['notify_telegram']) && $user['telegram_chat_id'] !== '' && telegram_token()) {
            self::telegram($user['telegram_chat_id'], "<b>" . e($title) . "</b>\n" . e($body) . "\n<a href=\"" . e($link) . "\">Atidaryti</a>");
        }
        if (!empty($user['notify_email'])) {
            $html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">'
                . '<h2 style="margin:0 0 8px;font-size:18px">' . e($title) . '</h2>'
                . '<p style="margin:0 0 12px">' . nl2br(e($body)) . '</p>'
                . '<p><a href="' . e($link) . '" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Peržiūrėti</a></p>'
                . '<p style="color:#6b7280;font-size:12px">MailTrack Pro · pranešimus galite išjungti Nustatymuose</p></div>';
            Mailer::send($user['email'], $title, $html);
        }
        if (!empty($user['webhook_url']) && preg_match('#^https?://#', $user['webhook_url'])) {
            $r = http_post_json($user['webhook_url'], ['event' => $type, 'title' => $title, 'body' => $body, 'url' => $link, 'time' => gmdate('c')] + $payload, 4);
            if ($r['code'] < 200 || $r['code'] >= 300) {
                Logger::warning('Webhook nepavyko', ['url' => $user['webhook_url'], 'code' => $r['code'], 'err' => $r['error']]);
            }
        }
    }

    public static function telegram(string $chatId, string $html): bool
    {
        $token = (string)telegram_token();
        if ($token === '') {
            return false;
        }
        $r = http_post_json("https://api.telegram.org/bot$token/sendMessage", [
            'chat_id' => $chatId,
            'text' => $html,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
        ], 5);
        if ($r['code'] !== 200) {
            Logger::warning('Telegram siuntimas nepavyko', ['code' => $r['code'], 'resp' => substr($r['body'], 0, 300), 'err' => $r['error']]);
            return false;
        }
        return true;
    }
}
