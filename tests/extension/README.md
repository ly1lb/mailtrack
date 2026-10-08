# Plėtinio regresijos testas (Gmail imitacija)

Tikrina tai, kas realiame Gmail jau buvo sulūžę:

1. **Mygtukai nesidubliuoja** – Gmail turi įdėtų `role="button"` elementų su ta
   pačia žyme, todėl be apsaugos „Sekama“ ir „Šablonai“ atsirasdavo po du.
2. **Paspaudimai veikia** – Gmail savo įrankių juostoje perima `pointerdown`/
   `mousedown`/`click` CAPTURE fazėje ir kviečia `stopImmediatePropagation()`.
   Dėl to listener'is, pakabintas ant paties mygtuko, NIEKADA nesuveikdavo.
   Testas imituoja tokį interceptorių ir tikrina, kad meniu vis tiek atsidaro.
3. **Šablono įterpimas** – tema ir turinys patenka į laišką, parašas išsaugomas.
4. **Sekimo jungiklis** persijungia ✓✓ Sekama ↔ ✓ Sekti.

## Paleidimas

```bash
npm i playwright            # naršyklė jau būna /opt/pw-browsers/chromium
node run-test.js
```

Laukiamas rezultatas: `toggles: 1`, `tplButtons: 1`, `menuVisible: 1`,
`menuItems: 2`, užpildyta `subject`, tuščias `errors`.

## thread-test.js – ženklai gijoje ir sąraše

```bash
NODE_PATH=$(npm root -g) node thread-test.js
```

Tikrina: viena juosta laiškui (be dublikatų), cituoti pikseliai neskaičiuojami kaip
„seka“, 👁 tik tiksliam siuntėjo adresui, ✓/✓✓ sąraše tik kai sutampa tema IR gavėjas,
nėra begalinio DOM perrašymo ciklo, atsakant pašalinamas senas pikselis iš citatos.
Laukiamas rezultatas: `VISKAS OK`.
