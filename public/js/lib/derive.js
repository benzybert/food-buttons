// Derived recipe facts: kosher type, diet tags, allergens, equipment, timers.
// Pure functions, shared by the build step and the in-browser importer.

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

/** Adds derived fields (kosher/diet/allergens/equipment/time) onto a copy of the recipe. */
export function deriveRecipe(recipe, ingById) {
  const base = deriveFromIngredients(recipe, ingById);
  const prep = Number(recipe.prep) || 0;
  const cook = Number(recipe.cook) || 0;
  return {
    ...recipe,
    ...base,
    equipment: deriveEquipment(recipe),
    time: { prep, cook, total: prep + cook },
  };
}
