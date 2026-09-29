# MailTrack Pro – savas el. laiškų sekimas („self-hosted“ Mailtrack)

Pilnas Gmail laiškų sekimo servisas jūsų subdomene (Hostinger) su visomis
premium funkcijomis, kokias siūlo Mailtrack, Mailsuite, Streak, HubSpot Sales,
Yesware ir kt. – tik duomenys lieka **jūsų serveryje**, be mėnesinio mokesčio.

Sudedamosios dalys:

| Aplankas | Kas tai |
|----------|---------|
| `server/` | PHP + HTML servisas (sekimo pikselis, valdymo skydelis, API, žurnalai). Keliamas per FTP į subdomeną. |
| `chrome-extension/` | Chrome/Edge/Brave plėtinys Gmail'ui **kompiuteryje** (kaip Mailtrack – automatinis pikselis, ✓/✓✓, pranešimai). |
| `gmail-addon/` | Google Workspace priedas Gmail'ui **telefone ir kompiuteryje** (atitinka Mailtrack „Insert from Mailtrack“ mygtuką telefone). |

---

## Funkcijų palyginimas su Mailtrack ir premium konkurentais

| Funkcija | Mailtrack Free | Mailtrack Pro/Premium | Streak / Yesware | **MailTrack Pro (šis)** |
|---|:---:|:---:|:---:|:---:|
| Atidarymo sekimas (pikselis) | ✅ | ✅ | ✅ | ✅ |
| Dvigubas ✓✓ ženklas Gmail'e | ✅ | ✅ | – | ✅ |
| Be „Sent via Mailtrack“ parašo | ❌ | ✅ | ✅ | ✅ (niekada nededa) |
| Realaus laiko pranešimai | ✅ | ✅ | ✅ | ✅ (naršyklė/Telegram/el.paštas) |
| Kiek kartų atidaryta | dalinai | ✅ | ✅ | ✅ |
| Nuorodų paspaudimų sekimas | ❌ | ✅ | ✅ | ✅ (HMAC pasirašyta) |
| Priminimai / follow-up | ❌ | ✅ | ✅ | ✅ (jei neatidaryta/nepaspausta) |
| Dienos ataskaitos | ❌ | ✅ | ✅ | ✅ |
| Dokumentų (PDF) sekimas | ❌ | ✅ (Mailsuite) | ✅ | ✅ |
| Įrenginys / vieta / OS | ❌ | dalinai | ✅ | ✅ (kai ne per proxy) |
| Savų atidarymų filtravimas | ✅ | ✅ | ✅ | ✅ (IP + laiko langas + plėtinys) |
| Botų/skenerių atmetimas | dalinai | ✅ | ✅ | ✅ |
| Telefonas (Gmail app) | ✅ (priedas) | ✅ | dalinai | ✅ (Gmail priedas) |
| CSV eksportas | ❌ | ✅ | ✅ | ✅ |
| Laiškų šablonai | ❌ | ✅ | ✅ | ✅ (skydelis + Gmail + telefonas) |
| Suplanuoti priminimai/follow-up | ❌ | ✅ | ✅ | ✅ |
| Suplanuotas siuntimas (send later) | ✅ (Gmail) | ✅ | ✅ | ✅ (per Gmail, sekimas veikia) |
| Webhook / Zapier | ❌ | ❌ | dalinai | ✅ |
| Duomenys jūsų nuosavybėje | ❌ | ❌ | ❌ | ✅ |
| Kaina | 0 | €4–10/mėn | €15–50/mėn | serverio kaina |

Kaip veikia „tikslumo“ premium funkcijos (kaip ir pas Mailtrack):
- **Gmail gavėjai** atidaro paveikslėlius per Google Image Proxy, todėl tiksli
  vieta ir įrenginys paslepiami – rodoma „per Gmail proxy“. Tai galioja visiems
  sekikliams, įskaitant Mailtrack. Kitų klientų (Apple Mail, Outlook desktop)
  atidarymuose vieta/įrenginys matomi.
- **Nuorodų sekimas** ir **dokumentų sekimas** vietos/įrenginio Gmail proxy
  neslepia (spaudžia pats gavėjas) – tad ten duomenys tikslūs.

---

