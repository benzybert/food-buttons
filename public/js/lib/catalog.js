// Assembles the runtime catalog from the raw JSON files (plus the user's own recipes/overrides).
// Pure: the browser fetches the JSON, tests read it from disk, both call buildCatalog().

import { makePricer } from "./calc.js";
import { buildIndex } from "./parse.js";
import { deriveRecipe } from "./derive.js";

export function buildCatalog({ ingredients, recipes, stores, prices, sources }, user = {}) {
  const ingById = new Map(ingredients.map((i) => [i.id, i]));
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const custom = (user.customRecipes || []).map((r) => ({ ...deriveRecipe(r, ingById), src: "custom" }));
  const allRecipes = [...recipes, ...custom];
  const recById = new Map(allRecipes.map((r) => [r.id, r]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const priceFor = makePricer({ table: prices.table, overrides: user.priceOverrides, ingById, storeById });

  /** Per-serving order price for a dish at a source: user override, else base order price x markup. */
  function orderPrice(dishId, sourceId) {
    const o = user.orderPrices?.[dishId]?.[sourceId];
    if (Number.isFinite(o)) return o;
    const rec = recById.get(dishId);
    const src = sourceById.get(sourceId);
    if (!rec || !src || !Number.isFinite(rec.order)) return null;
    return Math.round(rec.order * (1 + (src.markup || 0)) * 100) / 100;
  }

  return {
    ingredients,
    ingById,
    recipes: allRecipes,
    recById,
    stores,
    storeById,
    sources,
    sourceById,
    prices,
    priceFor,
    orderPrice,
    index: buildIndex(ingredients),
  };
}

/** Subset of stores the user has enabled (all if none selected). */
export function enabledStores(catalog, enabledIds) {
  if (!enabledIds || !enabledIds.length) return catalog.stores;
  const set = new Set(enabledIds);
  const list = catalog.stores.filter((s) => set.has(s.id));
  return list.length ? list : catalog.stores;
}

export const CATEGORY_LABELS = {
  soup: "מרקים",
  main: "מנות עיקריות",
  side: "תוספות",
  salad: "סלטים",
  dip: "ממרחים",
  sauce: "רטבים",
  breakfast: "ארוחות בוקר",
  bread: "לחם ומאפים",
  dessert: "קינוחים",
  drink: "משקאות",
};

export const AISLE_LABELS = {
  produce: "ירקות ופירות",
  meat: "בשר, עוף ודגים",
  dairy: "חלב וביצים",
  dry: "יבשים",
  canned: "שימורים ורטבים",
  oils: "שמנים וחומץ",
  spices: "תבלינים",
  baking: "אפייה וממתיקים",
  nuts: "אגוזים ופירות יבשים",
  frozen: "קפואים",
  free: "מים",
};
export const AISLE_ORDER = ["produce", "meat", "dairy", "dry", "canned", "oils", "spices", "baking", "nuts", "frozen", "free"];
