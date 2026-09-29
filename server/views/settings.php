<?php
$title = 'Nustatymai – MailTrack Pro';
$u = $GLOBALS['USER'];
$tzs = DateTimeZone::listIdentifiers();
?>
<h1>Nustatymai</h1>
<form method="post" action="<?= e(base_url('settings')) ?>">
<?= csrf_field() ?>
<div class="grid g2">
  <div class="card" style="margin:0">
    <h3 style="margin-top:0">Profilis</h3>
    <label>Vardas</label><input type="text" name="name" value="<?= e($u['name']) ?>">
    <label>Laiko juosta</label>
    <select name="timezone"><?php foreach ($tzs as $tz): ?><option <?= $tz === $u['timezone'] ? 'selected' : '' ?>><?= e($tz) ?></option><?php endforeach; ?></select>

    <h3>Savų atidarymų filtravimas</h3>
    <label>Ignoruoti atidarymus pirmas N sekundžių po išsiuntimo</label>
    <input type="number" name="ignore_seconds" min="0" max="600" value="<?= (int)$u['ignore_seconds'] ?>">
    <div class="help">Gmail iškart parodo išsiųstą laišką jums pačiam – tai nėra gavėjo atidarymas. Rekomenduojama 15–30 s.</div>
    <label class="chk"><input type="checkbox" name="auto_ignore_ips" <?= $u['auto_ignore_ips'] ? 'checked' : '' ?>> Automatiškai įsiminti mano IP adresus (iš skydelio ir plėtinio) ir jų atidarymų neskaičiuoti</label>
  </div>

  <div class="card" style="margin:0">
    <h3 style="margin-top:0">Pranešimai</h3>
    <label class="chk"><input type="checkbox" name="notify_email" <?= $u['notify_email'] ? 'checked' : '' ?>> El. paštu (<?= e($u['email']) ?>)</label>
    <label class="chk"><input type="checkbox" name="notify_telegram" <?= $u['notify_telegram'] ? 'checked' : '' ?>> Telegram (momentiniai pranešimai telefone)</label>
    <label class="chk"><input type="checkbox" name="notify_clicks" <?= $u['notify_clicks'] ? 'checked' : '' ?>> Pranešti apie nuorodų paspaudimus</label>
    <label>Kada pranešti apie atidarymą</label>
    <select name="notify_mode">
      <option value="first" <?= $u['notify_mode'] === 'first' ? 'selected' : '' ?>>Tik pirmą kartą</option>
      <option value="every" <?= $u['notify_mode'] === 'every' ? 'selected' : '' ?>>Kiekvieną kartą</option>
    </select>
    <label>Telegram chat ID</label>
    <input type="text" name="telegram_chat_id" value="<?= e($u['telegram_chat_id']) ?>" placeholder="123456789">
    <div class="help">Parašykite savo botui <code>/start</code> ir spauskite „Aptikti automatiškai“ žemiau.</div>
    <label>Webhook URL (Zapier, Make, n8n…)</label>
    <input type="url" name="webhook_url" value="<?= e($u['webhook_url']) ?>" placeholder="https://hooks.zapier.com/...">
    <label class="chk"><input type="checkbox" name="daily_report" <?= $u['daily_report'] ? 'checked' : '' ?>> Dienos ataskaita el. paštu</label>
    <label>Ataskaitos valanda</label>
    <input type="number" name="report_hour" min="0" max="23" value="<?= (int)$u['report_hour'] ?>">
  </div>
</div>
<p><button class="btn primary">Išsaugoti nustatymus</button></p>
</form>

