# Skydelio (UI) testai

`all-pages.js` – atidaro visus puslapius 1280px (PC) ir 390px (telefono) pločiu ir tikrina:
HTTP kodą, horizontalų slinkimą, elementus, išeinančius už ekrano, JS klaidas.
Laukiamas rezultatas: „VISI PUSLAPIAI ŠVARŪS“.

`ui-shots.js` – padaro ekrano nuotraukas (shot-*.png) vizualiai peržiūrai.

## Paleidimas
```bash
cd server && php -S 127.0.0.1:8775 index.php &   # su testine config.php
npm i playwright
node all-pages.js
```
