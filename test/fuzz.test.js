import test from "node:test";
import assert from "node:assert/strict";
import { seeded } from "../public/js/lib/plan.js";
import { basketReport, basketNeeds, compareStores, priceAtStore, purchaseFor } from "../public/js/lib/calc.js";
import { loadCatalog } from "./helpers.js";

const cat = loadCatalog();
const rnd = seeded(20261021);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

function randomBasket() {
  const n = 1 + Math.floor(rnd() * 8);
  return Array.from({ length: n }, () => ({ dishId: pick(cat.recipes).id, servings: 1 + Math.floor(rnd() * 12) }));
}
function randomPantry() {
  const ids = cat.ingredients.filter(() => rnd() < 0.2).map((i) => i.id);
  return new Set(ids);
}

test("invariants hold for 200 random baskets", () => {
  for (let k = 0; k < 200; k++) {
    const items = randomBasket();
    const pantry = randomPantry();
    const delivery = rnd() < 0.5;
    const rep = basketReport(items, cat, { pantry, delivery, sources: cat.sources, orderPrice: cat.orderPrice, hourly: rnd() < 0.3 ? 60 : 0 });
    const tag = JSON.stringify(items);

    // prices are sane
    for (const r of rep.ranked) {
      assert.ok(r.subtotal >= 0 && Number.isFinite(r.subtotal), `${tag}: subtotal`);
      assert.ok(r.consumed <= r.subtotal + 0.011, `${tag}: consumed ${r.consumed} > bought ${r.subtotal}`);
      assert.ok(r.leftover >= -0.011, `${tag}: negative leftover`);
      assert.ok(r.total >= r.subtotal - 1e-9, `${tag}: total below subtotal`);
      for (const l of r.lines) {
        assert.ok(l.bought + 1e-6 >= l.need, `${tag}: bought ${l.bought} < need ${l.need} for ${l.ingId}`);
        assert.ok(!pantry.has(l.ingId), `${tag}: pantry item ${l.ingId} on the list`);
      }
    }
    // ranking: complete stores first, then ascending total
    const sorted = [...rep.ranked].sort((a, b) => Number(!a.complete) - Number(!b.complete) || a.total - b.total);
    assert.deepEqual(rep.ranked.map((r) => r.storeId), sorted.map((r) => r.storeId), `${tag}: ranking`);

    // splitting can only help: per item <= best pair <= cheapest single store (subtotal, no delivery)
    const bestSubtotal = Math.min(...rep.ranked.map((r) => r.subtotal));
    assert.ok(rep.perItem.total <= rep.pair.total + 0.011 || rep.pair.missing > 0, `${tag}: per-item ${rep.perItem.total} > pair ${rep.pair.total}`);
    if (rep.pair.missing === 0 && rep.ranked.every((r) => r.complete)) assert.ok(rep.pair.total <= bestSubtotal + 0.011, `${tag}: pair ${rep.pair.total} > single ${bestSubtotal}`);

    // scaling a basket up never makes it cheaper
    const doubled = basketReport(items.map((i) => ({ ...i, servings: i.servings * 2 })), cat, { pantry, sources: cat.sources, orderPrice: cat.orderPrice });
    const single = basketReport(items, cat, { pantry, sources: cat.sources, orderPrice: cat.orderPrice });
    assert.ok(doubled.bestStore.subtotal + 0.011 >= single.bestStore.subtotal * 0.999, `${tag}: doubling got cheaper`);

    // verdict arithmetic
    if (rep.bestOrder) assert.equal(rep.saving, Math.round((rep.bestOrder.total - rep.cookTotal) * 100) / 100);
  }
});

test("adding the same dish twice equals doubling its servings (needs are linear)", () => {
  for (let k = 0; k < 40; k++) {
    const dish = pick(cat.recipes);
    const n = 1 + Math.floor(rnd() * 8);
    const twice = basketNeeds([{ dishId: dish.id, servings: n }, { dishId: dish.id, servings: n }], cat).needs;
    const doubled = basketNeeds([{ dishId: dish.id, servings: 2 * n }], cat).needs;
    for (const [id, v] of doubled) assert.ok(Math.abs(twice.get(id).need - v.need) < 1e-6, `${dish.id}/${id}`);
  }
});

test("purchaseFor is monotonic and never under-buys", () => {
  for (const ing of cat.ingredients.filter((i) => !i.free)) {
    let prev = 0;
    for (let need = 1; need < ing.pack.size * 3; need += Math.max(1, Math.floor(ing.pack.size / 7))) {
      const { bought } = purchaseFor(ing, need);
      assert.ok(bought >= need - 1e-6, `${ing.id}: ${bought} < ${need}`);
      assert.ok(bought >= prev, `${ing.id}: not monotonic`);
      prev = bought;
    }
  }
});

test("a store's total is the sum of its lines", () => {
  const items = randomBasket();
  const { needs } = basketNeeds(items, cat);
  for (const r of compareStores(needs, cat)) {
    const sum = r.lines.reduce((a, l) => a + l.cost, 0);
    assert.ok(Math.abs(sum - r.subtotal) < 0.011);
    const again = priceAtStore(needs, r.store, cat);
    assert.equal(again.subtotal, r.subtotal);
  }
});
