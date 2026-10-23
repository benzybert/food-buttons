// Price maths: shopping needs, pack rounding, per-store baskets, best splits,
// cook-vs-order comparison. Pure functions - no DOM, no storage.
//
// ctx = { ingById: Map, recById: Map, stores: Store[], priceFor(ingId, storeId) -> PriceInfo }
// PriceInfo = { price: number|null, kind: "user" | "data" | "missing" | "none" }
//   user      price typed in by the person
//   data      price from the dataset for this store
//   missing   dataset says the store does not carry the item (price is null)
//   none      nobody has given a price for this item at this store (price is null)
//
// There are no invented prices: an unknown price is null, and null spreads. A total that needs an
// unknown price is null too (never a partial sum, never an estimate), so a screen can only show a
// number that is made entirely of real prices. `missingIds` lists what is unpriced.

import { toBase } from "./units.js";

const EPS = 1e-6; // absorbs float noise from summing conversions (0.0001% of a pack)

// ------------------------------------------------------------------ pricing

/**
 * Build a priceFor() function from the dataset and the user's own prices.
 * data: { table: { [ingId]: { [storeId]: number|null } } }
 */
export function makePricer({ table, overrides = {}, ingById }) {
  return function priceFor(ingId, storeId) {
    const ing = ingById.get(ingId);
    if (!ing) return { price: null, kind: "none" };
    if (ing.free) return { price: 0, kind: "data" };
    const mine = overrides?.[ingId]?.[storeId];
    if (Number.isFinite(mine)) return { price: mine, kind: "user" };
    const row = table?.[ingId];
    const v = row ? row[storeId] : undefined;
    if (v === null) return { price: null, kind: "missing" };
    if (Number.isFinite(v)) return { price: v, kind: "data" };
    return { price: null, kind: "none" };
  };
}

/** true when the price is a real number (the other kinds are null). */
export const hasPrice = (info) => info.price != null;

export const round2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ needs

/**
 * Scale each basket dish to its servings and add up what must be bought.
 * items: [{ dishId, servings }]
 * Returns { needs: Map<ingId, { ing, need, uses: [{dishId, qty}] }>, custom: [{ dishId, name, qty, unit }] }
 */
export function basketNeeds(items, ctx) {
  const needs = new Map();
  const custom = [];
  for (const { dishId, servings } of items) {
    const rec = ctx.recById.get(dishId);
    if (!rec) continue;
    const factor = servings / rec.servings;
    for (const line of rec.ingredients) {
      if (!line.id) {
        custom.push({ dishId, name: line.custom, qty: line.qty * factor, unit: line.unit });
        continue;
      }
      const ing = ctx.ingById.get(line.id);
      if (!ing) continue;
      const q = toBase(ing, line.qty * factor, line.unit);
      if (!Number.isFinite(q)) continue;
      const cur = needs.get(line.id) || { ing, need: 0, uses: [] };
      cur.need += q;
      cur.uses.push({ dishId, qty: q });
      needs.set(line.id, cur);
    }
  }
  return { needs, custom };
}

/** What you actually walk out with: loose items in steps, packaged items in whole packs. */
export function purchaseFor(ing, need) {
  if (need <= EPS || ing.free) return { bought: 0, packs: 0 };
  const { type, size, step } = ing.pack;
  if (type === "loose") {
    const bought = Math.ceil(need / step - EPS) * step;
    return { bought, packs: bought / size };
  }
  const packs = Math.max(1, Math.ceil(need / size - EPS));
  return { bought: packs * size, packs };
}

/** Cost of the part used, ignoring pack rounding (what a dish "really" costs). */
export function consumedCost(ing, need, price) {
  if (ing.free) return 0;
  if (price == null) return null;
  return (need / ing.pack.size) * price;
}

// ------------------------------------------------------------------ store baskets

/**
 * Price the shopping list at one store.
 * pantry: Set of ingredient ids already at home (skipped).
 */
