<?php
/** Laiškų siuntimas: SMTP (Hostinger smtp.hostinger.com:465) arba PHP mail(). */
final class Mailer
{
    public static function send(string $to, string $subject, string $html): bool
    {
        $from = (string)cfg('mail.from_email', 'noreply@localhost');
        $fromName = (string)cfg('mail.from_name', 'MailTrack Pro');
        $smtp = cfg('mail.smtp', []);
        try {
            if (!empty($smtp['host'])) {
                self::smtpSend($smtp, $from, $fromName, $to, $subject, $html);
            } else {
                $headers = self::headers($from, $fromName, $to, $subject, false);
                if (!mail($to, self::encodeHeader($subject), self::body($html), $headers, '-f' . $from)) {
                    throw new RuntimeException('mail() grąžino false');
                }
            }
            Logger::info('Laiškas išsiųstas', ['to' => $to, 'subject' => $subject]);
            return true;
        } catch (Throwable $e) {
            Logger::error('Laiško siuntimo klaida: ' . $e->getMessage(), ['to' => $to, 'subject' => $subject]);
            return false;
        }
    }

    private static function encodeHeader(string $s): string
    {
        return preg_match('/[^\x20-\x7E]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
    }

    private static function headers(string $from, string $fromName, string $to, string $subject, bool $full): string
    {
        $h = [];
        if ($full) {
            $h[] = 'Date: ' . date('r');
            $h[] = 'To: <' . $to . '>';
            $h[] = 'Subject: ' . self::encodeHeader($subject);
            $h[] = 'Message-ID: <' . bin2hex(random_bytes(8)) . '@' . (explode('@', $from)[1] ?? 'localhost') . '>';
        }
        $h[] = 'From: ' . self::encodeHeader($fromName) . ' <' . $from . '>';
        $h[] = 'MIME-Version: 1.0';
        $h[] = 'Content-Type: text/html; charset=UTF-8';
        $h[] = 'Content-Transfer-Encoding: base64';
        return implode("\r\n", $h);
    }

    private static function body(string $html): string
    {
        return rtrim(chunk_split(base64_encode($html), 76, "\r\n"));
    }

    private static function smtpSend(array $s, string $from, string $fromName, string $to, string $subject, string $html): void
    {
        $enc = $s['encryption'] ?? 'ssl';
        $host = ($enc === 'ssl' ? 'ssl://' : 'tcp://') . $s['host'] . ':' . (int)($s['port'] ?? 465);
        $fp = @stream_socket_client($host, $errno, $errstr, 15);
        if (!$fp) {
            throw new RuntimeException("SMTP prisijungimas nepavyko: $errstr ($errno)");
        }
        stream_set_timeout($fp, 15);
        $read = function () use ($fp): string {
            $data = '';
            while (($line = fgets($fp, 515)) !== false) {
                $data .= $line;
                if (isset($line[3]) && $line[3] === ' ') {
                    break;
                }
            }
            return $data;
        };
        $cmd = function (string $c, array $ok) use ($fp, $read): string {
            if ($c !== '') {
                fwrite($fp, $c . "\r\n");
            }
            $resp = $read();
            if (!in_array((int)substr($resp, 0, 3), $ok, true)) {
                $safe = str_starts_with($c, 'AUTH') || strlen($c) > 60 ? '[slapta]' : $c;
                throw new RuntimeException("SMTP klaida po '$safe': " . trim($resp));
            }
            return $resp;
        };
        $ehloHost = parse_url((string)cfg('base_url'), PHP_URL_HOST) ?: 'localhost';
        $cmd('', [220]);
        $cmd('EHLO ' . $ehloHost, [250]);
        if ($enc === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new RuntimeException('STARTTLS nepavyko');
            }
            $cmd('EHLO ' . $ehloHost, [250]);
        }
        if (!empty($s['user'])) {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($s['user']), [334]);
            $cmd(base64_encode((string)$s['pass']), [235]);
        }
        $cmd('MAIL FROM:<' . $from . '>', [250]);
        $cmd('RCPT TO:<' . $to . '>', [250, 251]);
        $cmd('DATA', [354]);
        $msg = self::headers($from, $fromName, $to, $subject, true) . "\r\n\r\n" . self::body($html);
        $msg = str_replace("\r\n.", "\r\n..", $msg);
        $cmd($msg . "\r\n.", [250]);
        fwrite($fp, "QUIT\r\n");
        fclose($fp);
    }
}
