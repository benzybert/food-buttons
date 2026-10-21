// Price maths: shopping needs, pack rounding, per-store baskets, best splits,
// cook-vs-order comparison. Pure functions - no DOM, no storage.
//
// ctx = { ingById: Map, recById: Map, stores: Store[], priceFor(ingId, storeId) -> PriceInfo }
// PriceInfo = { price: number|null, kind: "user" | "data" | "estimate" | "missing" }
//   user      price typed in by the person
//   data      price from the dataset for this store
//   missing   dataset says the store does not carry the item (price falls back to an estimate)
//   estimate  store simply has no row; price = reference price x store index

import { toBase } from "./units.js";

const EPS = 1e-6; // absorbs float noise from summing conversions (0.0001% of a pack)

// ------------------------------------------------------------------ pricing

/**
 * Build a priceFor() function from the dataset, the user's overrides, and reference prices.
 * data: { table: { [ingId]: { [storeId]: number|null } } }
 */
export function makePricer({ table, overrides = {}, ingById, storeById }) {
  return function priceFor(ingId, storeId) {
    const ing = ingById.get(ingId);
    if (!ing) return { price: null, kind: "missing" };
    if (ing.free) return { price: 0, kind: "data" };
    const mine = overrides?.[ingId]?.[storeId];
    if (Number.isFinite(mine)) return { price: mine, kind: "user" };
    const row = table?.[ingId];
    const v = row ? row[storeId] : undefined;
    const estimate = round2(ing.ref * (storeById.get(storeId)?.index ?? 1));
    if (v === null) return { price: estimate, kind: "missing" };
    if (Number.isFinite(v)) return { price: v, kind: "data" };
    return { price: estimate, kind: "estimate" };
  };
}

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
  const estimatedIds = [];
  for (const { ing, need } of needsMap.values()) {
    if (pantry.has(ing.id) || ing.free) continue;
    const info = ctx.priceFor(ing.id, store.id);
    const { bought, packs } = purchaseFor(ing, need);
    // Loose goods are priced per `size` (e.g. per kg); packaged goods per pack.
    const lineCost = ing.pack.type === "loose" ? (bought / ing.pack.size) * info.price : packs * info.price;
    const used = consumedCost(ing, need, info.price);
    subtotal += lineCost;
    consumed += used;
    if (info.kind === "missing") missingIds.push(ing.id);
    if (info.kind === "estimate") estimatedIds.push(ing.id);
    lines.push({ ingId: ing.id, need, bought, packs, price: info.price, kind: info.kind, cost: lineCost, consumed: used });
  }
  return { storeId: store.id, store, lines, subtotal: round2(subtotal), consumed: round2(consumed), leftover: round2(subtotal - consumed), missingIds, estimatedIds };
}

/** Delivery fee for a subtotal. */
export function deliveryFor(store, subtotal) {
  const d = store.delivery;
  if (!d) return { fee: 0, free: true, belowMin: false, available: false };
  if (!(subtotal > 0)) return { fee: 0, free: true, belowMin: false, available: true }; // nothing to deliver
  const free = d.freeOver != null && subtotal >= d.freeOver;
  return { fee: free ? 0 : d.fee, free, belowMin: d.min != null && subtotal < d.min, available: true };
}

/** All stores, priced and ranked cheapest first (stores missing items rank after complete ones). */
export function compareStores(needsMap, ctx, { pantry = new Set(), stores = ctx.stores, delivery = false } = {}) {
  const rows = stores.map((s) => {
    const r = priceAtStore(needsMap, s, ctx, pantry);
    const d = delivery ? deliveryFor(s, r.subtotal) : { fee: 0, free: true, belowMin: false, available: true };
    return { ...r, delivery: d, total: round2(r.subtotal + d.fee), complete: r.missingIds.length === 0 };
  });
  rows.sort((a, b) => Number(!a.complete) - Number(!b.complete) || a.total - b.total);
  return rows;
}