export function priceAtStore(needsMap, store, ctx, pantry = new Set()) {
  const lines = [];
  let subtotal = 0;
  let consumed = 0;
  const missingIds = [];
  for (const { ing, need } of needsMap.values()) {
    if (pantry.has(ing.id) || ing.free) continue;
    const info = ctx.priceFor(ing.id, store.id);
    const { bought, packs } = purchaseFor(ing, need);
    if (!hasPrice(info)) {
      missingIds.push(ing.id);
      lines.push({ ingId: ing.id, need, bought, packs, price: null, kind: info.kind, cost: null, consumed: null });
      continue;
    }
    // Loose goods are priced per `size` (e.g. per kg); packaged goods per pack.
    const lineCost = ing.pack.type === "loose" ? (bought / ing.pack.size) * info.price : packs * info.price;
    const used = consumedCost(ing, need, info.price);
    subtotal += lineCost;
    consumed += used;
    lines.push({ ingId: ing.id, need, bought, packs, price: info.price, kind: info.kind, cost: lineCost, consumed: used });
  }
  const known = missingIds.length === 0;
  return {
    storeId: store.id,
    store,
    lines,
    subtotal: known ? round2(subtotal) : null,
    consumed: known ? round2(consumed) : null,
    leftover: known ? round2(subtotal - consumed) : null,
    missingIds,
  };
}

/** Delivery fee for a subtotal. */
export function deliveryFor(store, subtotal) {
  const d = store.delivery;
  if (!d) return { fee: 0, free: true, belowMin: false, available: false };
  if (!(subtotal > 0)) return { fee: 0, free: true, belowMin: false, available: true }; // nothing to deliver
  const free = d.freeOver != null && subtotal >= d.freeOver;
  return { fee: free ? 0 : d.fee, free, belowMin: d.min != null && subtotal < d.min, available: true };
}

/** All stores, priced and ranked cheapest first (stores with unpriced items rank after complete ones, with total null). */
export function compareStores(needsMap, ctx, { pantry = new Set(), stores = ctx.stores, delivery = false } = {}) {
  const rows = stores.map((s) => {
    const r = priceAtStore(needsMap, s, ctx, pantry);
    const complete = r.missingIds.length === 0;
    const d = delivery && complete ? deliveryFor(s, r.subtotal) : { fee: 0, free: true, belowMin: false, available: true };
    return { ...r, delivery: d, total: complete ? round2(r.subtotal + d.fee) : null, complete };
  });
  // Stores that can price the whole list come first, cheapest first; the rest by how little is missing.
  rows.sort((a, b) => Number(!a.complete) - Number(!b.complete) || (a.complete ? a.total - b.total : a.missingIds.length - b.missingIds.length));
  return rows;
}

/** Cheapest store for each item separately (many stops, lowest price). */
export function bestPerItem(needsMap, ctx, { pantry = new Set(), stores = ctx.stores } = {}) {
  const perStore = stores.map((s) => priceAtStore(needsMap, s, ctx, pantry));
  const byIng = new Map();
  for (const r of perStore) {
    for (const l of r.lines) {
      const cur = byIng.get(l.ingId);
      // Keep the cheapest priced line. An unpriced one only stands in until a priced one shows up.
      const better = !cur || (cur.cost == null && l.cost != null) || (l.cost != null && cur.cost != null && l.cost < cur.cost - EPS);
      if (better) byIng.set(l.ingId, { ...l, storeId: l.cost == null ? null : r.storeId });
    }
  }
  const lines = [...byIng.values()];
  const missingIds = lines.filter((l) => l.cost == null).map((l) => l.ingId);
  const total = missingIds.length ? null : round2(lines.reduce((a, l) => a + l.cost, 0));
  const storeIds = [...new Set(lines.filter((l) => l.storeId).map((l) => l.storeId))];
  return { lines, total, storeIds, missingIds };
}

/** Best way to shop at exactly two stores: for each item pick the cheaper of the pair. */
export function bestPair(needsMap, ctx, { pantry = new Set(), stores = ctx.stores } = {}) {
  const priced = stores.map((s) => priceAtStore(needsMap, s, ctx, pantry));
  let best = null;
  for (let i = 0; i < priced.length; i++) {
    for (let j = i + 1; j < priced.length; j++) {
      const a = new Map(priced[i].lines.map((l) => [l.ingId, l]));
      let total = 0;
      let missing = 0;
      const picks = [];
      for (const lb of priced[j].lines) {
        const la = a.get(lb.ingId);
        const aOk = la.cost != null;
        const bOk = lb.cost != null;
        let pick;
        if (aOk && bOk) pick = la.cost <= lb.cost ? { ...la, storeId: priced[i].storeId } : { ...lb, storeId: priced[j].storeId };
        else if (aOk) pick = { ...la, storeId: priced[i].storeId };
        else if (bOk) pick = { ...lb, storeId: priced[j].storeId };
        else {
          missing++;
          pick = { ...la, storeId: null };
        }
        total += pick.cost ?? 0;
        picks.push(pick);
      }
      const cand = { storeIds: [priced[i].storeId, priced[j].storeId], total: missing ? null : round2(total), missing, lines: picks };
      if (!best || cand.missing < best.missing || (cand.missing === best.missing && cand.total != null && cand.total < best.total)) best = cand;
    }
  }
  return best;
}

