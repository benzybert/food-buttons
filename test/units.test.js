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

test("spokenStep turns machine settings into words for speech", async () => {
  const { spokenStep, settingSpoken } = await import("../public/js/fmt.js");
  assert.equal(spokenStep("בשלו 5 דק'/100°C/מהירות 2. אחר כך ערבבו."), "בשלו 5 דקות, 100 מעלות, מהירות 2. אחר כך ערבבו.");
  assert.equal(spokenStep("קצצו 5 שנ'/מהירות 5."), "קצצו 5 שניות, מהירות 5.");
  assert.match(spokenStep("בשלו 35 דק'/100°C/↺/מהירות 1"), /35 דקות, 100 מעלות, הפוך, מהירות 1/);
  assert.equal(settingSpoken({ time: 90, temp: "varoma", speed: "1" }), "דקה, 30 שניות, וארומה, מהירות 1");
  assert.equal(spokenStep("ערבבו ביד."), "ערבבו ביד.");
});

test("bowlFillMl / fillWarning: soups warn when scaled beyond the bowl", async () => {
  const { bowlFillMl, fillWarning } = await import("../public/js/lib/derive.js");
  const { loadCatalog } = await import("./helpers.js");
  const c = loadCatalog();
  const soup = c.recById.get("veg-soup");
  assert.equal(fillWarning(soup, c.ingById, 1), null);
  assert.ok(bowlFillMl(soup, c.ingById, 2) > 2 * bowlFillMl(soup, c.ingById, 1) - 5);
  assert.equal(fillWarning(soup, c.ingById, 1.1).level, "tight");
  assert.equal(fillWarning(soup, c.ingById, 2).level, "over");
  assert.equal(fillWarning(c.recById.get("shakshuka"), c.ingById, 5), null); // only checked for soups/sauces/drinks
});
