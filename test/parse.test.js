import test from "node:test";
import assert from "node:assert/strict";
import { parseQuantity, parseIngredientLine, buildIndex, matchIngredient, extractSettings, parseStep, parseDuration, parseRecipeText, parseJsonLd } from "../public/js/lib/parse.js";
import { loadRaw } from "./helpers.js";

const index = buildIndex(loadRaw().ingredients);
const line = (s) => parseIngredientLine(s, index);

test("parseQuantity: integers, decimals, fractions, ranges, words", () => {
  assert.equal(parseQuantity("600 גרם").qty, 600);
  assert.equal(parseQuantity("1,5 ק״ג").qty, 1.5);
  assert.equal(parseQuantity("1/2 כוס").qty, 0.5);
  assert.equal(parseQuantity("1 1/2 כוסות").qty, 1.5);
  assert.equal(parseQuantity("½ כוס").qty, 0.5);
  assert.equal(parseQuantity("1½ כוס").qty, 1.5);
  assert.equal(parseQuantity("2-3 שיני שום").qty, 3);
  assert.equal(parseQuantity("1 וחצי כפית").qty, 1.5);
  assert.equal(parseQuantity("חצי כוס").qty, 0.5);
  assert.equal(parseQuantity("רבע כפית").qty, 0.25);
  assert.equal(parseQuantity("מלח"), null);
});

test("parseIngredientLine: quantity, unit, and catalog match", () => {
  assert.deepEqual(pick(line("600 גרם שוקי עוף")), { qty: 600, unit: "g", id: "chicken-thighs" });
  assert.deepEqual(pick(line("2 כפות שמן זית")), { qty: 2, unit: "tbsp", id: "olive-oil" });
  assert.deepEqual(pick(line("1/2 כפית מלח")), { qty: 0.5, unit: "tsp", id: "salt" });
  assert.deepEqual(pick(line("1000 מ\"ל מים")), { qty: 1000, unit: "ml", id: "water" });
  assert.deepEqual(pick(line("500גרם קמח")), { qty: 500, unit: "g", id: "flour" });
  assert.deepEqual(pick(line("3 ק\"ג תפוחי אדמה")), { qty: 3, unit: "kg", id: "potato" });
  assert.deepEqual(pick(line("2 גזרים")), { qty: 2, unit: "u", id: "carrot" });
  assert.deepEqual(pick(line("3 שיני שום")), { qty: 3, unit: "u", id: "garlic" });
  assert.deepEqual(pick(line("- 8 ביצים")), { qty: 8, unit: "u", id: "eggs" });
});

test("parseIngredientLine: longest alias wins (olive oil is not oil, green onion is not onion)", () => {
  assert.equal(line("2 כפות שמן זית כתית").id, "olive-oil");
  assert.equal(line("2 כפות שמן").id, "oil");
  assert.equal(line("1 בצל ירוק").id, "scallion");
  assert.equal(line("1 בצל סגול").id, "red-onion");
  assert.equal(line("1 בצל").id, "onion");
  assert.equal(line("1 כף אבקת מרק עוף").id, "chicken-stock");
  assert.equal(line("1 כף אבקת מרק ירקות").id, "veg-stock");
});

test("parseIngredientLine: notes, to-taste and pinches", () => {
  const a = line("1 בצל, קצוץ דק");
  assert.equal(a.id, "onion");
  assert.equal(a.note, "קצוץ דק");
  const b = line("מלח, לפי הטעם");
  assert.equal(b.id, "salt");
  assert.equal(b.toTaste, true);
  assert.equal(b.unit, "pinch");
  const c = line("קורט מלח");
  assert.deepEqual(pick(c), { qty: 1, unit: "pinch", id: "salt" });
  const d = line("2 כפות גדושות קמח (מנופה)");
  assert.deepEqual(pick(d), { qty: 2, unit: "tbsp", id: "flour" });
});

test("parseIngredientLine: unknown ingredient keeps its name and has no id", () => {
  const x = line("200 גרם קינואה אדומה");
  assert.equal(x.id, null);
  assert.equal(x.name, "קינואה אדומה");
  assert.equal(x.qty, 200);
});

test("matchIngredient handles plural forms via light stemming", () => {
  assert.equal(matchIngredient("גזרים", index).id, "carrot");
  assert.equal(matchIngredient("הבצל", index).id, "onion");
  assert.equal(matchIngredient("קטשופ", index), null);
});

