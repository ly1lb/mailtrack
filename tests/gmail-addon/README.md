# Gmail priedo testas (CardService imitacija)

Apps Script aplinkos čia nėra, todėl `mock-test.js` paleidžia `gmail-addon/Code.gs`
su netikrais `CardService`, `UrlFetchApp` ir `PropertiesService` ir tikrina tai,
kas realiame Gmail jau buvo sulūžę:

1. **Leidimai** – `appsscript.json` turi `gmail.addons.current.message.metadata`
   (reikia `draftAccess: METADATA`) ir `script.locale` (reikia `useLocaleFromApp`).
   Be jų Gmail rodo „Nėra scenarijaus leidimo atlikti to veiksmo“.
2. **Rašymo veiksmai grąžina kortelę** – Google leidžia `composeTrigger` grąžinti
   tik `Card`; laišką keisti galima tik paspaudus kortelės mygtuką.
3. **Pikselis ir sekama nuoroda** – įterpiami, priskiriami tam pačiam `uid`,
   serverio klaida rodoma pranešimu (o ne paslėptu komentaru laiške).
4. Visos manifeste ir `setFunctionName` nurodytos funkcijos egzistuoja.

## Paleidimas

```bash
node tests/gmail-addon/mock-test.js
```

Laukiamas rezultatas: `VISKAS OK`.
