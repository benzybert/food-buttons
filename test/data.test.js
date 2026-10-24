import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "../tools/build-data.js";
import { toBase } from "../public/js/lib/units.js";
import { loadRaw, loadCatalog, loadPricedCatalog } from "./helpers.js";
import { buildCatalog } from "../public/js/lib/catalog.js";
import { seeded } from "../public/js/lib/plan.js";
import { basketReport, dishCostByStore } from "../public/js/lib/calc.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

test("data-src builds cleanly (every ingredient resolved, units convertible, no meat+dairy)", () => {
  const { errors, recipes, ingredients } = buildAll();
  assert.deepEqual(errors, []);
  assert.ok(recipes.length >= 30);
  assert.ok(ingredients.length >= 90);
});

test("generated JSON on disk matches data-src (run `npm run build:data` if this fails)", () => {
  const { recipes, ingredients } = buildAll();
  const disk = loadRaw();
  assert.deepEqual(JSON.parse(JSON.stringify(recipes)), disk.recipes);
  assert.deepEqual(JSON.parse(JSON.stringify(ingredients)), disk.ingredients);
});

test("every recipe is well-formed", () => {
  const cat = loadCatalog();
  for (const r of cat.recipes) {
    assert.ok(r.name && r.emoji, `${r.id} name/emoji`);
    assert.ok(r.servings > 0, `${r.id} servings`);
    assert.ok(r.steps.length >= 2, `${r.id} steps`);
    assert.notEqual(r.kosher, "mixed", `${r.id} mixes meat and dairy`);
    for (const l of r.ingredients) {
      const ing = cat.ingById.get(l.id);
      assert.ok(ing, `${r.id}: unknown ${l.id}`);
      assert.ok(toBase(ing, l.qty, l.unit) >= 0, `${r.id}: ${l.id} ${l.qty}${l.unit}`);
    }
  }
});

test("recipe ids are URL-safe and unique", () => {
  const { recipes } = loadRaw();
  const ids = recipes.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test("steps never fabricate settings: Varoma/temperature values are sane", () => {
  const { recipes } = loadRaw();
  for (const r of recipes) {
    for (const s of r.steps) {
      for (const st of s.settings || []) {
        if (typeof st.temp === "number") assert.ok(st.temp >= 37 && st.temp <= 120, `${r.id} temp ${st.temp}`);
        if (st.time != null) assert.ok(st.time > 0 && st.time <= 3 * 3600, `${r.id} time ${st.time}`);
        if (st.speed && !["spoon", "turbo"].includes(st.speed)) assert.match(st.speed, /^\d+(\.5)?(–\d+)?$/, `${r.id} speed ${st.speed}`);
      }
    }
  }
});

test("the dataset ships no invented numbers: no prices, no reference prices, no order prices, no fees", () => {
  const { ingredients, recipes, stores, prices, sources } = loadRaw();
  assert.ok(!ingredients.some((i) => "ref" in i), "an ingredient carries a reference price");
  assert.notEqual(prices.meta.kind, "sample");
  // The fields below may carry numbers only once they come from a real source, which says so with kind "real".
  if (prices.meta.kind !== "real") {
    assert.deepEqual(prices.table, {}, "prices.json has prices but is not marked real");
    assert.ok(!recipes.some((r) => "order" in r), "a recipe carries an order price");
    for (const s of stores) assert.deepEqual(Object.keys(s).sort(), ["id", "name"], `${s.id} has more than a name`);
    for (const s of sources) assert.deepEqual(Object.keys(s).sort(), ["id", "kind", "name"], `${s.id} has fees or markups`);
  }
});

test("price rows, if any, are well-formed: known ingredient and store ids, positive numbers or null", () => {
  const { ingredients, stores, prices } = loadRaw();
  const ings = new Set(ingredients.map((i) => i.id));
  const sids = new Set(stores.map((s) => s.id));
  for (const [id, row] of Object.entries(prices.table)) {
    assert.ok(ings.has(id), `price row for unknown ingredient ${id}`);
    for (const [sid, v] of Object.entries(row)) {
      assert.ok(sids.has(sid), `${id}: unknown store ${sid}`);
      assert.ok(v === null || (Number.isFinite(v) && v > 0), `${id}@${sid}: ${v}`);
    }
  }
});

test("with no prices nothing is computed: every total is null, never zero, never partial", () => {
  // The shipped prices.json fills up nightly, so this builds the catalog without it.
  const cat = buildCatalog({ ...loadRaw(), prices: { meta: { kind: "none" }, table: {} } });
  assert.deepEqual(cat.prices.table, {});
  for (const r of cat.recipes) {
    for (const row of dishCostByStore(r, r.servings, cat)) {
      assert.equal(row.total, null, `${r.id}@${row.storeId}`);
      assert.equal(row.perServing, null);
      assert.ok(row.missing > 0 || r.ingredients.every((l) => !l.id || cat.ingById.get(l.id).free), `${r.id}: nothing missing yet no total`);
    }
  }
  const items = cat.recipes.map((r) => ({ dishId: r.id, servings: r.servings }));
  const rep = basketReport(items, cat, { sources: cat.sources, orderPrice: cat.orderPrice });
  assert.equal(rep.bestStore, null);
  assert.equal(rep.cookTotal, null);
  assert.equal(rep.saving, null);
  assert.equal(rep.bestOrder, null, "no order price ships either");
  assert.ok(rep.ranked.every((r) => r.total === null));
});

test("whole-catalog basket with typed-in prices: cooking beats nothing odd, and the splits are consistent", () => {
  const cat = loadPricedCatalog(seeded(77));
  const items = cat.recipes.map((r) => ({ dishId: r.id, servings: r.servings }));
  const rep = basketReport(items, cat, { sources: cat.sources, orderPrice: cat.orderPrice, pantry: new Set(cat.ingredients.filter((i) => i.home).map((i) => i.id)) });
  assert.ok(rep.bestStore.complete);
  assert.ok(Number.isFinite(rep.saving));
  assert.ok(rep.perItem.total <= rep.bestStore.total + 1e-6);
  assert.ok(rep.pair.total <= rep.bestStore.total + 1e-6);
  assert.ok(rep.perItem.total <= rep.pair.total + 1e-6);
});

test("price history and branches, if any, are well-formed: known ids, arrays aligned with the days", () => {
  const { ingredients, stores } = loadRaw();
  const ings = new Set(ingredients.map((i) => i.id));
  const sids = new Set(stores.map((s) => s.id));
  const history = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "price-history.json"), "utf8"));
  assert.ok(Array.isArray(history.days));
  assert.deepEqual([...history.days].sort(), history.days);
  for (const [id, row] of Object.entries(history.table)) {
    assert.ok(ings.has(id), `history for unknown ingredient ${id}`);
    for (const [sid, arr] of Object.entries(row)) {
      assert.ok(sids.has(sid), `${id}: unknown store ${sid}`);
      assert.equal(arr.length, history.days.length, `${id}@${sid} not aligned`);
      assert.ok(arr.every((v) => v === null || (Number.isFinite(v) && v > 0)));
    }
  }
  const { branches } = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "branches.json"), "utf8"));
  for (const b of branches) {
    assert.ok(sids.has(b.store), `branch of unknown store ${b.store}`);
    assert.ok(b.id, "branch without id");
    if ("lat" in b) assert.ok(b.lat > 29 && b.lat < 34 && b.lon > 34 && b.lon < 36.5, `${b.store}/${b.id} is not in Israel`);
  }
});

