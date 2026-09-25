# ВалCAD — чертёж вала на телефоне

Android-приложение: вал собирается из элементов, чертёж по ЕСКД строится автоматически
(размеры, допуски, шероховатость, сечения, основная надпись, ТТ, таблицы параметров зубчатых венцов).
Экспорт: JPG, PNG, PDF, DXF (1:1), отправка через «Поделиться» (Telegram и т.д.), 3D-вид.

## Сборка
```bash
npm install
npm run build          # веб-часть -> dist/
npx cap sync android
cd android && gradle assembleRelease   # APK: android/app/build/outputs/apk/release/
```
Подпись: файл `keys/keystore.properties` + `keys/valcad-release.jks` (в git не хранятся).

## Структура
- `src/catalog.js` — типы ступеней, элементов и их параметры
- `src/standards.js` — допуски ГОСТ 25347, шпонки ГОСТ 23360, канавки, центровые отверстия
- `src/geom.js` — геометрия вала (профили, внутренние контуры)
- `src/drawing.js` — чертёж: вид/полуразрез/разрез, сечения, размеры, лист
- `src/render/` — экран/JPG, SVG, PDF, DXF
- `src/view3d.js` — 3D (three.js)
- `tests/render.mjs` — рендер тестовых валов в PNG