// ------------------------------------------------------------------ single dish

/** Per-line proportional costs of a dish at one store: [{ line, ing, need, cost, kind }]. */
export function dishLines(rec, servings, store, ctx) {
  const factor = servings / rec.servings;
  const out = [];
  for (const line of rec.ingredients) {
    if (!line.id) {
      out.push({ line, ing: null, need: null, cost: null, kind: "custom" });
      continue;
    }
    const ing = ctx.ingById.get(line.id);
    if (!ing) continue;
    const need = toBase(ing, line.qty * factor, line.unit);
    if (!Number.isFinite(need)) continue;
    const info = ctx.priceFor(ing.id, store.id);
    out.push({ line, ing, need, cost: ing.free ? 0 : consumedCost(ing, need, info.price), kind: info.kind });
  }
  return out;
}

/**
 * Proportional cost of one dish at one store (only the part that is eaten).
 * Returns { total, perServing, missing }: `missing` counts ingredients with no price at this store,
 * and total / perServing are null while any is missing. Free-text ingredients (no catalog id) have
 * no price at all and are left out, as they always were.
 */
export function dishCostAtStore(rec, servings, store, ctx) {
  let total = 0;
  let missing = 0;
  for (const l of dishLines(rec, servings, store, ctx)) {
    if (l.kind === "custom") continue;
    if (l.cost == null) missing++;
    else total += l.cost;
  }
  return { storeId: store.id, total: missing ? null : round2(total), perServing: missing ? null : round2(total / servings), missing };
}

/** Cost of a dish at every store, cheapest first (stores that price every ingredient before the rest). */
export function dishCostByStore(rec, servings, ctx, stores = ctx.stores) {
  const rows = stores.map((s) => dishCostAtStore(rec, servings, s, ctx));
  rows.sort((a, b) => Number(a.missing > 0) - Number(b.missing > 0) || (a.missing ? a.missing - b.missing : a.total - b.total));
  return rows;
}

// ------------------------------------------------------------------ cook vs order

/**
 * Order options for a dish.
 * sources: [{ id, name, markup?, fee?, min? }]; orderPrice(dishId, sourceId) -> per-serving price | null
 */
export function dishOrderOptions(rec, servings, sources, orderPrice) {
  return sources
    .map((src) => {
      const unit = orderPrice(rec.id, src.id);
      if (!Number.isFinite(unit)) return { source: src, unit: null, subtotal: null, fee: src.fee || 0, total: null };
      const subtotal = round2(unit * servings);
      return { source: src, unit: round2(unit), subtotal, fee: src.fee || 0, total: round2(subtotal + (src.fee || 0)) };
    })
    .sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity));
}

/** Value of your own working time spent on a dish. */
export function timeCost(rec, hourly) {
  if (!hourly) return 0;
  return round2(((rec.time?.prep ?? rec.prep ?? 0) / 60) * hourly);
}

/**
 * Compare cooking a dish with the cheapest way to order it.
 * Returns { cook: {store, total, perServing, time, missing}, order: best option|null, saving, pct, winner }
 * (cook.total is null while some ingredient has no price; saving is null unless both sides are known)
 */
export function compareDish(rec, servings, ctx, { sources, orderPrice, hourly = 0, stores = ctx.stores } = {}) {
  const byStore = dishCostByStore(rec, servings, ctx, stores);
  const cheapest = byStore[0];
  const t = timeCost(rec, hourly);
  const known = cheapest != null && cheapest.total != null;
  // `missing`: when no store prices the whole dish, how many ingredients the best-covered store lacks.
  const cook = { storeId: cheapest?.storeId ?? null, total: known ? round2(cheapest.total + t) : null, ingredients: known ? cheapest.total : null, time: t, perServing: known ? round2((cheapest.total + t) / servings) : null, missing: cheapest?.missing ?? 0 };
  const options = dishOrderOptions(rec, servings, sources, orderPrice);
  const order = options.find((o) => o.total != null) || null;
  if (!order || !known) return { cook, order, options, byStore, saving: null, pct: null, winner: known ? "cook" : null };
  const saving = round2(order.total - cook.total);
  return { cook, order, options, byStore, saving, pct: order.total ? saving / order.total : 0, winner: saving >= 0 ? "cook" : "order" };
}

