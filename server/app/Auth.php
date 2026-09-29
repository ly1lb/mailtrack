<?php
/** Autentifikacija: sesija (skydelis) ir API raktas (plėtinys, Gmail priedas). */
final class Auth
{
    private static array $cache = [];

    public static function userById(int $id): ?array
    {
        if (!array_key_exists($id, self::$cache)) {
            self::$cache[$id] = DB::row('SELECT * FROM users WHERE id = ?', [$id]);
        }
        return self::$cache[$id];
    }

    public static function forget(int $id): void
    {
        unset(self::$cache[$id]);
    }

    public static function user(): ?array
    {
        $id = (int)($_SESSION['uid'] ?? 0);
        return $id ? self::userById($id) : null;
    }

    public static function requireLogin(): array
    {
        $u = self::user();
        if (!$u) {
            $_SESSION['after_login'] = $_SERVER['REQUEST_URI'] ?? '/';
            redirect('login');
        }
        self::rememberIp($u);
        return $u;
    }

    public static function requireAdmin(): array
    {
        $u = self::requireLogin();
        if ($u['role'] !== 'admin') {
            http_response_code(403);
            exit('Tik administratoriui.');
        }
        return $u;
    }

    /** API vartotojas pagal X-Api-Key antraštę arba ?key= (Gmail priedui / pikselio testams). */
    public static function apiUser(): ?array
    {
        $key = $_SERVER['HTTP_X_API_KEY'] ?? ($_GET['key'] ?? '');
        if (is_string($key) && strlen($key) >= 20) {
            $u = DB::row('SELECT * FROM users WHERE api_key = ?', [$key]);
            if ($u) {
                self::$cache[(int)$u['id']] = $u;
                return $u;
            }
            Logger::warning('Neteisingas API raktas', ['key_prefix' => substr($key, 0, 6)]);
            return null;
        }
        return self::user();
    }

    public static function tooManyAttempts(string $ip): bool
    {
        $n = (int)DB::value('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND created_at >= ?', [$ip, gmdate('Y-m-d H:i:s', time() - 900)]);
        return $n >= 8;
    }

    public static function attempt(string $email, string $password): ?array
    {
        $ip = client_ip();
        $u = DB::row('SELECT * FROM users WHERE email = ?', [mb_strtolower(trim($email))]);
        if (!$u || !password_verify($password, $u['password_hash'])) {
            DB::insert('login_attempts', ['ip' => $ip, 'email' => mb_substr($email, 0, 190), 'created_at' => now()]);
            Logger::warning('Nesėkmingas prisijungimas', ['email' => $email]);
            return null;
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        DB::update('users', ['last_login_at' => now()], 'id = :id', ['id' => $u['id']]);
        DB::query('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        Logger::info('Prisijungė', ['user' => $u['id']]);
        return $u;
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    /** Įsimena vartotojo IP, kad jo paties atidarymai (ne per Gmail proxy) nebūtų skaičiuojami. */
    public static function rememberIp(array $u, string $note = 'Skydelis'): void
    {
        if (empty($u['auto_ignore_ips'])) {
            return;
        }
        $ip = client_ip();
        if (!filter_var($ip, FILTER_VALIDATE_IP)) {
            return;
        }
        try {
            $row = DB::row('SELECT id, last_seen_at FROM user_ips WHERE user_id = ? AND ip = ?', [$u['id'], $ip]);
            if ($row) {
                if (strtotime($row['last_seen_at'] . ' UTC') < time() - 3600) {
                    DB::update('user_ips', ['last_seen_at' => now()], 'id = :id', ['id' => $row['id']]);
                }
            } else {
                DB::insert('user_ips', ['user_id' => $u['id'], 'ip' => $ip, 'note' => $note, 'created_at' => now(), 'last_seen_at' => now()]);
                Logger::info('Įsimintas vartotojo IP', ['user' => $u['id'], 'ip' => $ip, 'note' => $note]);
            }
        } catch (Throwable $e) {
            Logger::warning('Nepavyko įsiminti IP: ' . $e->getMessage());
        }
    }

    public static function createUser(string $email, string $password, string $name = '', string $role = 'user'): int
    {
        return DB::insert('users', [
            'email' => mb_strtolower(trim($email)),
            'name' => $name,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => $role,
            'api_key' => bin2hex(random_bytes(20)),
            'link_secret' => bin2hex(random_bytes(16)),
            'timezone' => (string)cfg('timezone', 'Europe/Vilnius'),
            'created_at' => now(),
        ]);
    }
}