test("extractSettings: time/temperature/speed groups", () => {
  const [s] = extractSettings("בשלו 5 דק'/100°C/מהירות 2.");
  assert.deepEqual({ time: s.time, temp: s.temp, speed: s.speed, reverse: s.reverse }, { time: 300, temp: 100, speed: "2", reverse: false });
  const [r] = extractSettings("בשלו 35 דק'/100°C/↺/מהירות 1.");
  assert.equal(r.reverse, true);
  assert.equal(r.speed, "1");
  const [k] = extractSettings("לשו 2 דק'/תפקיד לישה.");
  assert.equal(k.kneading, true);
  assert.equal(k.time, 120);
  const [v] = extractSettings("25 דק'/Varoma/מהירות 1");
  assert.equal(v.temp, "varoma");
  const [sec] = extractSettings("קצצו 5 שנ'/מהירות 5");
  assert.equal(sec.time, 5);
  const [range] = extractSettings("טחנו 1 דק'/מהירות 4 עד 9");
  assert.equal(range.speed, "4–9");
  const [spoon] = extractSettings("ערבבו 10 שנ'/מהירות כף");
  assert.equal(spoon.speed, "spoon");
  const [half] = extractSettings("הקציפו 2 דק'/מהירות 3.5");
  assert.equal(half.speed, "3.5");
  const [mixed] = extractSettings("חממו 1 דק' 30 שנ'/80°C/מהירות 1");
  assert.equal(mixed.time, 90);
  assert.equal(extractSettings("בשלו 25 דקות על אש קטנה").length, 0);
  assert.equal(extractSettings("בשלו 5 דק' ואז הוסיפו").length, 0);
});

test("parseStep returns text and parsed settings", () => {
  const st = parseStep("קצצו 5 שנ'/מהירות 5. ואז בשלו 10 דק'/100°C/מהירות 1.");
  assert.equal(st.settings.length, 2);
  assert.equal(st.settings[1].time, 600);
  assert.equal(parseStep("ערבבו ביד.").settings, undefined);
});

test("parseDuration", () => {
  assert.equal(parseDuration("45 דקות"), 45);
  assert.equal(parseDuration("1 שעה 10 דק'"), 70);
  assert.equal(parseDuration("שעה וחצי"), 0); // not understood -> 0, never a wrong guess
  assert.equal(parseDuration("PT1H10M"), 70);
  assert.equal(parseDuration("PT45M"), 45);
});

const PASTED = `פסטה ברוטב עגבניות
4 מנות
זמן הכנה: 10 דקות
זמן בישול: 20 דק'

מצרכים
400 גרם פסטה
400 גרם עגבניות מרוסקות
2 שיני שום
לרוטב:
1 כף שמן זית
1 כפית מלח
200 גרם קינואה

אופן ההכנה
1. הכניסו לקערה את השום וקצצו 5 שנ'/מהירות 5.
2. הוסיפו את שאר המצרכים ובשלו 15 דק'/100°C/מהירות 1
   עד שהרוטב סמיך.
3. בשלו את הפסטה והגישו.`;

test("parseRecipeText: sections, meta, sub-headers, wrapped steps, unresolved ingredients", () => {
  const d = parseRecipeText(PASTED, index);
  assert.equal(d.name, "פסטה ברוטב עגבניות");
  assert.equal(d.servings, 4);
  assert.equal(d.prep, 10);
  assert.equal(d.cook, 20);
  assert.equal(d.ingredients.length, 6);
  assert.equal(d.ingredients[0].id, "pasta");
  assert.equal(d.ingredients.at(-1).custom, "קינואה");
  assert.equal(d.steps.length, 3);
  assert.match(d.steps[1].text, /עד שהרוטב סמיך/);
  assert.equal(d.steps[1].settings[0].time, 900);
  assert.ok(d.warnings.some((w) => /לא זוהו/.test(w)));
});

test("parseRecipeText: no headers - guesses ingredient vs step lines", () => {
  const d = parseRecipeText("עוגה\n300 גרם קמח\n2 ביצים\nערבבו הכול יחד ואפו חצי שעה.", index);
  assert.equal(d.ingredients.length, 2);
  assert.equal(d.steps.length, 1);
  assert.ok(d.warnings.some((w) => /כותרות/.test(w)));
});

test("parseJsonLd: schema.org Recipe", () => {
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite" },
      {
        "@type": "Recipe",
        name: "חביתה",
        recipeYield: "2 מנות",
        prepTime: "PT5M",
        totalTime: "PT15M",
        recipeIngredient: ["4 ביצים", "1/2 כפית מלח"],
        recipeInstructions: [{ "@type": "HowToStep", text: "טרפו." }, { "@type": "HowToStep", text: "טגנו 3 דק'/מהירות 1." }],
      },
    ],
  };
  const d = parseJsonLd(ld, index);
  assert.equal(d.name, "חביתה");
  assert.equal(d.servings, 2);
  assert.equal(d.prep, 5);
  assert.equal(d.cook, 10);
  assert.equal(d.ingredients[0].id, "eggs");
  assert.equal(d.steps.length, 2);
  assert.equal(parseJsonLd({ "@type": "Thing" }, index), null);
  assert.equal(parseJsonLd("not json", index), null);
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld["@graph"][1])}</script></html>`;
  assert.equal(parseRecipeText(html, index).name, "חביתה");
});

function pick(p) {
  return { qty: p.qty, unit: p.unit, id: p.id };
}
