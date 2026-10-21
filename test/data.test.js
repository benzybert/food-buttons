import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "../tools/build-data.js";
import { toBase } from "../public/js/lib/units.js";
import { loadRaw, loadCatalog } from "./helpers.js";
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

test("every recipe is well-formed and priced", () => {
  const cat = loadCatalog();
  for (const r of cat.recipes) {
    assert.ok(r.name && r.emoji, `${r.id} name/emoji`);
    assert.ok(r.servings > 0 && r.order > 0, `${r.id} servings/order`);
    assert.ok(r.steps.length >= 2, `${r.id} steps`);
    assert.notEqual(r.kosher, "mixed", `${r.id} mixes meat and dairy`);
    for (const l of r.ingredients) {
      const ing = cat.ingById.get(l.id);
      assert.ok(ing, `${r.id}: unknown ${l.id}`);
      assert.ok(toBase(ing, l.qty, l.unit) >= 0, `${r.id}: ${l.id} ${l.qty}${l.unit}`);
    }
    // Cooking must be cheaper per serving than ordering for the sample data to make sense, but never free.
    const cheapest = dishCostByStore(r, r.servings, cat)[0];
    assert.ok(cheapest.perServing > 0.3, `${r.id} suspiciously cheap: ${cheapest.perServing}`);
    assert.ok(cheapest.perServing < r.order * 1.2, `${r.id} costs ${cheapest.perServing}/serving vs order ${r.order}`);
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

test("prices: every priced ingredient has rows for the always-stocked stores", () => {
  const { ingredients, stores, prices } = loadRaw();
  for (const ing of ingredients) {
    if (ing.free) continue;
    const row = prices.table[ing.id];
    assert.ok(row, `no price row for ${ing.id}`);
    for (const s of ["shufersal", "ramilevy", "victory"]) assert.ok(row[s] > 0, `${ing.id}@${s}`);
    for (const s of stores) assert.ok(s.id in row, `${ing.id} missing ${s.id} key`);
  }
  assert.equal(prices.meta.kind, "sample");
});

test("sample prices stay close to the reference price (generator sanity)", () => {
  const { ingredients, prices } = loadRaw();
  for (const ing of ingredients) {
    if (ing.free) continue;
    for (const [sid, p] of Object.entries(prices.table[ing.id])) {
      if (p == null) continue;
      assert.ok(p > ing.ref * 0.6 && p < ing.ref * 1.5, `${ing.id}@${sid} ${p} vs ref ${ing.ref}`);
    }
  }
});

test("whole-catalog basket: cooking everything beats ordering everything in the sample data", () => {
  const cat = loadCatalog();
  const items = cat.recipes.map((r) => ({ dishId: r.id, servings: r.servings }));
  const rep = basketReport(items, cat, { sources: cat.sources, orderPrice: cat.orderPrice, pantry: new Set(cat.ingredients.filter((i) => i.home).map((i) => i.id)) });
  assert.ok(rep.bestStore.complete);
  assert.ok(rep.saving > 0, `saving ${rep.saving}`);
  assert.ok(rep.perItem.total <= rep.bestStore.total + 1e-6);
  assert.ok(rep.pair.total <= rep.bestStore.total + 1e-6);
  assert.ok(rep.perItem.total <= rep.pair.total + 1e-6);
});

test("every file the app loads exists", () => {
  for (const f of ["index.html", "style.css", "data/ingredients.json", "data/recipes.json", "data/prices.json", "data/stores.json", "data/sources.json"]) {
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
