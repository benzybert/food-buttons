// The shared cart. Sharon, Thermomix and manual entries all land in the same
// list; an item added from two places becomes one line with both sources.
const { state, save, newId } = require("./state");
const { fail } = require("./util");
const providers = require("./providers");
const { compare, round2 } = require("./compare");
const { record } = require("./events");
const instinct = require("./instinct");
const grocery = require("./grocery");

const SOURCES = { sharon: "שרון", thermomix: "Thermomix", manual: "ידני" };
const UNITS = new Set(["גרם", "ק״ג", "מ״ל", "ליטר", "כוס", "כוסות", "כף", "כפות", "כפית", "כפיות", "יח׳", "חבילה", "חבילות"]);
const MAX_ORDERS = 100;

const active = () => state.items.filter((i) => !i.orderId);
const touch = () => {
  state.rev++;
  save();
};
const fmtQty = (item) => `${item.qty}${item.unit ? ` ${item.unit}` : ""}`;

function requiredText(value, max, label) {
  const s = optionalText(value, max);
  if (!s) throw fail(400, `${label} חסר`);
  return s;
}

function optionalText(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function parseQty(value) {
  const qty = value === undefined ? 1 : Number(value);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) throw fail(400, "כמות לא תקינה");
  return Math.round(qty * 1000) / 1000;
}

function parseSource(value = "manual") {
  if (!(value in SOURCES)) throw fail(400, "מקור לא מוכר");
  return value;
}

function parseItem(input, source = input.source) {
  return {
    name: requiredText(input.name, 80, "שם הפריט"),
    qty: parseQty(input.qty),
    unit: optionalText(input.unit, 20),
    source: parseSource(source),
    note: optionalText(input.note, 200),
  };
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// No event here: callers decide whether this is one event or part of a bigger one.
function upsert({ name, qty, unit, source, note }) {
  const now = new Date().toISOString();
  const existing = active().find((i) => sameName(i.name, name) && i.unit === unit);
  if (existing) {
    existing.qty = round2(existing.qty + qty);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (note && !existing.note) existing.note = note;
    existing.updatedAt = now;
    return { item: existing, merged: true };
  }
  const item = { id: newId(), name, qty, unit, sources: [source], note, prices: {}, createdAt: now, updatedAt: now };
  state.items.push(item);
  return { item, merged: false };
}

function addItem(input, actor) {
  const { item, merged } = upsert(parseItem(input));
  const via = SOURCES[item.sources.at(-1)];
  record(
    "cart.item_added",
    actor,
    merged ? `${actor} הוסיף עוד ${item.name} (עכשיו ${fmtQty(item)}) דרך ${via}` : `${actor} הוסיף לעגלה: ${item.name} (${fmtQty(item)}) דרך ${via}`,
    { id: item.id, name: item.name, qty: item.qty, unit: item.unit, source: item.sources.at(-1), merged },
  );
  return item;
}

function findActive(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw fail(404, "הפריט לא נמצא");
  if (item.orderId) throw fail(409, "הפריט כבר הוזמן");
  return item;
}

function updateItem(id, patch, actor) {
  const item = findActive(id);
  const changed = {};

  if (patch.name !== undefined) changed.name = requiredText(patch.name, 80, "שם הפריט");
  if (patch.qty !== undefined) changed.qty = parseQty(patch.qty);
  if (patch.unit !== undefined) changed.unit = optionalText(patch.unit, 20);
  if (patch.note !== undefined) changed.note = optionalText(patch.note, 200);

  const prices = {};
  for (const [providerId, price] of Object.entries(patch.prices ?? {})) {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) throw fail(400, "פלטפורמה לא מוכרת");
    if (price !== null && (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 100000)) {
      throw fail(400, "מחיר לא תקין");
    }
    prices[providerId] = price === null ? null : round2(price);
  }

  const before = fmtQty(item);
  Object.assign(item, changed);
  for (const [providerId, price] of Object.entries(prices)) {
    if (price === null) delete item.prices[providerId];
    else item.prices[providerId] = price;
  }
  item.updatedAt = new Date().toISOString();

  if (Object.keys(changed).length) {
    record("cart.item_updated", actor, `${actor} עדכן את ${item.name}: ${before} ← ${fmtQty(item)}`, {
      id: item.id,
      ...changed,
    });
  }
  for (const [providerId, price] of Object.entries(prices)) {
    const name = providers.find((p) => p.id === providerId).name;
    record(
      "cart.price_set",
      actor,
      price === null ? `${actor} מחק מחיר של ${item.name} ב${name}` : `${actor} עדכן מחיר ל${item.name} ב${name}: ${price} ₪ ל${item.unit || "יחידה"}`,
      { id: item.id, name: item.name, provider: providerId, price },
    );
  }
  if (!Object.keys(changed).length && !Object.keys(prices).length) touch();
  return item;
}

function removeItem(id, actor) {
  const item = findActive(id);
  state.items.splice(state.items.indexOf(item), 1);
  record("cart.item_removed", actor, `${actor} הסיר מהעגלה: ${item.name}`, { id: item.id, name: item.name });
}

function clearOrdered(actor) {
  const before = state.items.length;
  state.items = state.items.filter((i) => !i.orderId);
  const removed = before - state.items.length;
  if (removed) record("cart.ordered_cleared", actor, `${actor} ניקה ${removed} פריטים שכבר הוזמנו`, { removed });
  return removed;
}

