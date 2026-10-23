# food-buttons (הזמנת אוכל)

Hebrew RTL web app that answers one question: **order food (from Sharon or a delivery app) or cook it at home with a Thermomix, and what does each cost?** One small Node server (`server.js`, no runtime dependencies, reads `PORT`) serves two parts that share the same site:

1. **The app** (`public/index.html`, hash routes like `#/cook`): two giant buttons, **שרון** (order) and **Thermomix** (cook).
   - 49 original Thermomix-style recipes with cost per serving, calories, and the price of ordering the same dish.
   - **Price comparison** of a basket of dishes at 8 supermarkets (whole packs, pantry-aware), the best two-store split, and cook vs. order. *Prices in the app are sample data* until replaced (see `docs/DATA.md`); the UI says so.
   - Shopping list, weekly planner, pantry, cook mode with timers, "what should I eat tonight?", Sharon menu with a WhatsApp order message, recipe import (paste text or JSON-LD), price editing, backup/restore.
   - Installable PWA that works offline. Everything is stored in the browser (`localStorage`), no accounts, no tracking.
2. **The shop** (real prices and a family cart, needs the server):
   - **Real prices** at Shufersal and Tiv Taam: `/sharon/` (pick Sharon's dishes or paste a recipe) and `/thermomix/` (paste ingredients) both end in **🛒 קנה מצרכים** → `/groceries/`. Comparison runs in `grocery-api/` (Python, separate service); `server.js` proxies `/api/compare` and `/api/health` to `GROCERY_API_URL`, see `grocery-api/README.md`.
   - **Shared cart** (`/cart.html`, API under `/api/cart`), plus the **Instinct** event feed: see below.
   - Linked from the app's home screen and from "עוד". The app's own price screens and the shop's real prices are separate: the cart does not read the app's basket.

## Run

```sh
npm start            # http://localhost:3000  (PORT is respected)
npm test             # app logic, server, and the shop (test/shop/): cart, API, grocery proxy
npm run e2e          # browser tests (needs playwright + Chromium; optional axe-core for the a11y sweep)
npm run check        # generated files are current + unit tests
npm run check:grocery   # pytest in grocery-api/ (Python)
```

No runtime dependencies (Node >= 22). Without `GROCERY_API_URL` the shop still works except real prices ("מלא מחירים"). Set `ACCESS_KEY`, otherwise a temporary key is printed at startup.

## Layout

```
server.js               static files (gzip, ETag, strict CSP, /healthz) + /api via lib/api.js
lib/                    the shop's server code (CommonJS, see lib/package.json): cart, instinct, grocery client, state
public/                 the app and the shop pages
  index.html, style.css (tokens + home buttons), app.css (components), manifest, sw.js, icons/, fonts/
  js/lib/               pure logic, shared with Node tests: units, parse, calc, derive, catalog, plan, text
  js/views/             one file per screen (hash routes)
  js/{app,store,router,ui,dom,fmt,icons}.js
  data/                 GENERATED/committed JSON: ingredients, recipes, prices (sample), stores, sources
  cart.html cart.css cart.js    the shared cart
  sharon/ thermomix/ groceries/  workflow pages; app.js, to-cart.js, menu.json (Sharon's menu), shop.css
data-src/               editable sources: ingredients.txt and recipes/*.txt (compact Hebrew format)
tools/                  build-data (txt -> json), build-sw, gen-sample-prices, ingest-prices
grocery-api/            Python price-comparison service (own Railway service, Root Directory /grocery-api)
bridge/                 optional Cookidoo bridge (own Railway service, see docs/COOKIDOO.md)
test/                   node:test unit tests + test/e2e (Playwright); test/shop/ = cart, API, grocery (CommonJS)
docs/                   DATA.md, DEPLOY.md, ROADMAP.md, HANDOFF.md (Hebrew)
```

Sharon's menu for the shop pages: `public/menu.json`, `{"dishes": [{"name": "...", "ingredients": ["2 כוסות קמח", "..."]}]}` (a dish without `ingredients` is listed but can't be priced).

**The service worker never touches the shop.** `/api/*` and the shop pages (list in `tools/build-sw.js`, `NETWORK_ONLY`) are neither precached nor cached: the cart must be live and `/api/instinct/invite` contains a key. Add any new shop page or file to that list.

## Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `GROCERY_API_URL`, `GROCERY_API_TOKEN` | Where the price-comparison service lives, and its key. |
| `ACCESS_KEY` | Required in practice. The cart API needs `Authorization: Bearer <key>`; the cart page asks for it once per device. If unset, a temporary key is printed at startup. |
| `DATA_DIR` | Where `state.json` (cart, orders, events) is kept. Mount a Railway volume here, otherwise the cart is wiped on each deploy. Default `./data`. |
| `INSTINCT_WEBHOOK_URL`, `INSTINCT_TOKEN` | https URL (and bearer token) that receives every event. Unset = push is off. |
| `INSTINCT_READ_KEY` | Read-only key for Instinct. Defaults to one derived from `ACCESS_KEY`. |
| `INSTINCT_WHATSAPP` | Number the "ask Instinct to connect" button writes to. Default `16508702892`. |
| `PUBLIC_URL` | The site's public URL, if it can't be taken from the request headers. |
| `BRIDGE_ORIGIN` | Optional: https origin of the Cookidoo bridge (`bridge/`), added to the CSP `connect-src`. See [docs/COOKIDOO.md](docs/COOKIDOO.md). |
| `PORT` | Set by Railway. |

