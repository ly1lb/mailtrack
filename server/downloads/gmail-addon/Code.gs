/**
 * MailTrack Pro – Gmail priedas (Google Workspace Add-on).
 * Veikia telefone (Gmail programėlėje) ir kompiuteryje.
 *
 * NUSTATYMAS: pakeiskite SERVER_URL žemiau į savo subdomeną, ir tą patį adresą
 * įrašykite appsscript.json (urlFetchWhitelist ir logoUrl).
 * API raktą vartotojas įveda pačiame priede (išsaugomas UserProperties).
 */

var SERVER_URL = 'https://track.example.com'; // <-- PAKEISKITE

// ---------- Pagalbinės ----------
function props() { return PropertiesService.getUserProperties(); }
function getApiKey() { return props().getProperty('apiKey') || ''; }
function server() { return (props().getProperty('serverUrl') || SERVER_URL).replace(/\/+$/, ''); }

function api(method, path, payload) {
  var key = getApiKey();
  if (!key) throw new Error('Neįvestas API raktas.');
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: { 'X-Api-Key': key },
    contentType: 'application/json'
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(server() + '/api/' + path, opts);
  var code = res.getResponseCode();
  var body = res.getContentText();
  var data;
  try { data = JSON.parse(body); } catch (e) { data = null; }
  if (code < 200 || code >= 300 || !data || data.ok === false) {
    logRemote('warning', 'API ' + path + ' HTTP ' + code + ' ' + (data && data.error ? data.error : body.slice(0, 120)));
    throw new Error((data && data.error) ? data.error : ('Serveris grąžino ' + code));
  }
  return data;
}

/** Klientinių klaidų žurnalas serveryje – kad matytumėte diagnostiką ir dėl priedo. */
function logRemote(level, message, context) {
  try {
    UrlFetchApp.fetch(server() + '/api/log', {
      method: 'post', muteHttpExceptions: true,
      headers: { 'X-Api-Key': getApiKey() },
      contentType: 'application/json',
      payload: JSON.stringify({ level: level, message: message, context: context || null, source: 'gmail-priedas' })
    });
  } catch (e) { /* nutylim */ }
}

function uidGen() {
  var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '';
  for (var i = 0; i < 22; i++) s += a.charAt(Math.floor(Math.random() * 62));
  return s;
}

// ---------- Pagrindinis puslapis / nustatymai ----------
function onHomepage(e) {
  if (!getApiKey()) return settingsCard('Sveiki! Pirmiausia įveskite API raktą.');
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('MailTrack Pro').setSubtitle('Prisijungta: ' + (props().getProperty('email') || '')));
  var section = CardService.newCardSection();
  section.addWidget(CardService.newTextParagraph().setText(
    'Rašydami laišką paspauskite priedo veiksmą <b>„Įterpti sekimą“</b>, kad įdėtumėte sekimo pikselį.<br><br>' +
    'Atidarę gautą ar išsiųstą laišką matysite jo atidarymų statistiką.'));
  section.addWidget(CardService.newTextButton()
    .setText('Atidaryti skydelį')
    .setOpenLink(CardService.newOpenLink().setUrl(server())));
  section.addWidget(CardService.newTextButton().setText('Nustatymai')
    .setOnClickAction(CardService.newAction().setFunctionName('showSettings')));
  card.addSection(section);
  return card.build();
}

function showSettings() { return settingsCard(''); }

function settingsCard(note) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('MailTrack Pro – nustatymai'));
  var s = CardService.newCardSection();
  if (note) s.addWidget(CardService.newTextParagraph().setText('<b>' + note + '</b>'));
  s.addWidget(CardService.newTextInput().setFieldName('serverUrl').setTitle('Serverio adresas')
    .setHint('https://track.jusudomenas.lt').setValue(props().getProperty('serverUrl') || SERVER_URL));
  s.addWidget(CardService.newTextInput().setFieldName('apiKey').setTitle('API raktas')
    .setHint('Iš skydelio → Įdiegimas').setValue(getApiKey()));
  s.addWidget(CardService.newTextButton().setText('Išsaugoti ir patikrinti')
    .setOnClickAction(CardService.newAction().setFunctionName('saveSettings')));
  card.addSection(s);
  return card.build();
}

