# FoodDiary

A clean, modern food diary & calorie tracker that runs as a web app on iPhone and Android — no App Store, no developer account, no cost.

- **Barcode scanning** with the phone camera (or type the number) → product name, photo, calories and macros from **Open Food Facts** (3.5M+ products, strong UK coverage).
- **UK generic foods** (fruit, veg, meat, cooked dishes) from the UK government's **CoFID / McCance & Widdowson** dataset, searchable offline.
- **Custom foods from a photo of the nutrition label** — on-device text recognition pre-fills the form, you check and save.
- **Recipes** — build from a food search or pick items straight from your diary (any day in the last week) with the amounts you logged; favourites, recents, copy-yesterday.
- **Daily targets** (calories, protein, carbs, fat) calculated from your profile (Mifflin–St Jeor) or set manually. Diet-style presets — **Low carb** (default), **Balanced**, **Keto** with a carb-limit slider (10–50 g). Change calories and the macros rescale to keep the same split; edit one macro and the other two adjust to fit. Every change shows **Saved ✓**.
- **Healthy weight**: BMI card shows your healthy weight range for your height and how many kg to lose (or gain) to reach it.
- **Progress charts**: weekly calories vs target, macros, body weight trend and BMI.
- **Private by design** — everything stays on your phone. One-tap backup file you can save to OneDrive; restore on a new device.
- Follows your phone's light/dark setting.

---

## 1 · Put it online with GitHub Pages (free, ~5 minutes)

GitHub Pages gives you a free `https://` address, which the camera and "Add to Home Screen" need.

1. Go to <https://github.com> and sign in (or create a free account).
2. Click **＋ → New repository**. Name it `fooddiary`, leave it **Public**, tick **Add a README file**, click **Create repository**.
3. In the new repository click **Add file → Upload files**. Drag **everything inside this folder** (`index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, the `css`, `js`, `icons`, `data`, `tools` folders) onto the page, then click **Commit changes**.
   - Tip: if your file manager hides `.nojekyll`, it's fine to skip it.
4. Click **Settings → Pages** (left sidebar). Under **Build and deployment → Source** choose **Deploy from a branch**, set Branch to **main** / **(root)**, click **Save**.
5. Wait about a minute, then refresh the Pages settings page — it shows your address, e.g.  
   `https://<your-username>.github.io/fooddiary/`

### Install on your phone

- **iPhone (Safari):** open the address → tap the **Share** button → **Add to Home Screen** → **Add**.  
  (Must be Safari — Chrome on iOS can't add web apps to the home screen.)
- **Android (Chrome):** open the address → menu **⋮** → **Add to Home screen** / **Install app**.

Open it from the icon — it runs full-screen like a native app and works offline (except live product lookups).

### Updating the app later

Upload the changed files again (Add file → Upload files, same names overwrite). Each release already carries a new `VERSION` in `sw.js`. Phones check for updates automatically every time the app is opened or brought back to the foreground, download the new files, and refresh themselves — you'll see "Updating to the latest version…". You can also tap **Me → Check now**. The current version is shown at the bottom of the Me screen.

---

## 2 · Add the UK food database (optional but recommended)

Open Food Facts covers packaged products. For fresh/unpackaged foods ("banana, raw", "chicken breast, grilled") import the free UK dataset:

**Easiest — on the phone or laptop, inside the app:**
1. Download *McCance and Widdowson's composition of foods integrated dataset* (Excel, ~4 MB) from  
   <https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid>
2. In FoodDiary go to **Me → UK food database → Import CoFID spreadsheet** and pick the file.  
   ~2,900 foods are stored on the device for offline search. Repeat on each device you use.

**Alternative — bundle it in the repo so every device gets it automatically:**
```bash
pip install openpyxl
python tools/build_cofid.py "McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021.xlsx"
```
This writes `data/cofid.json`. Upload that file to the repo (replacing the empty placeholder) and bump `VERSION` in `sw.js`.

---

## 3 · Tips

- **Scanning:** hold the barcode 10–15 cm from the camera in good light. If a product isn't in Open Food Facts yet, FoodDiary offers to create it from the nutrition label and remembers the barcode.
- **Label photos:** straight-on, well lit, table filling the frame. Always glance over the numbers — OCR is good, not perfect.
- **Search etiquette:** product search uses the free Open Food Facts API, which allows about 10 searches a minute. The app waits until you pause typing (or press search) before querying.
- **Backups:** Me → Back up to file → save to OneDrive via the share sheet. Restoring replaces the data on the device.

---

## Data & credits

- Product data: [Open Food Facts](https://world.openfoodfacts.org) — Open Database License (ODbL). Please consider contributing missing products via their app.
- Generic UK foods: McCance & Widdowson's *Composition of Foods Integrated Dataset* (CoFID), Public Health England — © Crown copyright, [Open Government Licence v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- Libraries (loaded from CDN, cached for offline use): [Chart.js](https://www.chartjs.org/), [html5-qrcode](https://github.com/mebjas/html5-qrcode), [Tesseract.js](https://tesseract.projectnaptha.com/), [SheetJS](https://sheetjs.com/) (import only).
- Targets use the Mifflin–St Jeor equation with standard activity multipliers. This is a personal tool, not medical advice.

## Project layout

```
index.html            app shell (all four screens + bottom sheet)
css/styles.css        design system, light/dark via prefers-color-scheme
js/nutrition.js       pure maths: targets, BMI, scaling, label-text parsing, CoFID sheet parsing
js/store.js           localStorage state + IndexedDB for the CoFID dataset
js/sources.js         Open Food Facts API, CoFID search, custom foods, recipes
js/app.js             UI: diary, search, scanner, OCR, recipes, charts, settings, backup
sw.js                 service worker (offline shell, cached libraries & product images)
manifest.webmanifest  PWA manifest · icons/ · data/cofid.json · tools/build_cofid.py
```
