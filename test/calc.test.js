import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog } from "../public/js/lib/catalog.js";
import { purchaseFor, basketNeeds, priceAtStore, compareStores, bestPerItem, bestPair, dishCostAtStore, dishCostByStore, compareDish, basketReport, deliveryFor, makePricer, consumedCost } from "../public/js/lib/calc.js";
import { fixture } from "./helpers.js";

const raw = fixture();
const cat = buildCatalog(raw);
const ctx = cat; // catalog doubles as the calc context
const [A] = raw.stores;
const cake = cat.recById.get("cake");

test("purchaseFor: packages round up to whole packs, loose goods to the step", () => {
  const { flour, onion, eggs, water } = Object.fromEntries(raw.ingredients.map((i) => [i.id, i]));
  assert.deepEqual(purchaseFor(flour, 300), { bought: 1000, packs: 1 });
  assert.deepEqual(purchaseFor(flour, 1000), { bought: 1000, packs: 1 });
  assert.deepEqual(purchaseFor(flour, 1000.0001), { bought: 1000, packs: 1 }); // float noise must not buy a second bag
  assert.deepEqual(purchaseFor(flour, 1001), { bought: 2000, packs: 2 });
  assert.deepEqual(purchaseFor(onion, 150), { bought: 200, packs: 0.2 }); // loose: steps of 100 g
  assert.deepEqual(purchaseFor(onion, 300), { bought: 300, packs: 0.3 });
  assert.deepEqual(purchaseFor(eggs, 13), { bought: 24, packs: 2 });
  assert.deepEqual(purchaseFor(water, 500), { bought: 0, packs: 0 });
  assert.deepEqual(purchaseFor(onion, 0), { bought: 0, packs: 0 });
});

test("makePricer: user override > dataset > missing > estimate", () => {
  const ingById = cat.ingById;
  const storeById = cat.storeById;
  const p = makePricer({ table: raw.prices.table, overrides: { flour: { a: 4.5 } }, ingById, storeById });
  assert.deepEqual(p("flour", "a"), { price: 4.5, kind: "user" });
  assert.deepEqual(p("flour", "b"), { price: 5, kind: "data" });
  const eggsB = p("eggs", "b");
  assert.equal(eggsB.kind, "missing");
  assert.equal(eggsB.price, 16.2); // 18 x 0.9
  assert.equal(p("water", "a").price, 0);
  const noRow = makePricer({ table: {}, ingById, storeById })("flour", "b");
  assert.deepEqual(noRow, { price: 4.5, kind: "estimate" }); // 5 x 0.9
});

test("basketNeeds: scales by servings and converts to base units", () => {
  const { needs } = basketNeeds([{ dishId: "cake", servings: 8 }], ctx); // x2
  assert.equal(needs.get("flour").need, 600);
  assert.equal(needs.get("eggs").need, 6);
  assert.equal(needs.get("onion").need, 300);
  assert.equal(needs.get("oil").need, 240); // 0.5 cup x 2 = 240 ml
});

test("basketNeeds: two dishes add up and unresolved lines are reported separately", () => {
  const extra = { ...cake, id: "cake2", ingredients: [...cake.ingredients, { custom: "קינואה", qty: 100, unit: "g" }] };
  const c2 = buildCatalog({ ...raw, recipes: [...raw.recipes, extra] });
  const { needs, custom } = basketNeeds([{ dishId: "cake", servings: 4 }, { dishId: "cake2", servings: 4 }], c2);
  assert.equal(needs.get("flour").need, 600);
  assert.equal(needs.get("flour").uses.length, 2);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].name, "קינואה");
});

test("priceAtStore: whole packs for packaged goods, pantry skipped, consumed vs bought", () => {
  const { needs } = basketNeeds([{ dishId: "cake", servings: 4 }], ctx);
  const r = priceAtStore(needs, A, ctx);
  const byId = Object.fromEntries(r.lines.map((l) => [l.ingId, l]));
  assert.equal(byId.flour.cost, 6); // one 1 kg bag
  assert.equal(byId.eggs.cost, 16); // one dozen
  assert.equal(byId.onion.cost, 8 * 0.2); // 200 g bought (150 needed)
  assert.equal(byId.oil.cost, 12);
  assert.equal(r.lines.length, 4); // water excluded
  assert.equal(r.subtotal, 6 + 16 + 1.6 + 12);
  assert.ok(r.consumed < r.subtotal);
  const withPantry = priceAtStore(needs, A, ctx, new Set(["oil", "flour"]));
  assert.equal(withPantry.lines.length, 2);
  assert.equal(withPantry.subtotal, 17.6);
});

