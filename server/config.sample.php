<?php
/**
 * MailTrack Pro – konfigūracija.
 *
 * Šį failą sukuria install.php automatiškai (config.php).
 * Jei norite konfigūruoti rankiniu būdu: nukopijuokite į config.php ir užpildykite.
 */
return [
    // Pilnas subdomeno adresas BE galinio "/" (pvz. https://track.jusudomenas.lt)
    'base_url' => 'https://track.example.com',

    // Duomenų bazė: 'mysql' (rekomenduojama Hostinger) arba 'sqlite'
    'db' => [
        'driver'   => 'mysql',
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => 'u123456789_mailtrack',
        'user'     => 'u123456789_mailtrack',
        'pass'     => '',
        'sqlite_path' => __DIR__ . '/data/mailtrack.sqlite',
    ],

    // Atsitiktinė ilga eilutė (naudojama parašams ir sesijoms)
    'app_secret' => 'PAKEISKITE-I-ILGA-ATSITIKTINE-EILUTE',

    // Numatytoji laiko juosta rodymui
    'timezone' => 'Europe/Vilnius',

    // Žurnalai: debug | info | warning | error
    'log_level' => 'info',
    'log_keep_days' => 30,

    // Geolokacija pagal IP (ip-api.com, nemokama, be rakto)
    'geo_enabled' => true,

    // Jei svetainė už Cloudflare / proxy – imti IP iš X-Forwarded-For / CF-Connecting-IP
    'trust_proxy_headers' => false,

    // Laiškų siuntimas (pranešimai, dienos ataskaitos). Jei smtp.host tuščias – naudojamas PHP mail()
    'mail' => [
        'from_email' => 'track@example.com',
        'from_name'  => 'MailTrack Pro',
        'smtp' => [
            'host'       => 'smtp.hostinger.com',
            'port'       => 465,
            'encryption' => 'ssl',   // ssl | tls | none
            'user'       => 'track@example.com',
            'pass'       => '',
        ],
    ],

    // Telegram botas momentiniams pranešimams telefone (neprivaloma)
    'telegram_bot_token' => '',

    // Raktas cron.php paleidimui per HTTP (jei nenaudojate CLI cron)
    'cron_key' => 'PAKEISKITE',

    // Dokumentų (PDF) sekimo įkėlimų limitas MB
    'max_upload_mb' => 20,
];
