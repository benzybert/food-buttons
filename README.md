# food-buttons (הזמנת אוכל)

Hebrew RTL web app that answers one question: **order food (from Sharon or a delivery app) or cook it at home with a Thermomix, and what does each cost?**

- Two giant buttons on the home screen: **שרון** (order) and **Thermomix** (cook). Alef font, light/dark.
- 44 original Thermomix-style recipes, with cost per serving vs. the price of ordering the same dish.
- **Price comparison**: put dishes in a basket and see the total at 8 supermarkets (whole packs, pantry-aware), the best two-store split, the cheapest store per item, and cook vs. order (optionally including the value of your time and delivery fees).
- Shopping list (grouped by aisle, tick-off, WhatsApp / copy / print, split by store), weekly planner with auto-plan, pantry with "what can I cook now?", step-by-step cook mode with timers and screen wake lock, "what should I eat tonight?", a Sharon menu with a WhatsApp order message, recipe import (paste text or JSON-LD, e.g. copied from Cookidoo), price editing/import, backup/restore.
- Installable PWA that works offline. No accounts, no tracking: everything is stored in the browser (`localStorage`).

> **Prices are sample data** until you replace them (see `docs/DATA.md`). The UI says so on every price screen.

## Run

```sh
npm start            # http://localhost:3000  (PORT is respected)
npm test             # unit tests: parser, units, price maths, data integrity, server
npm run e2e          # browser tests (needs playwright + Chromium; optional axe-core for the a11y sweep)
npm run check        # generated files are current + unit tests
```

No runtime dependencies (Node >= 22). The server is a tiny static file server (`server.js`: gzip, ETag, CSP and other security headers, `/healthz`). `public/` can equally be published by any static host (`netlify.toml`, `vercel.json`, `railway.json` are included; see `docs/DEPLOY.md`).

## Layout

```
public/                 the whole app (static)
  index.html, style.css (tokens + home buttons), app.css (components), manifest, sw.js, icons/, fonts/
  js/lib/               pure logic, shared with Node tests: units, parse, calc, derive, catalog, plan, text
  js/views/             one file per screen (hash routes)
  js/{app,store,router,ui,dom,fmt,icons}.js
  data/                 GENERATED/committed JSON: ingredients, recipes, prices (sample), stores, sources
data-src/               editable sources: ingredients.txt and recipes/*.txt (compact Hebrew format)
tools/                  build-data (txt -> json), build-sw, gen-sample-prices, ingest-prices
test/                   node:test unit tests + test/e2e (Playwright)
docs/                   DATA.md, DEPLOY.md, ROADMAP.md, HANDOFF.md (Hebrew)
```

## Editing content

- Recipes: edit `data-src/recipes/*.txt`, then `npm run build`. The build fails loudly on an unknown ingredient, a unit it cannot convert, or a recipe that mixes meat and dairy.
- Ingredients and their packs: `data-src/ingredients.txt`.
- Prices: `public/data/prices.json` (see `docs/DATA.md`); people can also type their own prices in the app.

## Notes

- Recipes in `data-src/` were written for this project. The app is not affiliated with Vorwerk/Thermomix/Cookidoo and does not fetch anything from them; the importer works on text you paste.
- Fonts: Alef (SIL OFL 1.1), subset with fonttools, see `public/fonts/README.txt`.
