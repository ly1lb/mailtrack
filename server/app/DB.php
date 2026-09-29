<?php
/** PDO apvalkalas (MySQL arba SQLite). Visos datos saugomos UTC 'Y-m-d H:i:s'. */
final class DB
{
    private static ?PDO $pdo = null;
    private static string $driver = 'mysql';

    public static function connect(array $cfg): PDO
    {
        if (self::$pdo) {
            return self::$pdo;
        }
        self::$driver = $cfg['driver'] ?? 'mysql';
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if (self::$driver === 'sqlite') {
            self::$pdo = new PDO('sqlite:' . $cfg['sqlite_path'], null, null, $opts);
            self::$pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        } else {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['host'], (int)($cfg['port'] ?? 3306), $cfg['name']);
            self::$pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], $opts);
            self::$pdo->exec("SET time_zone = '+00:00'");
        }
        return self::$pdo;
    }

    public static function pdo(): PDO
    {
        if (!self::$pdo) {
            throw new RuntimeException('DB neprijungta');
        }
        return self::$pdo;
    }

    public static function driver(): string
    {
        return self::$driver;
    }

    public static function query(string $sql, array $params = []): PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st;
    }

    public static function row(string $sql, array $params = []): ?array
    {
        $r = self::query($sql, $params)->fetch();
        return $r === false ? null : $r;
    }

    public static function all(string $sql, array $params = []): array
    {
        return self::query($sql, $params)->fetchAll();
    }

    public static function value(string $sql, array $params = [])
    {
        $v = self::query($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(',', $cols),
            implode(',', array_map(fn($c) => ':' . $c, $cols))
        );
        self::query($sql, $data);
        return (int)self::pdo()->lastInsertId();
    }

    public static function update(string $table, array $data, string $where, array $params = []): int
    {
        $set = implode(',', array_map(fn($c) => "$c = :set_$c", array_keys($data)));
        $bind = [];
        foreach ($data as $k => $v) {
            $bind['set_' . $k] = $v;
        }
        return self::query("UPDATE $table SET $set WHERE $where", $bind + $params)->rowCount();
    }

    /** Vykdo schemos SQL failą (sakiniai atskirti ";" eilutės gale). */
    public static function runSchema(string $file): void
    {
        $sql = preg_replace('/^--.*$/m', '', file_get_contents($file));
        foreach (preg_split('/;\s*$/m', $sql) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt !== '') {
                self::pdo()->exec($stmt);
            }
        }
    }
}
