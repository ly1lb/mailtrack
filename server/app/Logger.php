<?php
/**
 * Paprastas failų žurnalas diagnostikai.
 * Rašo į data/logs/app-YYYY-MM-DD.log eilutėmis:
 * 2026-09-29 12:00:00 [ERROR] [req:ab12cd] [ip:1.2.3.4] [GET /o/xxx.gif] Žinutė {"kontekstas":...}
 */
final class Logger
{
    private const LEVELS = ['debug' => 0, 'info' => 1, 'warning' => 2, 'error' => 3];

    private static string $dir = '';
    private static int $minLevel = 1;
    private static string $requestId = '';

    public static function init(string $dir, string $level = 'info'): void
    {
        self::$dir = rtrim($dir, '/');
        self::$minLevel = self::LEVELS[strtolower($level)] ?? 1;
        self::$requestId = substr(bin2hex(random_bytes(4)), 0, 8);
        if (!is_dir(self::$dir)) {
            @mkdir(self::$dir, 0755, true);
        }
    }

    public static function requestId(): string
    {
        return self::$requestId;
    }

    public static function dir(): string
    {
        return self::$dir;
    }

    public static function debug(string $msg, array $ctx = []): void { self::write('debug', $msg, $ctx); }
    public static function info(string $msg, array $ctx = []): void { self::write('info', $msg, $ctx); }
    public static function warning(string $msg, array $ctx = []): void { self::write('warning', $msg, $ctx); }
    public static function error(string $msg, array $ctx = []): void { self::write('error', $msg, $ctx); }

    public static function write(string $level, string $msg, array $ctx = []): void
    {
        $level = strtolower($level);
        if (!isset(self::LEVELS[$level])) {
            $level = 'info';
        }
        if (self::LEVELS[$level] < self::$minLevel || self::$dir === '') {
            return;
        }
        $req = PHP_SAPI === 'cli'
            ? 'CLI ' . implode(' ', array_slice($_SERVER['argv'] ?? [], 0, 3))
            : ($_SERVER['REQUEST_METHOD'] ?? '?') . ' ' . substr($_SERVER['REQUEST_URI'] ?? '', 0, 200);
        $ip = $_SERVER['REMOTE_ADDR'] ?? '-';
        $line = sprintf(
            "%s [%s] [req:%s] [ip:%s] [%s] %s%s\n",
            gmdate('Y-m-d H:i:s'),
            strtoupper($level),
            self::$requestId,
            $ip,
            $req,
            str_replace(["\r", "\n"], ' ', $msg),
            $ctx ? ' ' . json_encode($ctx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR) : ''
        );
        // Apsauga nuo disko užpildymo (pvz. neautentifikuotas /api/log srautas):
        // jei dienos žurnalas viršija ~25 MB, nustojam rašyti (klaidos vis tiek
        // matomos, o diskas neužsipildo). Tikrinam retai – kas ~100 įrašų.
        $file = self::$dir . '/app-' . gmdate('Y-m-d') . '.log';
        static $writes = 0;
        if ((++$writes % 100) === 1 && is_file($file) && filesize($file) > 25 * 1024 * 1024) {
            return;
        }
        @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
    }

    /** PHP klaidų, išimčių ir fatal klaidų gaudymas. */
    public static function registerHandlers(bool $display = false): void
    {
        set_error_handler(function (int $no, string $str, string $file, int $line): bool {
            if (!(error_reporting() & $no)) {
                return false;
            }
            $lvl = in_array($no, [E_WARNING, E_USER_WARNING, E_NOTICE, E_USER_NOTICE, E_DEPRECATED, E_USER_DEPRECATED], true)
                ? 'warning' : 'error';
            self::write($lvl, "PHP: $str", ['file' => $file, 'line' => $line, 'errno' => $no]);
            return true;
        });

        set_exception_handler(function (Throwable $e) use ($display): void {
            self::error('Nepagauta išimtis: ' . $e->getMessage(), [
                'type' => get_class($e),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => array_slice(explode("\n", $e->getTraceAsString()), 0, 8),
            ]);
            if (PHP_SAPI !== 'cli' && !headers_sent()) {
                http_response_code(500);
            }
            if (PHP_SAPI === 'cli') {
                fwrite(STDERR, $e->getMessage() . "\n");
                return;
            }
            echo $display
                ? '<pre>' . htmlspecialchars((string)$e) . '</pre>'
                : '<h1>Serverio klaida</h1><p>Klaidos ID: <code>' . self::$requestId . '</code>. Detalės – žurnale (Žurnalai).</p>';
        });

        register_shutdown_function(function (): void {
            $err = error_get_last();
            if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
                self::error('FATAL: ' . $err['message'], ['file' => $err['file'], 'line' => $err['line']]);
            }
        });
    }

    /** @return string[] žurnalų failų vardai, naujausi pirmi */
    public static function files(): array
    {
        $files = glob(self::$dir . '/*.log') ?: [];
        $names = array_map('basename', $files);
        rsort($names);
        return $names;
    }

    /** Išvalo senesnius nei $days dienų žurnalus. */
    public static function cleanup(int $days): int
    {
        $n = 0;
        foreach (glob(self::$dir . '/*.log') ?: [] as $f) {
            if (filemtime($f) < time() - $days * 86400) {
                @unlink($f);
                $n++;
            }
        }
        return $n;
    }
}
