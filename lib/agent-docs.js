// What Instinct (an AI agent) needs to integrate: a document it can fetch and
// read, and the WhatsApp message that asks it to start.
const WHATSAPP_NUMBER = (process.env.INSTINCT_WHATSAPP || "16508702892").replace(/\D/g, "");

function spec(origin) {
  return `# food-buttons integration (for Instinct)

A family app for ordering food: a shared grocery cart fed from three places
(Sharon the chef's weekly dishes, Thermomix recipes, manual entries), price
comparison across grocery platforms, and orders. Everything that happens is an
event. Event summaries are written in Hebrew.

Base URL: ${origin}

## Pull (works today)

All calls need \`Authorization: Bearer <read key>\`. The read key is read-only.

- \`GET /api/events?after=<last event id you processed>&limit=100\`
  Events after that id, oldest first. Omit \`after\` for the newest 50, newest first.
  Pass an empty \`after=\` to start from the oldest retained event (the last 500 are kept).
  Remember the id of the last event you handled and pass it next time.
- \`GET /api/cart\` is the current state: items (with sources, quantities, prices per platform),
  the comparison per platform, and recent orders. Use it to reconcile instead of replaying events.
- \`GET /api/instinct\` is delivery status of the push channel below.

## Push (better, needs a URL from you)

Give the owner an https URL (and optionally a bearer token) that accepts POSTs. They set it as
INSTINCT_WEBHOOK_URL / INSTINCT_TOKEN on the server and every event is then POSTed to you as it
happens, with retries (oldest first) while you are unreachable.

\`\`\`
POST <your url>
Authorization: Bearer <your token>      (if one was set)
Idempotency-Key: <event id>             (the same event may arrive twice; dedupe on it)
Content-Type: application/json

{ "source": "food-buttons",
  "event": { "id": "…", "type": "cart.item_added", "at": "ISO time",
             "actor": "who did it", "summary": "Hebrew sentence", "data": { … } } }
\`\`\`

Answer 2xx once handled. A 4xx other than 408/429 makes the server drop that event, a 5xx or a
timeout makes it retry.

## Event types

- \`cart.item_added\`: data { id, name, qty, unit, source: sharon|thermomix|manual, merged }
- \`cart.item_updated\`: data { id, name?, qty?, unit?, note? }
- \`cart.item_removed\`: data { id, name }
- \`cart.price_set\`: data { id, name, provider, price } (price null = cleared)
- \`cart.ordered_cleared\`: data { removed }
- \`thermomix.recipe_imported\`: data { recipe, servings, items: [{ name, qty, unit, merged }] }
- \`order.placed\`: data { order, provider, total (null if some items had no price), lines: [{ name, qty, unit, sources }] }
- \`instinct.sync\`: data is the full cart snapshot { items, compare, recentOrders }, sent when the owner presses the sync button

Providers (grocery platforms) are listed in \`GET /api/cart\` under \`providers\`.
`;
}

function invite(origin, readKey) {
  const message = [
    "היי Instinct, תעשה מולי אינטגרציה עם food-buttons, האפליקציה שלנו להזמנות אוכל ועגלת קניות משותפת (שרון, Thermomix, הזמנות לסוף שבוע).",
    "",
    "אני רוצה שתקבל עדכון על כל דבר שקורה שם: פריט שנוסף לעגלה, מתכון שיובא, הזמנה שבוצעה וכו׳.",
    "",
    `1. התיעוד המלא: ${origin}/api/instinct/spec`,
    "2. הכותרת לכל בקשה: Authorization: Bearer " + readKey + " (מפתח לקריאה בלבד)",
    `3. משיכה: GET ${origin}/api/events?after=<המזהה האחרון שראית>`,
    "4. עדיף בדחיפה: אם יש לך כתובת webhook, שלח לי אותה (ואת הטוקן אם צריך) ואני אגדיר שכל אירוע יישלח אליך מיד.",
    "",
    "תתחיל מלקרוא את התיעוד ותגיד לי איך אתה מעדיף להתחבר.",
  ].join("\n");
  return { message, whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}` };
}

module.exports = { spec, invite };