## Shared cart

Sharon's dishes, Thermomix recipes and manual entries all land in one cart; the same item from two places becomes one line with both source badges. Recipes can be pasted into the cart page too (one ingredient per line, `2 כוסות קמח`).

Prices are per unit, per item and platform (`providers.json`: id, name, https url). Shufersal and Tiv Taam can be filled automatically from the grocery API ("מלא מחירים" on the cart page, or on the groceries page "הוסף לעגלה המשותפת" first); the others are entered by hand. Automatic prices are stored so that price x quantity equals the estimated cost of buying that amount. A platform can be "cheapest" only if every item in the cart is priced there. Ordering happens on the chain's own site: open it, copy the list, then press "הזמנתי כאן", which marks the items as ordered and records an `order.placed` event.

## Instinct (AI assistant)

Every change is recorded as an event. Instinct can get them two ways, both documented for it at `/api/instinct/spec`:

- **Pull:** `GET /api/events?after=<last id>` with the read-only key. Also `GET /api/cart` for the current state.
- **Push (webhook):** set `INSTINCT_WEBHOOK_URL` and every event is POSTed there:

```json
{
  "source": "food-buttons",
  "event": {
    "id": "a1b2c3d4e5f6",
    "type": "cart.item_added",
    "at": "2026-10-23T03:25:00.000Z",
    "actor": "שבן",
    "summary": "שבן הוסיף לעגלה: קמח (2 ק״ג) דרך Thermomix",
    "data": { "name": "קמח", "qty": 2, "unit": "ק״ג", "source": "thermomix", "merged": false }
  }
}
```

Types: `cart.item_added`, `cart.item_updated`, `cart.item_removed`, `cart.price_set`, `cart.ordered_cleared`, `cart.recipe_imported`, `cart.prices_filled`, `order.placed`, `instinct.sync`. `Idempotency-Key` is the event id. Undelivered events are kept and retried with backoff, oldest first; a 4xx other than 408/429 drops that event so it cannot block the queue.

On the cart page, **"בקש מ-Instinct בווטסאפ להתחבר"** opens WhatsApp to Instinct with a ready message (spec link, read-only key, how to pull, and a request for a webhook URL). The sender presses send. **"שלח ל-Instinct עדכון מלא"** pushes an `instinct.sync` event carrying the whole cart.

## Cart API

All JSON and all need a key; the read-only key only works on the rows marked read. `X-Actor` (URL-encoded) names who is acting.

| Call | |
| --- | --- |
| `GET /api/cart` (read) | items, providers, price comparison, recent orders |
| `POST /api/cart/items` | `{name, qty?, unit?, source?: sharon\|thermomix\|manual, note?}` |
| `PATCH /api/cart/items/:id` | `{name?, qty?, unit?, note?, prices?: {providerId: number\|null}}` |
| `DELETE /api/cart/items/:id` | remove |
| `DELETE /api/cart/ordered` | clear items already ordered |
| `POST /api/cart/import` | `{recipe?, servings?, source?: sharon\|thermomix\|manual, lines: "2 כוסות קמח\n3 ביצים"}` or `{ingredients: [{name, qty, unit}]}` (`/api/thermomix/import` is the same call) |
| `POST /api/cart/fill-prices` | fetch real Shufersal and Tiv Taam prices for the cart from the grocery API |
| `POST /api/orders` | `{provider}`: mark everything in the cart as ordered there |
| `GET /api/events?limit=50&after=` (read) | activity log; with `after`, oldest first from that id |
| `GET /api/instinct` (read), `POST /api/instinct/sync` | delivery status, full sync |
| `GET /api/instinct/spec` (read), `GET /api/instinct/invite` | integration doc; WhatsApp invite (main key only) |

Thermomix/Cookidoo has no public API, so recipes come in as a pasted ingredient list.

## Editing content

- Recipes: edit `data-src/recipes/*.txt`, then `npm run build`. The build fails loudly on an unknown ingredient, a unit it cannot convert, or a recipe that mixes meat and dairy.
- Ingredients and their packs: `data-src/ingredients.txt`.
- Prices: `public/data/prices.json` (see `docs/DATA.md`); people can also type their own prices in the app.

## Notes

- Recipes in `data-src/` were written for this project. The app is not affiliated with Vorwerk/Thermomix/Cookidoo and does not fetch anything from them; the importer works on text you paste. Optionally you can run your own small service (`bridge/`, see [docs/COOKIDOO.md](docs/COOKIDOO.md)) that searches and imports from *your* Cookidoo account through an unofficial library; it is off unless you configure it.
- Fonts: Alef (SIL OFL 1.1), subset with fonttools, see `public/fonts/README.txt`.
