// Gmail priedo imitacija: CardService/UrlFetchApp/PropertiesService mock'ai.
const fs = require('fs'), vm = require('vm');
const ROOT = require('path').join(__dirname, '../../gmail-addon/');
const code = fs.readFileSync(ROOT + 'Code.gs', 'utf8');
const manifest = JSON.parse(fs.readFileSync(ROOT + 'appsscript.json', 'utf8'));

function builder(kind) {
  const obj = { __kind: kind, calls: [], toJSON() { return { kind, calls: this.calls }; } };
  return new Proxy(obj, {
    get(t, k) {
      if (k in t) return k === 'toJSON' ? t.toJSON.bind(t) : t[k];
      if (k === 'build') return () => ({ __built: kind, calls: t.calls });
      return (...a) => { t.calls.push([k, a]); return t._self; };
    }
  });
}
function mkBuilder(kind) { const b = builder(kind); b._self = b; return b; }
const CardService = new Proxy({}, {
  get(_, k) {
    if (typeof k === 'string' && k.startsWith('new')) return () => mkBuilder(k.slice(3));
    return new Proxy({}, { get: (_, v) => k + '.' + String(v) }); // enums
  }
});
const store = {};
const fetched = [];
let fail = false;
const ctx = {
  CardService,
  PropertiesService: { getUserProperties: () => ({ getProperty: k => store[k] || null, setProperty: (k, v) => { store[k] = v; } }) },
  UrlFetchApp: { fetch: (url, o) => { fetched.push([url, o && o.payload]);
    const body = fail ? { ok: false, error: 'Serverio klaida' } :
      url.endsWith('/api/emails') ? { ok: true, uid: JSON.parse(o.payload).uid } :
      url.endsWith('/api/links') ? { ok: true, uid: 'x', tracked_url: 'https://t.lt/c/x?a=1&b="2"' } :
      url.endsWith('/api/ping') ? { ok: true, user: { email: 'a@b.lt' }, link_secret: 's' } : { ok: true, templates: [] };
    return { getResponseCode: () => fail ? 500 : 200, getContentText: () => JSON.stringify(body) }; } },
  GmailApp: {},
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

let bad = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) bad++; };

// 1) Visos manifeste nurodytos funkcijos egzistuoja
const fns = [manifest.addOns.common.homepageTrigger.runFunction,
  ...manifest.addOns.gmail.composeTrigger.selectActions.map(a => a.runFunction),
  ...manifest.addOns.gmail.contextualTriggers.map(t => t.onTriggerFunction)];
fns.forEach(f => ok(typeof ctx[f] === 'function', 'manifest funkcija ' + f));
// 2) Visi setFunctionName taikiniai egzistuoja
[...code.matchAll(/setFunctionName\('(\w+)'\)/g)].forEach(m => ok(typeof ctx[m[1]] === 'function', 'veiksmas ' + m[1]));
// 3) Leidimai
['gmail.addons.current.message.metadata', 'script.locale'].forEach(s =>
  ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/' + s), 'scope ' + s));

// 4) Rašymo veiksmai be rakto grąžina sukurtą kortelę (nustatymus)
manifest.addOns.gmail.composeTrigger.selectActions.forEach(a => {
  const r = ctx[a.runFunction]({ commonEventObject: {} });
  ok(r && r.__built === 'CardBuilder', a.runFunction + ' be rakto -> Card');
});
store.apiKey = 'k'; store.serverUrl = 'https://t.lt';
// 5) Su raktu rašymo veiksmai grąžina kortelę
manifest.addOns.gmail.composeTrigger.selectActions.forEach(a => {
  const r = ctx[a.runFunction]({ commonEventObject: {}, gmail: {} });
  ok(r && r.__built === 'CardBuilder', a.runFunction + ' su raktu -> Card');
});
const card = ctx.onComposeTracking({ commonEventObject: {}, gmail: {} });
const json = JSON.stringify(card);
const uid = (json.match(/"uid":"([A-Za-z0-9]{22})"/) || [])[1];
ok(!!uid, 'kortelės mygtukai turi uid parametrą');

// 6) Mygtukas „Įterpti sekimą“
const r1 = ctx.insertPixelAction({ commonEventObject: { parameters: { uid } }, gmail: { toRecipients: ['x@y.lt'], ccRecipients: ['c@y.lt'] } });
ok(r1.__built === 'UpdateDraftActionResponseBuilder', 'insertPixelAction -> UpdateDraftActionResponse');
const sent = JSON.parse(fetched[fetched.length - 1][1]);
ok(sent.uid === uid && sent.recipients.join() === 'x@y.lt,c@y.lt' && sent.source === 'gmail_addon', 'serveriui siunčiamas uid ir gavėjai');
ok(JSON.stringify(r1).includes('https://t.lt/o/' + uid + '.gif'), 'pikselio adresas teisingas');

// 7) Sekama nuoroda
const r2 = ctx.onComposeInsertLink({ commonEventObject: { parameters: { uid }, formInputs: { linkUrl: { stringInputs: { value: ['example.com'] } } } } });
ok(r2.__built === 'UpdateDraftActionResponseBuilder', 'onComposeInsertLink -> UpdateDraftActionResponse');
const ls = JSON.parse(fetched[fetched.length - 1][1]);
ok(ls.uid === uid && ls.url === 'https://example.com', 'nuoroda priskiriama tam pačiam uid');
ok(JSON.stringify(r2).includes('&amp;b=&quot;2&quot;'), 'nuorodos HTML išvalytas');
const r3 = ctx.onComposeInsertLink({ commonEventObject: { parameters: { uid }, formInputs: {} } });
ok(r3.__built === 'ActionResponseBuilder', 'tuščia nuoroda -> pranešimas');

// 8) Serverio klaida -> pranešimas, o ne komentaras laiške
fail = true;
const r4 = ctx.insertPixelAction({ commonEventObject: { parameters: { uid } }, gmail: {} });
ok(r4.__built === 'ActionResponseBuilder' && JSON.stringify(r4).includes('Serverio klaida'), 'klaida -> pranešimas');
const r5 = ctx.onComposeInsertLink({ commonEventObject: { parameters: { uid }, formInputs: { linkUrl: { stringInputs: { value: ['a.lt'] } } } } });
ok(r5.__built === 'ActionResponseBuilder', 'nuorodos klaida -> pranešimas');

console.log(bad ? `\n${bad} FAIL` : '\nVISKAS OK');
process.exit(bad ? 1 : 0);