// ------------------------------------------------------------------ whole basket

/**
 * Full basket report: needs, ranked stores, best splits, order alternatives and the verdict.
 */
export function basketReport(items, ctx, { pantry = new Set(), delivery = false, sources = [], orderPrice = () => null, hourly = 0, stores = ctx.stores } = {}) {
  const { needs, custom } = basketNeeds(items, ctx);
  const ranked = compareStores(needs, ctx, { pantry, stores, delivery });
  const perItem = bestPerItem(needs, ctx, { pantry, stores });
  const pair = stores.length > 1 ? bestPair(needs, ctx, { pantry, stores }) : null;

  // Ordering everything instead.
  const orders = sources.map((src) => {
    let subtotal = 0;
    let missing = 0;
    for (const { dishId, servings } of items) {
      const unit = orderPrice(dishId, src.id);
      if (Number.isFinite(unit)) subtotal += unit * servings;
      else missing++;
    }
    const fee = items.length ? src.fee || 0 : 0;
    // A partial sum would read as a real price: with any dish unpriced here the order has no total.
    return { source: src, subtotal: missing ? null : round2(subtotal), fee, total: missing ? null : round2(subtotal + fee), missing };
  });
  orders.sort((a, b) => a.missing - b.missing || (a.total ?? 0) - (b.total ?? 0));

  let timeTotal = 0;
  for (const { dishId } of items) {
    const rec = ctx.recById.get(dishId);
    if (rec) timeTotal += timeCost(rec, hourly);
  }
  timeTotal = round2(timeTotal);

  const bestStore = ranked[0]?.complete ? ranked[0] : null; // null until some store prices the whole list
  const bestOrder = orders.find((o) => o.missing === 0) || null;
  const cookTotal = bestStore ? round2(bestStore.total + timeTotal) : null;
  const saving = bestStore && bestOrder ? round2(bestOrder.total - cookTotal) : null;
  return { needs, custom, ranked, perItem, pair, orders, bestStore, bestOrder, timeTotal, cookTotal, saving };
}

// ------------------------------------------------------------------ insights

/**
 * What cooking "pays" per hour of active work: shekels saved vs the cheapest order, divided by prep time.
 * null when there is nothing to compare or no prep time.
 */
export function hourlyGain(rec, cmp) {
  const prep = rec.time?.prep ?? rec.prep ?? 0;
  if (!cmp.order || cmp.cook.ingredients == null || !(prep > 0)) return null;
  const saved = cmp.order.total - cmp.cook.ingredients;
  return Math.round(saved / (prep / 60));
}

/**
 * Dishes that are nearly free to add to the basket because they reuse packs you are already buying.
 * Marginal cost = basket total with the dish minus basket total without it (cheapest store each time).
 * Returns [{ rec, servings, marginal, standalone, saved }] best first.
 */
export function suggestAdditions(items, ctx, { pantry = new Set(), stores = ctx.stores, limit = 3, candidates = ctx.recById.values() } = {}) {
  if (!items.length) return [];
  const total = (list) => {
    const best = compareStores(basketNeeds(list, ctx).needs, ctx, { pantry, stores })[0];
    return best?.complete ? best.total : null;
  };
  const base = total(items);
  if (base == null) return [];
  const inBasket = new Set(items.map((i) => i.dishId));
  const out = [];
  for (const rec of candidates) {
    if (inBasket.has(rec.id)) continue;
    const one = [{ dishId: rec.id, servings: rec.servings }];
    const standalone = total(one);
    const both = total([...items, ...one]);
    if (standalone == null || both == null) continue;
    const marginal = round2(both - base);
    if (standalone - marginal >= 5 && marginal < standalone * 0.7) out.push({ rec, servings: rec.servings, marginal, standalone, saved: round2(standalone - marginal) });
  }
  return out.sort((a, b) => b.saved / b.servings - a.saved / a.servings).slice(0, limit);
}
