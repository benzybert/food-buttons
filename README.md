# food-buttons

Two giant food-order buttons (Sharon, Thermomix), Alef font, Hebrew RTL, and a **shared cart** behind them. Node server with no dependencies (`server.js`), static files in `public/`, reads `PORT`.

- Run: `npm start`, test: `npm test`
- Both buttons open `public/cart.html` with their source preselected, so everything added through Sharon, Thermomix or by hand lands in one cart. The same item from two places becomes one line with both source badges.
- Fonts: Alef (SIL OFL), subset to Hebrew letters and ASCII in `public/fonts/`
- Deploy: Railway (needs the server for `/api`; the static-only hosts no longer fit)

## Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `ACCESS_KEY` | Required in practice. Every `/api` call needs `Authorization: Bearer <key>`; the cart page asks for it once per device. If unset, a temporary key is printed at startup. |
| `DATA_DIR` | Where `state.json` (cart, orders, events) is kept. Mount a Railway volume here, otherwise the cart is wiped on each deploy. Default `./data`. |
| `INSTINCT_WEBHOOK_URL` | https URL that receives every event. Unset = integration off. |
| `INSTINCT_TOKEN` | Sent as `Authorization: Bearer <token>` to the webhook. |

## Price comparison and ordering

Platforms are listed in `providers.json` (id, name, https url). Prices are per unit and entered by hand per item and platform, because the chains have no public price API. A platform can be "cheapest" only if every item in the cart is priced there. Ordering happens on the chain's own site: open it, copy the list, then press "הזמנתי כאן", which marks the items as ordered and records an `order.placed` event.

## Instinct

Every change is recorded as an event and POSTed to `INSTINCT_WEBHOOK_URL`:

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

Types: `cart.item_added`, `cart.item_updated`, `cart.item_removed`, `cart.price_set`, `cart.ordered_cleared`, `thermomix.recipe_imported`, `order.placed`, `instinct.sync`. `Idempotency-Key` is the event id. Undelivered events are kept and retried with backoff, oldest first; a 4xx other than 408/429 drops that event so it cannot block the queue. The "שלח ל-Instinct עדכון מלא" button sends an `instinct.sync` event carrying the whole cart.

## API

All JSON, all need the access key. `X-Actor` (URL-encoded) names who is acting.

| Call | |
| --- | --- |
| `GET /api/cart` | items, providers, price comparison, recent orders |
| `POST /api/cart/items` | `{name, qty?, unit?, source?: sharon\|thermomix\|manual, note?}` |
| `PATCH /api/cart/items/:id` | `{name?, qty?, unit?, note?, prices?: {providerId: number\|null}}` |
| `DELETE /api/cart/items/:id` | remove |
| `DELETE /api/cart/ordered` | clear items already ordered |
| `POST /api/thermomix/import` | `{recipe?, servings?, lines: "2 כוסות קמח\n3 ביצים"}` or `{ingredients: [{name, qty, unit}]}` |
| `POST /api/orders` | `{provider}`: mark everything in the cart as ordered there |
| `GET /api/events?limit=50` | activity log, newest first |
| `GET /api/instinct`, `POST /api/instinct/sync` | delivery status, full sync |

Thermomix/Cookidoo has no public API, so recipes come in as a pasted ingredient list (or structured ingredients from whatever sends them).