<div class="grid g2">
  <div class="card" style="margin:0">
    <h3 style="margin-top:0">Telegram pranešimai telefone</h3>
    <?php $tgTok = telegram_token(); ?>
    <ol class="steps" style="font-size:12.5px;color:var(--muted);padding-left:18px">
      <li>Telegram programėlėje raskite <b>@BotFather</b> → <code>/newbot</code> → gausite boto raktą.</li>
      <li>Įklijuokite raktą žemiau ir išsaugokite.</li>
      <li>Raskite savo naują botą, paspauskite <b>START</b> (/start).</li>
      <li>Spauskite „Aptikti chat ID“ – gausite bandomąją žinutę.</li>
    </ol>
    <form method="post" action="<?= e(base_url('settings/telegram-token')) ?>">
      <?= csrf_field() ?>
      <label>Boto raktas</label>
      <input type="text" name="telegram_bot_token" value="<?= e($tgTok) ?>" placeholder="123456789:AAE...">
      <p><button class="btn">Išsaugoti raktą</button></p>
    </form>
    <?php if ($tgTok !== ''): ?>
      <div class="copy-box">
        <form method="post" action="<?= e(base_url('settings/telegram-detect')) ?>" class="inline"><?= csrf_field() ?><button class="btn primary">Aptikti chat ID</button></form>
        <form method="post" action="<?= e(base_url('settings/telegram-test')) ?>" class="inline"><?= csrf_field() ?><button class="btn">Siųsti bandomąją žinutę</button></form>
      </div>
      <p class="help">Būsena: raktas ✓ · chat ID: <?= $u['telegram_chat_id'] !== '' ? e($u['telegram_chat_id']) . ' ✓' : '<b style="color:var(--bad)">nenustatytas</b>' ?> · pranešimai: <?= $u['notify_telegram'] ? 'įjungti ✓ (pažymėkite „Telegram“ viršuje ir išsaugokite)' : '<b>išjungti – pažymėkite „Telegram“ pranešimų skiltyje ir išsaugokite</b>' ?></p>
    <?php else: ?>
      <p class="help">Raktą galite įrašyti ir čia, ir <code>config.php</code> faile (<code>telegram_bot_token</code>).</p>
    <?php endif; ?>

    <h3>API raktas (plėtiniui ir Gmail priedui)</h3>
    <div class="copy-box"><input type="text" readonly value="<?= e($u['api_key']) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div>
    <form method="post" action="<?= e(base_url('settings/apikey')) ?>" onsubmit="return confirm('Senas raktas nustos veikti. Tęsti?')" style="margin-top:8px"><?= csrf_field() ?><button class="btn sm danger">Generuoti naują raktą</button></form>

    <h3>Slaptažodis</h3>
    <form method="post" action="<?= e(base_url('settings/password')) ?>">
      <?= csrf_field() ?>
      <input type="password" name="current_password" placeholder="Dabartinis" required autocomplete="current-password">
      <input type="password" name="new_password" placeholder="Naujas (min. 8)" required style="margin-top:6px" autocomplete="new-password">
      <p><button class="btn">Keisti</button></p>
    </form>
  </div>

  <div class="card" style="margin:0">
    <h3 style="margin-top:0">Mano IP adresai (neskaičiuojami)</h3>
    <p class="help">Jūsų dabartinis IP: <code><?= e(client_ip()) ?></code></p>
    <table>
      <?php foreach ($ips as $ip): ?>
        <tr><td class="mono"><?= e($ip['ip']) ?></td><td class="recip"><?= e($ip['note']) ?> · <?= e(ago($ip['last_seen_at'])) ?></td>
          <td><form method="post" action="<?= e(base_url('settings/ip-delete')) ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="id" value="<?= (int)$ip['id'] ?>"><button class="btn sm">✕</button></form></td></tr>
      <?php endforeach; ?>
    </table>
    <form method="post" action="<?= e(base_url('settings/ip-add')) ?>" class="copy-box" style="margin-top:8px">
      <?= csrf_field() ?>
      <input type="text" name="ip" placeholder="IP adresas"><input type="text" name="note" placeholder="Pastaba"><button class="btn">Pridėti</button>
    </form>
  </div>
</div>