test("every file the app loads exists", () => {
  for (const f of ["index.html", "style.css", "data/ingredients.json", "data/recipes.json", "data/prices.json", "data/stores.json", "data/sources.json", "data/price-history.json", "data/branches.json"]) {
    assert.ok(fs.existsSync(path.join(PUBLIC, f)), f);
  }
});

test("service worker precaches only files that exist", async () => {
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.ok(list.includes("index.html") && list.includes("js/main.js") && list.includes("manifest.webmanifest"));
  for (const f of list) if (f !== "./") assert.ok(fs.existsSync(path.join(PUBLIC, f)), `precached but missing: ${f}`);
});

test("soups, sauces and drinks fit in the bowl at their default servings", async () => {
  const { bowlFillMl, BOWL_SAFE_ML } = await import("../public/js/lib/derive.js");
  const cat = loadCatalog();
  for (const r of cat.recipes) {
    if (!["soup", "sauce", "drink"].includes(r.category)) continue;
    assert.ok(bowlFillMl(r, cat.ingById) <= BOWL_SAFE_ML, `${r.id} fills ~${bowlFillMl(r, cat.ingById)} ml`);
  }
});

test("nutrition: every ingredient has kcal and recipes land in a plausible range", () => {
  const cat = loadCatalog();
  for (const i of cat.ingredients) assert.ok(Number.isFinite(i.kcal) && i.kcal >= 0, `${i.id} kcal`);
  for (const r of cat.recipes) assert.ok(r.kcal >= 20 && r.kcal <= 900, `${r.id}: ${r.kcal} kcal per serving`);
  // spot checks against well-known values
  assert.ok(Math.abs(cat.recById.get("pasta-pomodoro").kcal - 482) <= 60);
  assert.ok(cat.recById.get("tomato-salsa").kcal < 60);
});

test("deriveRecipe computes kcal for imported recipes and discounts frying oil", async () => {
  const { kcalPerServing } = await import("../public/js/lib/derive.js");
  const cat = loadCatalog();
  const r = { servings: 2, ingredients: [{ id: "oil", qty: 100, unit: "ml" }] };
  const fried = { servings: 2, ingredients: [{ id: "oil", qty: 100, unit: "ml", note: "לטיגון" }] };
  assert.equal(kcalPerServing(r, cat.ingById), 442);
  assert.equal(kcalPerServing(fried, cat.ingById), 88);
  assert.equal(kcalPerServing({ servings: 1, ingredients: [{ custom: "x", qty: 1, unit: "g" }] }, cat.ingById), null);
  assert.equal(kcalPerServing({ servings: 2, ingredients: [{ id: "eggs", qty: 2, unit: "u" }] }, cat.ingById), Math.round((2 * 55 * 1.43) / 2));
});
