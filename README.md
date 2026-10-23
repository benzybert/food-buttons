# food-buttons

Two giant food-order buttons (Sharon, Thermomix), Alef font, Hebrew RTL. Static files in `public/`, served by `server.js` (no dependencies, reads `PORT`).

- Run: `npm start`, test: `npm test` (Node) and `pytest` in `grocery-api/`
- Home: `public/index.html`, each button is an `<a>` to its workflow page, plus a bar linking to the shared cart
- Sharon (`public/sharon/`): Sharon is the chef who comes on Sundays. Choose dishes from her menu, or paste a recipe
- Thermomix (`public/thermomix/`): paste a recipe's ingredients
- Both end in **🛒 קנה מצרכים** → `public/groceries/`, which compares prices at Shufersal and Tiv Taam
- Sharon's menu: `public/menu.json`, `{"dishes": [{"name": "...", "ingredients": ["2 כוסות קמח", "..."]}]}` (a dish without `ingredients` is listed but can't be priced)
- Price comparison runs in `grocery-api/` (Python, separate service). `server.js` proxies `POST /api/compare` and `GET /api/health` to `GROCERY_API_URL`; see `grocery-api/README.md`
- **Shared cart** (`public/cart.html`, API under `/api/cart`): see below
- Fonts: Alef (SIL OFL), subset to Hebrew letters and ASCII in `public/fonts/`
- Deploy: Railway (site service from the repo root, grocery API service from `grocery-api/`)

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