function saveSettings(e) {
  var f = e.commonEventObject.formInputs || {};
  var url = (f.serverUrl && f.serverUrl.stringInputs.value[0] || '').trim().replace(/\/+$/, '');
  var key = (f.apiKey && f.apiKey.stringInputs.value[0] || '').trim();
  props().setProperty('serverUrl', url);
  props().setProperty('apiKey', key);
  try {
    var d = api('GET', 'ping');
    props().setProperty('email', d.user ? d.user.email : '');
    props().setProperty('linkSecret', d.link_secret || '');
    return notify('Prisijungta ✓ (' + (d.user ? d.user.email : '') + ')', onHomepage(e));
  } catch (err) {
    return notify('Nepavyko: ' + err.message, settingsCard('Patikrinkite adresą ir raktą.'));
  }
}

function notify(text, navCardObj) {
  var nav = CardService.newNavigation().updateCard(navCardObj);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .setNavigation(nav)
    .build();
}

// ---------- Rašymo veiksmas: įterpti pikselį ----------
function onComposeInsertPixel(e) {
  if (!getApiKey()) return CardService.newUniversalActionResponseBuilder(); // negalima – parodom nustatymus
  try {
    var uid = uidGen();
    var subject = '';
    var recipients = [];
    try {
      // Kompozicijos metaduomenys (jei prieinami)
      var draftMeta = e.gmail && e.gmail.draftMetadata ? e.gmail.draftMetadata : null;
      if (draftMeta) {
        subject = draftMeta.subject || '';
        recipients = [].concat(draftMeta.toRecipients || [], draftMeta.ccRecipients || []);
      }
    } catch (mErr) { /* metaduomenų gali nebūti telefone */ }

    api('POST', 'emails', { uid: uid, subject: subject, recipients: recipients, source: 'gmail-addon' });

    var pixel = '<img src="' + server() + '/o/' + uid + '.gif" width="1" height="1" alt="" ' +
      'style="width:1px;height:1px;border:0;opacity:0;display:block">';

    var update = CardService.newUpdateDraftBodyAction()
      .addUpdateContent(pixel, CardService.ContentType.MUTABLE_HTML)
      .setUpdateType(CardService.UpdateDraftBodyType.INSERT_AT_END);

    return CardService.newUpdateDraftActionResponseBuilder()
      .setUpdateDraftBodyAction(update)
      .build();
  } catch (err) {
    logRemote('error', 'Įterpimo klaida: ' + err.message);
    // Grąžinam pranešimą vartotojui
    return CardService.newUpdateDraftActionResponseBuilder()
      .setUpdateDraftBodyAction(CardService.newUpdateDraftBodyAction()
        .addUpdateContent('<!-- MailTrack: klaida ' + err.message + ' -->', CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(CardService.UpdateDraftBodyType.INSERT_AT_END))
      .build();
  }
}

// ---------- Šablonai (telefonui / kompiuteriui) ----------
function onComposeTemplates(e) {
  if (!getApiKey()) return settingsCard('Įveskite API raktą, kad matytumėte šablonus.');
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Įterpti šabloną'));
  var s = CardService.newCardSection();
  try {
    var d = api('GET', 'templates');
    var list = (d && d.templates) || [];
    if (!list.length) {
      s.addWidget(CardService.newTextParagraph().setText('Šablonų nėra. Sukurkite juos skydelyje → Šablonai.'));
    } else {
      list.forEach(function (t) {
        s.addWidget(CardService.newTextButton()
          .setText(t.name + (t.subject ? ' — ' + t.subject : ''))
          .setOnClickAction(CardService.newAction().setFunctionName('insertTemplateAction')
            .setParameters({ id: String(t.id), subject: t.subject || '', body: t.body_html || '' })));
      });
    }
  } catch (err) {
    s.addWidget(CardService.newTextParagraph().setText('Klaida: ' + err.message));
  }
  card.addSection(s);
  return card.build();
}

function insertTemplateAction(e) {
  var p = e.commonEventObject.parameters || {};
  try { api('POST', 'templates/' + p.id + '/use'); } catch (er) {}
  var b = CardService.newUpdateDraftActionResponseBuilder();
  if (p.subject) {
    b.setUpdateDraftSubjectAction(CardService.newUpdateDraftSubjectAction()
      .addUpdateSubject(p.subject));
  }
  if (p.body) {
    b.setUpdateDraftBodyAction(CardService.newUpdateDraftBodyAction()
      .addUpdateContent(p.body, CardService.ContentType.MUTABLE_HTML)
      .setUpdateType(CardService.UpdateDraftBodyType.INSERT_AT_START));
  }
  return b.build();
}

// ---------- Sekamos nuorodos įterpimas (universalus veiksmas) ----------
function onComposeInsertLink(e) {
  var f = e.commonEventObject.formInputs || {};
  var url = (f.linkUrl && f.linkUrl.stringInputs.value[0] || '').trim();
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  try {
    var d = api('POST', 'links', { url: url, source: 'gmail-addon' });
    var html = '<a href="' + d.tracked_url + '">' + url + '</a>';
    return CardService.newUpdateDraftActionResponseBuilder()
      .setUpdateDraftBodyAction(CardService.newUpdateDraftBodyAction()
        .addUpdateContent(html, CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT))
      .build();
  } catch (err) {
    logRemote('error', 'Nuorodos įterpimo klaida: ' + err.message);
    throw err;
  }
}

// ---------- Laiško atidarymas: rodyti statistiką ----------
function onGmailMessageOpen(e) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('MailTrack Pro'));
  var s = CardService.newCardSection();
  if (!getApiKey()) {
    return settingsCard('Įveskite API raktą, kad matytumėte statistiką.');
  }
  try {
    var msgId = e.gmail.messageId;
    GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
    var msg = GmailApp.getMessageById(msgId);
    var subj = msg.getSubject();
    // Ieškom mūsų pikselio laiško kūne pagal uid
    var body = msg.getBody();
    var m = body.match(new RegExp(server().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/o/([A-Za-z0-9_-]{8,32})'));
    if (!m) {
      s.addWidget(CardService.newTextParagraph().setText('Šis laiškas nesekamas.<br><br><i>' + subj + '</i>'));
    } else {
      var d = api('GET', 'emails/' + m[1]);
      var status = d.open_count > 0 ? '✓✓ Atidarytas ' + d.open_count + ' k.' : '✓ Dar neatidarytas';
      s.addWidget(CardService.newDecoratedText().setTopLabel('Būsena').setText(status).setWrapText(true));
      if (d.forwarded) s.addWidget(CardService.newDecoratedText().setTopLabel('↪ Galimai persiųstas').setText(d.forward_reason || 'Dažnai atidaromas').setWrapText(true));
      if (d.first_open_at) s.addWidget(CardService.newDecoratedText().setTopLabel('Pirmas atidarymas').setText(d.first_open_at));
      if (d.last_open_at) s.addWidget(CardService.newDecoratedText().setTopLabel('Paskutinis').setText(d.last_open_at));
      if (d.click_count) s.addWidget(CardService.newDecoratedText().setTopLabel('Paspaudimai').setText(String(d.click_count)));
      s.addWidget(CardService.newTextButton().setText('Detaliau skydelyje')
        .setOpenLink(CardService.newOpenLink().setUrl(d.dashboard_url)));
    }
  } catch (err) {
    logRemote('warning', 'Statistikos rodymo klaida: ' + err.message);
    s.addWidget(CardService.newTextParagraph().setText('Nepavyko gauti statistikos: ' + err.message));
  }
  card.addSection(s);
  return card.build();
}
