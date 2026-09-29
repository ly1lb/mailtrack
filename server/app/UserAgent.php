<?php
/** Paprastas User-Agent analizatorius: el. pašto klientas / naršyklė, įrenginys, OS, tarpinis serveris (proxy). */
final class UserAgent
{
    /** @return array{client:string,device:string,os:string,proxy:string,bot:bool} */
    public static function parse(string $ua): array
    {
        $r = ['client' => 'Nežinomas', 'device' => 'Kompiuteris', 'os' => '', 'proxy' => '', 'bot' => false];

        // El. pašto paslaugų paveikslėlių tarpiniai serveriai
        if (stripos($ua, 'GoogleImageProxy') !== false || stripos($ua, 'ggpht.com') !== false) {
            return ['client' => 'Gmail', 'device' => 'Nežinomas', 'os' => '', 'proxy' => 'Gmail (Google Image Proxy)', 'bot' => false];
        }
        if (stripos($ua, 'YahooMailProxy') !== false) {
            return ['client' => 'Yahoo Mail', 'device' => 'Nežinomas', 'os' => '', 'proxy' => 'Yahoo Mail Proxy', 'bot' => false];
        }
        if (preg_match('/Outlook-iOS|Outlook-Android/i', $ua)) {
            $r['client'] = 'Outlook mobile';
        } elseif (stripos($ua, 'Microsoft Outlook') !== false || stripos($ua, 'ms-office') !== false || stripos($ua, 'MSOffice') !== false) {
            $r['client'] = 'Outlook';
        } elseif (stripos($ua, 'Thunderbird') !== false) {
            $r['client'] = 'Thunderbird';
        } elseif (preg_match('/Edg\//', $ua)) {
            $r['client'] = 'Edge';
        } elseif (preg_match('/OPR\/|Opera/', $ua)) {
            $r['client'] = 'Opera';
        } elseif (preg_match('/Firefox\//', $ua)) {
            $r['client'] = 'Firefox';
        } elseif (preg_match('/Chrome\//', $ua)) {
            $r['client'] = 'Chrome';
        } elseif (preg_match('/Safari\//', $ua)) {
            $r['client'] = 'Safari';
        } elseif (preg_match('/AppleWebKit/', $ua) && preg_match('/Macintosh|iPhone|iPad/', $ua)) {
            // Apple Mail nesiunčia "Safari/" žymės
            $r['client'] = 'Apple Mail';
        }

        if (preg_match('/iPad|Tablet/i', $ua) || (stripos($ua, 'Android') !== false && stripos($ua, 'Mobile') === false)) {
            $r['device'] = 'Planšetė';
        } elseif (preg_match('/Mobile|iPhone|Android/i', $ua)) {
            $r['device'] = 'Telefonas';
        }

        if (preg_match('/Windows NT/i', $ua)) $r['os'] = 'Windows';
        elseif (preg_match('/iPhone|iPad|iOS/i', $ua)) $r['os'] = 'iOS';
        elseif (preg_match('/Mac OS X|Macintosh/i', $ua)) $r['os'] = 'macOS';
        elseif (preg_match('/Android/i', $ua)) $r['os'] = 'Android';
        elseif (preg_match('/CrOS/i', $ua)) $r['os'] = 'ChromeOS';
        elseif (preg_match('/Linux/i', $ua)) $r['os'] = 'Linux';

        // Saugumo skeneriai / botai, kurie "atidaro" laiškus ar nuorodas automatiškai
        if ($ua === '' || preg_match('/bot|crawler|spider|Barracuda|Mimecast|Proofpoint|urldefense|SafeLinks|Symantec|Forcepoint|Sophos|Trend ?Micro|MessageLabs|python-requests|curl\/|Wget|Go-http-client|HeadlessChrome|preview|facebookexternalhit|Slackbot|WhatsApp|TelegramBot|Discordbot|Microsoft Office Protocol Discovery|YahooCacheSystem/i', $ua)) {
            $r['bot'] = true;
        }
        return $r;
    }
}
