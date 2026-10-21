// Derived recipe facts: kosher type, diet tags, allergens, equipment, timers.
// Pure functions, shared by the build step and the in-browser importer.

import { toBase } from "./units.js";

const FLAG_ALLERGENS = { g: "gluten", e: "eggs", d: "milk", p: "peanuts", n: "tree-nuts", s: "sesame", o: "soy", f: "fish" };

export const ALLERGEN_LABELS = {
  gluten: "גלוטן",
  eggs: "ביצים",
  milk: "חלב",
  peanuts: "בוטנים",
  "tree-nuts": "אגוזי עץ",
  sesame: "שומשום",
  soy: "סויה",
  fish: "דגים",
};

export const DIET_LABELS = { vegan: "טבעוני", vegetarian: "צמחוני", "gluten-free": "ללא גלוטן" };
export const KOSHER_LABELS = { meat: "בשרי", dairy: "חלבי", parve: "פרווה", mixed: "בשרי + חלבי" };

export function ingredientFlags(ing) {
  return new Set(ing.flags || []);
}

/** Facts derived from the ingredients (those that resolved to the catalog). */
export function deriveFromIngredients(recipe, ingById) {
  const flags = new Set();
  for (const line of recipe.ingredients) {
    const ing = line.id ? ingById.get(line.id) : null;
    if (ing) for (const f of ing.flags || []) flags.add(f);
  }
  let kosher = "parve";
  if (flags.has("m") && flags.has("d")) kosher = "mixed";
  else if (flags.has("m")) kosher = "meat";
  else if (flags.has("d")) kosher = "dairy";

  const diet = [];
  const animal = ["m", "f", "d", "e", "h", "a"].some((f) => flags.has(f));
  const vegetarianBreakers = ["m", "f", "a"].some((f) => flags.has(f));
  if (!animal) diet.push("vegan");
  if (!vegetarianBreakers) diet.push("vegetarian");
  if (!flags.has("g")) diet.push("gluten-free");

  const allergens = [...flags].map((f) => FLAG_ALLERGENS[f]).filter(Boolean).sort();
  return { kosher, diet, allergens };
}

export function deriveEquipment(recipe) {
  const text = recipe.steps.map((s) => s.text).join(" ");
  const eq = [];
  if (/(?:ה|מגש |קערת )וארומה|במגש הוארומה/.test(text)) eq.push("varoma");
  if (/סל (?:ה)?בישול/.test(text)) eq.push("basket");
  if (/פרפר/.test(text)) eq.push("butterfly");
  if (/בתנור|מעלות/.test(text)) eq.push("oven");
  if (/(?:ה|ל)שרו|הושרו|להשרות/.test(text)) eq.push("soak");
  return eq;
}

export const EQUIPMENT_LABELS = {
  varoma: "וארומה",
  basket: "סל בישול",
  butterfly: "פרפר",
  oven: "תנור",
  soak: "השרייה מראש",
};

// Oil used for deep frying is mostly left in the pan; only about a fifth ends up in the food.
const FRY_ABSORPTION = 0.2;

/** Approximate kilocalories per serving (null when no ingredient has nutrition data). */
export function kcalPerServing(recipe, ingById, factor = 1) {
  let total = 0;
  let known = 0;
  for (const l of recipe.ingredients) {
    const ing = l.id ? ingById.get(l.id) : null;
    if (!ing || ing.kcal == null) continue;
    const base = toBase(ing, l.qty * factor, l.unit);
    if (!Number.isFinite(base)) continue;
    const amount100 = ing.base === "u" ? (base * (ing.unitWeight || 0)) / 100 : base / 100;
    total += amount100 * ing.kcal * (/לטיגון/.test(l.note || "") ? FRY_ABSORPTION : 1);
    known++;
  }
  return known ? Math.round(total / (recipe.servings * factor)) : null;
}

/** Adds derived fields (kosher/diet/allergens/equipment/time/kcal) onto a copy of the recipe. */
export function deriveRecipe(recipe, ingById) {
  const base = deriveFromIngredients(recipe, ingById);
  const prep = Number(recipe.prep) || 0;
  const cook = Number(recipe.cook) || 0;
  return {
    ...recipe,
    ...base,
    equipment: deriveEquipment(recipe),
    kcal: kcalPerServing(recipe, ingById),
    time: { prep, cook, total: prep + cook },
  };
}

// ------------------------------------------------------------------ bowl capacity

export const BOWL_MAX_ML = 2200; // physical maximum of a Thermomix bowl
export const BOWL_SAFE_ML = 2000; // recommended maximum when heating
export const FILL_CATEGORIES = new Set(["soup", "sauce", "drink"]); // where everything goes into the bowl

/**
 * Rough volume of everything in the bowl: liquids count fully, solids ~85% (they pack and soften),
 * fluffy powders (flour, spices) hardly count. Good enough to warn when scaling a soup too far.
 */
export function bowlFillMl(rec, ingById, factor = 1) {
  let ml = 0;
  for (const l of rec.ingredients) {
    const ing = l.id ? ingById.get(l.id) : null;
    if (!ing) continue;
    const base = toBase(ing, l.qty * factor, l.unit);
    if (!Number.isFinite(base)) continue;
    if (ing.base === "ml") ml += base;
    else if (ing.base === "g") ml += ing.density && ing.density < 0.6 ? 0 : base * 0.85;
    else ml += base * (ing.unitWeight || 0) * 0.85;
  }
  return Math.round(ml);
}

/** null when it fits; { ml, level: "tight" | "over" } when scaled recipes risk overflowing the bowl. */
export function fillWarning(rec, ingById, factor = 1) {
  if (!FILL_CATEGORIES.has(rec.category)) return null;
  const ml = bowlFillMl(rec, ingById, factor);
  if (ml > BOWL_MAX_ML) return { ml, level: "over" };
  if (ml > BOWL_SAFE_ML) return { ml, level: "tight" };
  return null;
}