## Diegimas Hostingeryje (subdomenas)

1. **Subdomenas:** hPanel → *Domains → Subdomains* → sukurkite pvz.
   `track.jusudomenas.lt`. Įsidėmėkite jo aplanką (pvz.
   `/domains/jusudomenas.lt/public_html/track` arba atskiras `public_html`).
2. **PHP 8.0+**: hPanel → *Advanced → PHP Configuration* → parinkite 8.1/8.2/8.3.
   Įsitikinkite, kad įjungti `pdo_mysql`, `curl`, `mbstring`, `openssl`, `gd`.
3. **Duomenų bazė (rekomenduojama MySQL):** hPanel → *Databases → MySQL Databases*
   → sukurkite DB ir vartotoją, priskirkite visas teises. (Arba pasirinkite SQLite
   – tada DB kurti nereikia.)
4. **Įkelkite failus per FTP:** viską iš aplanko `server/` sudėkite į subdomeno
   šakninį aplanką. Svarbu, kad `.htaccess` failas taip pat būtų įkeltas
   (FTP klientuose įjunkite paslėptų failų rodymą).
5. **Teisės:** aplankui `data/` (ir `data/logs`, `data/uploads`) nustatykite
   `755` (jei neveikia rašymas – `775`).
6. **Diegimo vedlys:** naršyklėje atidarykite
   `https://track.jusudomenas.lt/install.php` ir užpildykite formą
   (adresas, DB, administratorius, SMTP). Baigę **ištrinkite `install.php`**.
7. **Cron (priminimai, ataskaitos):** hPanel → *Advanced → Cron Jobs*, kas 5 min.:
   ```
   /usr/bin/php /home/uXXXX/domains/jusudomenas.lt/public_html/track/cron.php
   ```
   (tikslų kelią rasite skydelio *Diagnostika* puslapyje).
8. Prisijunkite prie skydelio → **Diagnostika**: visos patikros turi būti žalios.

## Kompiuteris – Chrome plėtinys
Skydelis → **Įdiegimas** → atsisiųskite `chrome-extension.zip`, `chrome://extensions`
→ *Developer mode* → *Load unpacked*. Nustatymuose įveskite serverio adresą ir API raktą.

## Telefonas – Gmail priedas
Skydelis → **Įdiegimas → 📱 Telefonas** turi žingsnius. Trumpai: sukurkite
Apps Script projektą, įklijuokite `gmail-addon/Code.gs` ir `appsscript.json`
(pakeitę serverio adresą), *Deploy → Test deployments → Install*. Telefone Gmail
app'e rašydami laišką spauskite priedą → **Įterpti sekimą**.

## Pranešimai telefone (push)
Geriausia – **Telegram**: @BotFather sukurkite botą, raktą įrašykite į `config.php`
(`telegram_bot_token`), skydelio *Nustatymuose* spauskite „Aptikti chat ID“.

---

## Diagnostika ir klaidų žurnalai
- **Skydelis → Žurnalai**: visos klaidos, įspėjimai ir įvykiai (filtruojama pagal
  lygį, paiešką; atsisiunčiama). Kiekviena užklausa turi `req:ID`.
- **Skydelis → Diagnostika**: serverio patikros, testiniai laiškas/Telegram/pikselis,
  klaidų skaičius.
- Klientinės klaidos (plėtinio ir priedo) taip pat siunčiamos į serverio žurnalą
  (`/api/log`), tad viską matote vienoje vietoje.
- Žurnalo detalumas: `config.php` → `log_level` (`debug` = daugiausiai).

## Saugumas
- Slaptažodžiai – `password_hash` (bcrypt). Sesijos – HttpOnly, SameSite=Lax.
- CSRF apsauga visose formose; prisijungimo bandymų ribojimas.
- Nuorodų peradresavimas pasirašomas HMAC-SHA256 (be atviro nukreipimo spragos).
- `app/`, `views/`, `data/`, `config.php` uždrausti per `.htaccess` (+ atskiri
  `.htaccess`).
- Po diegimo būtinai ištrinkite `install.php`.

## Vietinis testavimas (kūrėjams)
```
cd server
cp config.sample.php config.php   # arba paleiskite install.php
php -S 127.0.0.1:8765 index.php
```
