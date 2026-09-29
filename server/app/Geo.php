<?php
/** IP geolokacija per ip-api.com su talpykla DB (30 d.). */
final class Geo
{
    /** @return array{country:string,city:string} */
    public static function lookup(string $ip): array
    {
        $empty = ['country' => '', 'city' => ''];
        if (!cfg('geo_enabled', true) || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $empty;
        }
        try {
            $row = DB::row('SELECT country, city, created_at FROM geo_cache WHERE ip = ?', [$ip]);
            if ($row && strtotime($row['created_at'] . ' UTC') > time() - 30 * 86400) {
                return ['country' => $row['country'], 'city' => $row['city']];
            }
            if (!function_exists('curl_init')) {
                return $empty;
            }
            $ch = curl_init('http://ip-api.com/json/' . rawurlencode($ip) . '?fields=status,message,country,city&lang=en');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2]);
            $body = curl_exec($ch);
            $err = curl_error($ch);
            curl_close($ch);
            $d = json_decode((string)$body, true);
            if (!is_array($d) || ($d['status'] ?? '') !== 'success') {
                Logger::warning('Geo paieška nepavyko', ['ip' => $ip, 'err' => $err ?: ($d['message'] ?? 'bad response')]);
                return $empty;
            }
            $res = ['country' => (string)($d['country'] ?? ''), 'city' => (string)($d['city'] ?? '')];
            DB::query('DELETE FROM geo_cache WHERE ip = ?', [$ip]);
            DB::insert('geo_cache', ['ip' => $ip, 'country' => $res['country'], 'city' => $res['city'], 'created_at' => now()]);
            return $res;
        } catch (Throwable $e) {
            Logger::warning('Geo klaida: ' . $e->getMessage(), ['ip' => $ip]);
            return $empty;
        }
    }
}