test("compareStores: complete stores outrank cheaper stores that lack an item", () => {
  const { needs } = basketNeeds([{ dishId: "cake", servings: 4 }], ctx);
  const rows = compareStores(needs, ctx);
  assert.equal(rows[0].storeId, "a"); // B is cheaper but does not carry eggs
  assert.equal(rows[0].complete, true);
  assert.equal(rows[1].storeId, "b");
  assert.equal(rows[1].complete, false);
  assert.deepEqual(rows[1].missingIds, ["eggs"]);
});

test("delivery fee: free above threshold, below-min flag", () => {
  assert.deepEqual(deliveryFor(A, 99), { fee: 30, free: false, belowMin: false, available: true });
  assert.deepEqual(deliveryFor(A, 100), { fee: 0, free: true, belowMin: false, available: true });
  assert.equal(deliveryFor(A, 10).belowMin, true);
  assert.equal(deliveryFor({ id: "x" }, 10).available, false);
  assert.equal(deliveryFor(A, 0).fee, 0); // an all-pantry basket has nothing to deliver
  const { needs } = basketNeeds([{ dishId: "cake", servings: 4 }], ctx);
  const rows = compareStores(needs, ctx, { delivery: true });
  assert.equal(rows[0].total, rows[0].subtotal + 30);
});

test("bestPerItem picks the cheapest available store for each item", () => {
  const { needs } = basketNeeds([{ dishId: "cake", servings: 4 }], ctx);
  const best = bestPerItem(needs, ctx);
  const by = Object.fromEntries(best.lines.map((l) => [l.ingId, l.storeId]));
  assert.equal(by.flour, "b");
  assert.equal(by.onion, "b");
  assert.equal(by.eggs, "a"); // b is missing eggs
  assert.equal(by.oil, "b");
  assert.deepEqual(best.storeIds.sort(), ["a", "b"]);
  assert.equal(best.total, 5 + 16 + 6 * 0.2 + 11);
});

test("bestPair never costs more than the best single store", () => {
  const { needs } = basketNeeds([{ dishId: "cake", servings: 4 }], ctx);
  const single = compareStores(needs, ctx)[0].total;
  const pair = bestPair(needs, ctx);
  assert.ok(pair.total <= single);
  assert.equal(pair.missing, 0);
});

test("dishCostAtStore: proportional cost of what is used", () => {
  // flour 300g of 1kg@6 = 1.8 ; eggs 3 of 12@16 = 4 ; onion 150g @8/kg = 1.2 ; oil 0.5cup=120ml @12/L = 1.44
  const r = dishCostAtStore(cake, 4, A, ctx);
  assert.equal(r.total, 1.8 + 4 + 1.2 + 1.44);
  assert.equal(r.perServing, Math.round(((1.8 + 4 + 1.2 + 1.44) / 4) * 100) / 100);
  const double = dishCostAtStore(cake, 8, A, ctx);
  assert.ok(Math.abs(double.total - 2 * r.total) < 0.011);
  const rows = dishCostByStore(cake, 4, ctx);
  assert.equal(rows[0].storeId, "a"); // b lacks eggs -> ranked after
});

test("consumedCost for loose goods is per size", () => {
  const onion = cat.ingById.get("onion");
  assert.equal(consumedCost(onion, 500, 8), 4);
});

test("compareDish: cook vs cheapest order, with and without time cost", () => {
  const orderPrice = cat.orderPrice;
  const base = compareDish(cake, 4, ctx, { sources: raw.sources, orderPrice });
  assert.equal(base.order.source.id, "s1"); // 20 x 4 = 80 beats 30 x 4 + 20
  assert.equal(base.order.total, 80);
  assert.equal(base.saving, Math.round((80 - base.cook.total) * 100) / 100);
  assert.equal(base.winner, "cook");
  const busy = compareDish(cake, 4, ctx, { sources: raw.sources, orderPrice, hourly: 600 }); // 20 min prep = 200 shekel
  assert.equal(busy.cook.time, 200);
  assert.equal(busy.winner, "order");
  const none = compareDish({ ...cake, order: undefined, id: "zzz" }, 4, ctx, { sources: raw.sources, orderPrice: () => null });
  assert.equal(none.order, null);
  assert.equal(none.winner, "cook");
});

test("user order-price overrides beat the base price", () => {
  const c = buildCatalog(raw, { orderPrices: { cake: { s1: 5 } } });
  assert.equal(c.orderPrice("cake", "s1"), 5);
  assert.equal(c.orderPrice("cake", "s2"), 30); // 20 x 1.5
  assert.equal(c.orderPrice("nope", "s1"), null);
});