// "2 כוסות קמח", "1/2 כפית מלח", "- 3 ביצים", "פלפל שחור"
function parseLine(line) {
  const text = line.replace(/^[\s\-–•*]+/, "").replace(/"/g, "״").replace(/'/g, "׳").trim();
  const m = text.match(/^(\d+\/\d+|\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (!m) return { name: text, qty: 1, unit: "" };
  const qty = m[1].includes("/") ? m[1].split("/").reduce((a, b) => a / b) : Number(m[1].replace(",", "."));
  const [first, ...rest] = m[2].split(" ");
  return UNITS.has(first) && rest.length ? { name: rest.join(" "), qty, unit: first } : { name: m[2], qty, unit: "" };
}

// Thermomix/Cookidoo has no public API, so a recipe arrives as the ingredient
// list pasted from it, or as structured ingredients from whatever sends it.
// `source` says whose list it is (Sharon's dishes, a Thermomix recipe, manual).
function importRecipe(input, actor) {
  const source = parseSource(input.source ?? "thermomix");
  const recipe = optionalText(input.recipe, 120) || "מתכון ללא שם";
  const raw = Array.isArray(input.ingredients)
    ? input.ingredients
    : String(input.lines ?? "")
        .split("\n")
        .filter((l) => l.trim())
        .map(parseLine);
  if (!raw.length) throw fail(400, "לא נמצאו מצרכים");
  if (raw.length > 100) throw fail(400, "יותר מדי מצרכים");

  const parsed = raw.map((r) => parseItem(r, source));
  const results = parsed.map(upsert);
  record(
    "cart.recipe_imported",
    actor,
    `${actor} ייבא את המתכון «${recipe}» ונוספו ${results.length} מצרכים לעגלה, דרך ${SOURCES[source]}`,
    {
      recipe,
      source,
      servings: input.servings ?? null,
      items: results.map(({ item, merged }) => ({ name: item.name, qty: item.qty, unit: item.unit, merged })),
    },
  );
  return results.map((r) => r.item);
}

// Real prices from the grocery API for the stores it covers. Stored per unit so
// that price x qty equals the estimated cost of buying the amount in the cart,
// which is what the comparison totals add up.
const GROCERY_BATCH = 30; // the API's per-request limit
const norm = (s) => s.trim().replace(/\s+/g, " ");

async function fillPrices(actor) {
  const items = active();
  if (!items.length) throw fail(409, "העגלה ריקה");

  const lineOf = (i) => norm(`${i.qty} ${i.unit ? `${i.unit} ` : ""}${i.name}`);
  const byLine = new Map(items.map((i) => [lineOf(i), i]));
  const providerIds = new Set(providers.map((p) => p.id));
  const updates = []; // applied only after every batch succeeded, so a failure changes nothing

  for (let at = 0; at < items.length; at += GROCERY_BATCH) {
    const lines = items.slice(at, at + GROCERY_BATCH).map(lineOf);
    const data = await grocery.compare(lines.join("\n"), { includePantry: true });
    for (const row of data.ingredients) {
      const item = byLine.get(norm(row.raw));
      if (!item) continue;
      for (const [storeId, offer] of Object.entries(row.offers)) {
        if (!offer || !providerIds.has(storeId)) continue;
        // Not rounded to cents: 10 for 3 units must still add up to 10, not 9.99.
        updates.push([item, storeId, Math.round((offer.line_cost / item.qty) * 10000) / 10000]);
      }
    }
  }

  const now = new Date().toISOString();
  for (const [item, storeId, price] of updates) {
    item.prices[storeId] = price;
    item.updatedAt = now;
  }
  const found = new Set(updates.map(([item]) => item.id));
  const stores = new Set(updates.map(([, storeId]) => storeId));
  const names = [...stores].map((id) => providers.find((p) => p.id === id).name);
  record(
    "cart.prices_filled",
    actor,
    found.size
      ? `${actor} מילא מחירים מ${names.join(" ומ")} ל-${found.size} מתוך ${items.length} פריטים`
      : `${actor} ביקש מחירים אוטומטיים ולא נמצא אף פריט`,
    { filled: found.size, total: items.length, providers: [...stores] },
  );
  return { filled: found.size, total: items.length };
}

function placeOrder(providerId, actor) {
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) throw fail(400, "פלטפורמה לא מוכרת");
  const items = active();
  if (!items.length) throw fail(409, "העגלה ריקה");

  const [totals] = compare(items, [provider]);
  const order = {
    id: newId(),
    provider: provider.id,
    at: new Date().toISOString(),
    by: actor,
    total: totals.complete ? totals.total : null,
    lines: items.map(line),
  };
  for (const item of items) item.orderId = order.id;
  state.orders.push(order);
  if (state.orders.length > MAX_ORDERS) state.orders.splice(0, state.orders.length - MAX_ORDERS);

  record("order.placed", actor, `${actor} הזמין ${items.length} פריטים ב${provider.name}${order.total === null ? "" : ` (${order.total} ₪)`}`, {
    order: order.id,
    provider: provider.id,
    total: order.total,
    lines: order.lines,
  });
  return order;
}

const line = (i) => ({ name: i.name, qty: i.qty, unit: i.unit, sources: i.sources });

function snapshot() {
  const items = active();
  return { items: items.map(line), compare: compare(items, providers), recentOrders: state.orders.slice(-5) };
}

// Full state, for when Instinct wants to reconcile instead of replaying events.
async function syncInstinct(actor) {
  if (!instinct.enabled) throw fail(409, "Instinct לא מוגדר בשרת");
  record("instinct.sync", actor, `${actor} ביקש סנכרון מלא של העגלה`, snapshot());
  await instinct.flush();
  return instinct.getStatus();
}

function view() {
  return {
    rev: state.rev,
    sources: SOURCES,
    providers: providers.map(({ id, name, url }) => ({ id, name, url: url ?? null })),
    items: state.items,
    compare: compare(active(), providers),
    orders: state.orders.slice(-10),
  };
}

module.exports = { addItem, updateItem, removeItem, clearOrdered, importRecipe, fillPrices, placeOrder, syncInstinct, view, parseLine };
