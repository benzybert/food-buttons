import test from "node:test";
import assert from "node:assert/strict";
import { toBase, formatQty, formatNumber, scaleQty } from "../public/js/lib/units.js";
import { fixture } from "./helpers.js";

const { ingredients } = fixture();
const by = Object.fromEntries(ingredients.map((i) => [i.id, i]));

test("toBase: weight/volume/unit conversions", () => {
  assert.equal(toBase(by.flour, 2, "cup"), 2 * 240 * 0.55); // cups -> ml -> g with density
  assert.equal(toBase(by.flour, 1, "kg"), 1000);
  assert.equal(toBase(by.onion, 2, "u"), 300);
  assert.equal(toBase(by.onion, 300, "g"), 300);
  assert.equal(toBase(by.eggs, 3, "u"), 3);
  assert.equal(toBase(by.eggs, 110, "g"), 2); // grams -> units via unit weight
  assert.equal(toBase(by.oil, 2, "tbsp"), 30);
  assert.ok(Math.abs(toBase(by.oil, 92, "g") - 100) < 1e-9);
  assert.equal(toBase(by.flour, 1, "pinch"), 0.5);
});

test("toBase: impossible conversions are NaN", () => {
  assert.ok(Number.isNaN(toBase(by.flour, 1, "u"))); // flour has no unit weight
  assert.ok(Number.isNaN(toBase(by.oil, 1, "u")));
});

test("formatNumber uses friendly fractions", () => {
  assert.equal(formatNumber(0.5), "½");
  assert.equal(formatNumber(1.5), "1½");
  assert.equal(formatNumber(0.25), "¼");
  assert.equal(formatNumber(2), "2");
  assert.equal(formatNumber(2.333), "2⅓");
  assert.equal(formatNumber(1.04), "1");
  assert.equal(formatNumber(2.97), "3");
});

test("formatQty picks Hebrew singular/plural and rounds sensibly", () => {
  assert.equal(formatQty(1, "tbsp"), "1 כף");
  assert.equal(formatQty(2, "tbsp"), "2 כפות");
  assert.equal(formatQty(0.5, "cup"), "½ כוס");
  assert.equal(formatQty(350, "g"), "350 גרם");
  assert.equal(formatQty(1500, "g"), "1½ ק״ג");
  assert.equal(formatQty(1000, "ml"), "1 ליטר");
  assert.equal(formatQty(3, "u"), "3");
  assert.equal(formatQty(1, "pinch"), "קורט");
  assert.equal(formatQty(233, "g"), "235 גרם");
});

test("scaleQty keeps small units tidy", () => {
  assert.deepEqual(scaleQty(1, "tsp", 3), { qty: 1, unit: "tbsp" });
  assert.deepEqual(scaleQty(2, "tbsp", 0.5), { qty: 1, unit: "tbsp" });
  assert.deepEqual(scaleQty(100, "g", 2), { qty: 200, unit: "g" });
});