test("basketReport ties it together", () => {
  const rep = basketReport([{ dishId: "cake", servings: 4 }], ctx, { sources: raw.sources, orderPrice: cat.orderPrice, pantry: new Set(["oil"]) });
  assert.equal(rep.bestStore.storeId, "a");
  assert.equal(rep.bestOrder.source.id, "s1");
  assert.equal(rep.bestOrder.total, 80);
  assert.equal(rep.cookTotal, rep.bestStore.total);
  assert.equal(rep.saving, Math.round((80 - rep.bestStore.total) * 100) / 100);
  assert.ok(rep.pair.total <= rep.bestStore.total);
  const empty = basketReport([], ctx, { sources: raw.sources, orderPrice: cat.orderPrice });
  assert.equal(empty.ranked[0].total, 0);
  assert.equal(empty.orders[0].fee, 0);
});

test("buildCatalog ignores corrupted custom recipes instead of crashing", () => {
  const good = { id: "my-1", name: "טוב", servings: 2, ingredients: [{ id: "flour", qty: 100, unit: "g" }], steps: [{ text: "ערבבו" }] };
  const bad = [null, {}, { id: "x", name: "y", servings: 0, ingredients: [], steps: [] }, { id: "z", name: "z", servings: 2, ingredients: [{ id: "flour", qty: "a", unit: "g" }], steps: [] }, { id: "w", name: "w", servings: 2, ingredients: "nope", steps: [] }];
  const c = buildCatalog(raw, { customRecipes: [...bad, good] });
  assert.ok(c.recById.has("my-1"));
  assert.equal(c.recById.get("my-1").src, "custom");
  assert.equal(c.recById.get("my-1").emoji, "🍲"); // defaults filled in
  for (const id of ["x", "z", "w"]) assert.ok(!c.recById.has(id));
});

test("hourlyGain: shekels saved per hour of active work", async () => {
  const { hourlyGain } = await import("../public/js/lib/calc.js");
  const cmp = compareDish(cake, 4, ctx, { sources: raw.sources, orderPrice: cat.orderPrice });
  const expected = Math.round((cmp.order.total - cmp.cook.ingredients) / (20 / 60));
  assert.equal(hourlyGain(cake, cmp), expected);
  assert.ok(expected > 100);
  assert.equal(hourlyGain({ ...cake, prep: 0, time: { prep: 0 } }, cmp), null);
  assert.equal(hourlyGain(cake, { order: null }), null);
});

test("suggestAdditions: favours dishes that reuse packs already in the basket", async () => {
  const { suggestAdditions } = await import("../public/js/lib/calc.js");
  const base = raw.recipes[0];
  const reuse = { ...base, id: "reuse", name: "ממחזר", servings: 4, ingredients: [{ id: "flour", qty: 200, unit: "g" }, { id: "eggs", qty: 2, unit: "u" }] };
  const sugar = { id: "sugar", name: "סוכר", aliases: [], aisle: "baking", base: "g", pack: { type: "pack", size: 1000 }, ref: 6, density: 0.85, flags: [] };
  const fresh = { ...base, id: "fresh", name: "חדש", servings: 4, ingredients: [{ id: "sugar", qty: 300, unit: "g" }] };
  const prices = { ...raw.prices, table: { ...raw.prices.table, sugar: { a: 6, b: 5.5 } } };
  const c = buildCatalog({ ...raw, ingredients: [...raw.ingredients, sugar], prices, recipes: [base, reuse, fresh] });
  const got = suggestAdditions([{ dishId: "cake", servings: 4 }], c, { limit: 5 });
  assert.deepEqual(got.map((g) => g.rec.id), ["reuse"]); // flour+eggs packs are already in the basket
  assert.ok(got[0].marginal < 1);
  assert.ok(got[0].standalone > 15);
  assert.deepEqual(suggestAdditions([], c), []);
});

test("custom order sources join the comparison with markup, fee and per-dish overrides", () => {
  const c = buildCatalog(raw, { customSources: [{ id: "src-x", name: "מסעדה", markup: 0.25, fee: 15 }, { nope: true }] });
  assert.equal(c.sources.length, raw.sources.length + 1);
  assert.equal(c.sourceById.get("src-x").kind, "custom");
  assert.equal(c.orderPrice("cake", "src-x"), 25); // 20 x 1.25
  const cmp = compareDish(c.recById.get("cake"), 2, c, { sources: c.sources, orderPrice: c.orderPrice });
  assert.equal(cmp.options.length, 3);
  assert.equal(cmp.options.find((o) => o.source.id === "src-x").total, 25 * 2 + 15);
  const c2 = buildCatalog(raw, { customSources: [{ id: "src-x", name: "מסעדה", markup: 0.25, fee: 15 }], orderPrices: { cake: { "src-x": 12 } } });
  assert.equal(c2.orderPrice("cake", "src-x"), 12);
});
