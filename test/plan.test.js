import test from "node:test";
import assert from "node:assert/strict";
import { suggestWeek, cookableWith, seeded } from "../public/js/lib/plan.js";
import { normalizePhone } from "../public/js/views/order.js";
import { loadCatalog } from "./helpers.js";

const cat = loadCatalog();
const costOf = (r) => r.servings * 6;

test("seeded PRNG is deterministic", () => {
  const a = seeded(7);
  const b = seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("suggestWeek returns distinct dishes, deterministic for a seed", () => {
  const pick = suggestWeek(cat.recipes, costOf, { count: 5, seed: 42 });
  assert.equal(pick.length, 5);
  assert.equal(new Set(pick.map((r) => r.id)).size, 5);
  assert.deepEqual(pick.map((r) => r.id), suggestWeek(cat.recipes, costOf, { count: 5, seed: 42 }).map((r) => r.id));
  assert.ok(pick.every((r) => ["main", "soup"].includes(r.category)));
});

test("suggestWeek respects a feasible budget and varies categories", () => {
  const cost = (r) => 20 + (r.id.length % 7) * 5;
  const pick = suggestWeek(cat.recipes, cost, { count: 4, budget: 120, seed: 5 });
  assert.ok(pick.reduce((a, r) => a + cost(r), 0) <= 120);
  assert.ok(new Set(pick.map((r) => r.category)).size >= 2);
});

test("suggestWeek handles tiny pools and empty input", () => {
  assert.deepEqual(suggestWeek([], costOf, { count: 3 }), []);
  assert.equal(suggestWeek(cat.recipes.slice(0, 2), costOf, { count: 5 }).length, 2);
});

test("cookableWith ranks by how little is missing", () => {
  const pantry = new Set(["eggs", "crushed-tomatoes", "red-pepper", "onion", "garlic", "oil", "tomato-paste", "paprika", "cumin", "salt", "chili"]);
  const ranked = cookableWith(cat.recipes, pantry, cat.ingById);
  assert.equal(ranked[0].rec.id, "shakshuka");
  assert.equal(ranked[0].missing.length, 0);
  assert.ok(ranked[0].missing.length <= ranked[5].missing.length);
});

test("normalizePhone: Israeli formats to wa.me numbers", () => {
  assert.equal(normalizePhone("050-123-4567"), "972501234567");
  assert.equal(normalizePhone("0501234567"), "972501234567");
  assert.equal(normalizePhone("+972 50 123 4567"), "972501234567");
  assert.equal(normalizePhone("972501234567"), "972501234567");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("12"), "");
});
