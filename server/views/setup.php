<?php
$title = 'Įdiegimas – MailTrack Pro';
$u = $GLOBALS['USER'];
$base = rtrim((string)cfg('base_url'), '/');
?>
<h1>Įdiegimas: kompiuteris ir telefonas</h1>

<div class="card">
  <h3 style="margin-top:0">Jūsų prisijungimo duomenys plėtiniui ir Gmail priedui</h3>
  <label>Serverio adresas</label>
  <div class="copy-box"><input type="text" readonly value="<?= e($base) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div>
  <label>API raktas</label>
  <div class="copy-box"><input type="text" readonly value="<?= e($u['api_key']) ?>"><button class="btn sm" data-copy>Kopijuoti</button></div>
</div>

<div class="card">
  <h2 style="margin-top:0">💻 Kompiuteris: Chrome plėtinys (Gmail naršyklėje)</h2>
  <p>Veikia kaip Mailtrack: automatiškai įdeda sekimo pikselį ir perrašo nuorodas kiekviename išsiunčiamame laiške, rodo ✓/✓✓ išsiųstų laiškų sąraše, blokuoja jūsų pačių atidarymus ir rodo darbalaukio pranešimus.</p>
  <ol class="steps">
    <li>Atsisiųskite <a href="<?= e(base_url('downloads/chrome-extension.zip')) ?>">chrome-extension.zip</a> ir išarchyvuokite į pastovų aplanką.</li>
    <li>Chrome atidarykite <code>chrome://extensions</code>, įjunkite <b>Developer mode</b> (dešinėje viršuje).</li>
    <li>Spauskite <b>Load unpacked</b> ir pasirinkite išarchyvuotą aplanką.</li>
    <li>Plėtinio nustatymuose įveskite serverio adresą ir API raktą, spauskite <b>Išsaugoti ir patikrinti</b>.</li>
    <li>Perkraukite Gmail. Rašymo lange šalia „Siųsti“ matysite <b>✓✓ Sekti</b> jungiklį.</li>
  </ol>
  <p class="help">Veikia ir Edge, Brave, Opera (Chromium naršyklėse).</p>
</div>

<div class="card" id="mobile">
  <h2 style="margin-top:0">📱 Telefonas: Gmail priedas („Insert from MailTrack“)</h2>
  <p>Gmail programėlėje (Android ir iPhone) plėtiniai neveikia, todėl – kaip ir Mailtrack – naudojamas <b>Gmail priedas (Google Workspace Add-on)</b>.
    Rašydami laišką telefone paspaudžiate priedo ikonėlę apačioje → <b>Įterpti sekimą</b>, ir pikselis įdedamas į laišką.</p>
  <ol class="steps">
    <li>Kompiuteryje atidarykite <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> → <b>Naujas projektas</b> (prisijungę su tuo pačiu Gmail).</li>
    <li>Projekto nustatymuose (⚙) pažymėkite <b>Show "appsscript.json" manifest file</b>.</li>
    <li>Įklijuokite <a href="<?= e(base_url('downloads/gmail-addon/Code.gs')) ?>">Code.gs</a> ir <a href="<?= e(base_url('downloads/gmail-addon/appsscript.json')) ?>">appsscript.json</a> turinį.
      <b>appsscript.json</b> faile pakeiskite <code>https://track.example.com</code> į <code><?= e($base) ?></code> (2 vietose).</li>
    <li><b>Deploy → Test deployments → Install</b>. Kodo pakeitimai įsigalioja juos išsaugojus (Ctrl+S) – iš naujo diegti nereikia.</li>
    <li>Atidarykite Gmail kompiuteryje, dešiniajame šoniniame skydelyje paspauskite priedo ikoną → <b>Authorize access</b>.
      Įspėjime „Google hasn't verified this app“ spauskite <b>Advanced → Go to MailTrack Pro (unsafe) → Allow</b> (tai jūsų pačių skriptas).
      Tada įveskite serverio adresą ir API raktą → <b>Išsaugoti ir patikrinti</b>.</li>
    <li>Dabar telefone Gmail programėlėje: rašydami laišką spauskite <b>⋮</b> arba priedų juostą apačioje → <b>MailTrack Pro</b> → <b>Įterpti sekimą</b>, atsidariusioje kortelėje – mygtuką <b>✓✓ Įterpti sekimą</b>. Toje pačioje kortelėje galite įterpti ir <b>sekamą nuorodą</b>.</li>
    <li>Atidarę išsiųstą laišką telefone, priedo kortelėje matysite jo atidarymų statistiką.</li>
  </ol>
  <p class="help">Patarimas: sekimą įterpkite paskutinį, kai tema ir gavėjai jau įvesti – tada jie iškart matysis skydelyje.</p>
</div>

<div class="card">
  <h2 style="margin-top:0">🔔 Pranešimai telefone</h2>
  <ul class="steps">
    <li><b>Telegram</b> (rekomenduojama – momentiniai push pranešimai): sukurkite botą per @BotFather, raktą įrašykite į <code>config.php</code>, tada <a href="<?= e(base_url('settings')) ?>">Nustatymuose</a> – „Aptikti chat ID“.</li>
    <li><b>Skydelis kaip programėlė:</b> telefono naršyklėje atidarykite <?= e($base) ?> → „Pridėti prie pagrindinio ekrano“.</li>
    <li><b>El. pašto pranešimai</b> ir <b>dienos ataskaita</b> – įjungiami Nustatymuose.</li>
  </ul>
</div>

<div class="card">
  <h2 style="margin-top:0">✉️ Be plėtinio (kiti klientai / Outlook)</h2>
  <p><a href="<?= e(base_url('new')) ?>">Naujas sekamas laiškas</a> sugeneruoja pikselį ir sekamas nuorodas, kurias galima įklijuoti į bet kurį pašto klientą.</p>
</div>
