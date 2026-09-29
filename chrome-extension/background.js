/* MailTrack Pro – foninis servisas (MV3 service worker).
   - API užklausos į jūsų serverį (turinio skriptas jų tiesiogiai daryti negali dėl CORS)
   - Laiškų registravimo eilė su pakartojimais (jei serveris laikinai nepasiekiamas)
   - Darbalaukio pranešimai apie atidarymus (tikrina kas minutę)
   - Blokuoja jūsų pačių pikselio užkrovimą Gmail'e (kad nesiskaičiuotų jūsų atidarymai) */
'use strict';

const DEFAULTS = { serverUrl: '', apiKey: '', linkSecret: '', userEmail: '', trackByDefault: true, trackLinks: true, desktopNotify: true };

async function getCfg() {
  const c = await chrome.storage.sync.get(DEFAULTS);
  c.serverUrl = (c.serverUrl || '').replace(/\/+$/, '');
  return c;
}

async function api(method, path, body) {
  const cfg = await getCfg();
  if (!cfg.serverUrl || !cfg.apiKey) throw new Error('Plėtinys nesukonfigūruotas (nustatymuose įveskite serverį ir API raktą)');
  const res = await fetch(cfg.serverUrl + '/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* ne JSON */ }
  if (!res.ok || !data || data.ok === false) {
    throw new Error('API ' + path + ': HTTP ' + res.status + ' ' + ((data && data.error) || ''));
  }
  return data;
}

/** Klaidą užrašome ir lokaliai (popup rodo), ir serverio žurnale. */
async function logError(message, context) {
  console.warn('[MailTrack]', message, context || '');
  const { errors = [] } = await chrome.storage.local.get('errors');
  errors.unshift({ t: new Date().toISOString(), m: String(message).slice(0, 300) });
  await chrome.storage.local.set({ errors: errors.slice(0, 20) });
  try {
    const cfg = await getCfg();
    if (cfg.serverUrl) {
      await fetch(cfg.serverUrl + '/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey || '' },
        body: JSON.stringify({ level: 'warning', message: String(message), context: context || null, source: 'chrome-plėtinys ' + chrome.runtime.getManifest().version })
      });
    }
  } catch (e) { /* serveris nepasiekiamas */ }
}

// ---- Registravimo eilė ----
async function enqueue(payload) {
  const { queue = [] } = await chrome.storage.local.get('queue');
  queue.push({ payload, tries: 0, added: Date.now() });
  await chrome.storage.local.set({ queue });
  flushQueue();
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const { queue = [] } = await chrome.storage.local.get('queue');
    const left = [];
    for (const item of queue) {
      try {
        await api('POST', 'emails', item.payload);
      } catch (e) {
        item.tries++;
        if (item.tries < 30) left.push(item);
        else await logError('Laiško registracija nepavyko po 30 bandymų', { uid: item.payload.uid, err: String(e) });
        if (item.tries === 1) await logError('Laiško registracija nepavyko (bus kartojama)', { uid: item.payload.uid, err: String(e) });
      }
    }
    await chrome.storage.local.set({ queue: left });
  } finally {
    flushing = false;
  }
}

// ---- Savų atidarymų blokavimas ----
async function updateBlockRules() {
  const cfg = await getCfg();
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = old.map(r => r.id);
  const addRules = [];
  if (cfg.serverUrl) {
    const host = new URL(cfg.serverUrl).host;
    addRules.push({
      id: 1,
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||' + host + '/o/', initiatorDomains: ['mail.google.com'], resourceTypes: ['image', 'other', 'xmlhttprequest'] }
    });
  }
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

// ---- Pranešimai ----
async function pollNotifications() {
  const cfg = await getCfg();
  if (!cfg.serverUrl || !cfg.apiKey) return;
  const { lastNotifId = 0 } = await chrome.storage.local.get('lastNotifId');
  try {
    const d = await api('GET', 'notifications?since=' + lastNotifId);
    await chrome.storage.local.set({ lastNotifId: d.last_id || lastNotifId });
    if (!lastNotifId || !cfg.desktopNotify) return;
    for (const n of d.items || []) {
      chrome.notifications.create('mt-' + n.id + '|' + n.url, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: n.title,
        message: n.body || '',
        priority: 1
      });
    }
  } catch (e) {
    // tyliai – tinklas gali būti nepasiekiamas
  }
}

chrome.notifications.onClicked.addListener(id => {
  const url = id.split('|').slice(1).join('|');
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

chrome.runtime.onInstalled.addListener(async details => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  await updateBlockRules().catch(e => logError('DNR taisyklės: ' + e));
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  updateBlockRules().catch(() => {});
});
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'tick') {
    flushQueue();
    pollNotifications();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.serverUrl) updateBlockRules().catch(e => logError('DNR taisyklės: ' + e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'config') return sendResponse({ ok: true, cfg: await getCfg() });
      if (msg.type === 'register') { await enqueue(msg.payload); return sendResponse({ ok: true }); }
      if (msg.type === 'api') return sendResponse({ ok: true, data: await api(msg.method || 'GET', msg.path, msg.body) });
      if (msg.type === 'log') { await logError(msg.message, msg.context); return sendResponse({ ok: true }); }
      if (msg.type === 'setDefault') { await chrome.storage.sync.set({ trackByDefault: !!msg.value }); return sendResponse({ ok: true }); }
      sendResponse({ ok: false, error: 'nežinomas tipas' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // asinchroninis atsakymas
});