/** Cheapest store for each item separately (many stops, lowest price). */
export function bestPerItem(needsMap, ctx, { pantry = new Set(), stores = ctx.stores } = {}) {
  const perStore = stores.map((s) => priceAtStore(needsMap, s, ctx, pantry));
  const byIng = new Map();
  for (const r of perStore) {
    for (const l of r.lines) {
      const cur = byIng.get(l.ingId);
      const better = !cur || (cur.kind === "missing" && l.kind !== "missing") || (l.kind !== "missing" && cur.kind !== "missing" && l.cost < cur.cost - EPS) || (l.kind === "missing" && cur.kind === "missing" && l.cost < cur.cost);
      if (better) byIng.set(l.ingId, { ...l, storeId: r.storeId });
    }
  }
  const lines = [...byIng.values()];
  const total = round2(lines.reduce((a, l) => a + l.cost, 0));
  const storeIds = [...new Set(lines.map((l) => l.storeId))];
  return { lines, total, storeIds };
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
        const aOk = la.kind !== "missing";
        const bOk = lb.kind !== "missing";
        let pick;
        if (aOk && bOk) pick = la.cost <= lb.cost ? { ...la, storeId: priced[i].storeId } : { ...lb, storeId: priced[j].storeId };
        else if (aOk) pick = { ...la, storeId: priced[i].storeId };
        else if (bOk) pick = { ...lb, storeId: priced[j].storeId };
        else {
          missing++;
          pick = la.cost <= lb.cost ? { ...la, storeId: priced[i].storeId } : { ...lb, storeId: priced[j].storeId };
        }
        total += pick.cost;
        picks.push(pick);
      }
      const cand = { storeIds: [priced[i].storeId, priced[j].storeId], total: round2(total), missing, lines: picks };
      if (!best || cand.missing < best.missing || (cand.missing === best.missing && cand.total < best.total)) best = cand;
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
 * Returns { total, perServing, estimated, missing }.
 */
export function dishCostAtStore(rec, servings, store, ctx) {
  let total = 0;
  let estimated = 0;
  let missing = 0;
  for (const l of dishLines(rec, servings, store, ctx)) {
    if (l.cost == null) continue;
    total += l.cost;
    if (l.kind === "estimate") estimated++;
    if (l.kind === "missing") missing++;
  }
  return { storeId: store.id, total: round2(total), perServing: round2(total / servings), estimated, missing };
}

/** Cost of a dish at every store, cheapest first (complete stores before incomplete ones). */
export function dishCostByStore(rec, servings, ctx, stores = ctx.stores) {
  const rows = stores.map((s) => dishCostAtStore(rec, servings, s, ctx));
  rows.sort((a, b) => Number(a.missing > 0) - Number(b.missing > 0) || a.total - b.total);
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
 * Returns { cook: {store, total, perServing, time}, order: best option|null, saving, pct, winner }
 */
export function compareDish(rec, servings, ctx, { sources, orderPrice, hourly = 0, stores = ctx.stores } = {}) {
  const byStore = dishCostByStore(rec, servings, ctx, stores);
  const cheapest = byStore[0];
  const t = timeCost(rec, hourly);
  const cook = { storeId: cheapest.storeId, total: round2(cheapest.total + t), ingredients: cheapest.total, time: t, perServing: round2((cheapest.total + t) / servings) };
  const options = dishOrderOptions(rec, servings, sources, orderPrice);
  const order = options.find((o) => o.total != null) || null;
  if (!order) return { cook, order: null, options, byStore, saving: null, pct: null, winner: "cook" };
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
    return { source: src, subtotal: round2(subtotal), fee: items.length ? src.fee || 0 : 0, total: round2(subtotal + (items.length ? src.fee || 0 : 0)), missing };
  });
  orders.sort((a, b) => a.missing - b.missing || a.total - b.total);

  let timeTotal = 0;
  for (const { dishId } of items) {
    const rec = ctx.recById.get(dishId);
    if (rec) timeTotal += timeCost(rec, hourly);
  }
  timeTotal = round2(timeTotal);

  const bestStore = ranked[0] || null;
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
  if (!cmp.order || !(prep > 0)) return null;
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
  const total = (list) => compareStores(basketNeeds(list, ctx).needs, ctx, { pantry, stores })[0]?.total ?? 0;
  const base = total(items);
  const inBasket = new Set(items.map((i) => i.dishId));
  const out = [];
  for (const rec of candidates) {
    if (inBasket.has(rec.id)) continue;
    const one = [{ dishId: rec.id, servings: rec.servings }];
    const standalone = total(one);
    const marginal = round2(total([...items, ...one]) - base);
    if (standalone - marginal >= 5 && marginal < standalone * 0.7) out.push({ rec, servings: rec.servings, marginal, standalone, saved: round2(standalone - marginal) });
  }
  return out.sort((a, b) => b.saved / b.servings - a.saved / a.servings).slice(0, limit);
}
