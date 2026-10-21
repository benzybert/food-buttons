import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../public/js/lib/catalog.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

export function loadRaw() {
  return {
    ingredients: read("ingredients.json"),
    recipes: read("recipes.json"),
    stores: read("stores.json").stores,
    prices: read("prices.json"),
    sources: read("sources.json").sources,
  };
}

export function loadCatalog(user = {}) {
  return buildCatalog(loadRaw(), user);
}

/** Minimal ingredient fixture for unit tests that should not depend on the real catalog. */
export function fixture() {
  const ingredients = [
    { id: "flour", name: "קמח לבן", aliases: ["קמח"], aisle: "dry", base: "g", pack: { type: "pack", size: 1000 }, ref: 5, density: 0.55, flags: ["g"] },
    { id: "onion", name: "בצל", aliases: ["בצלים"], aisle: "produce", base: "g", pack: { type: "loose", size: 1000, step: 100 }, ref: 6, unitWeight: 150, flags: [] },
    { id: "eggs", name: "ביצים", aliases: ["ביצה"], aisle: "dairy", base: "u", pack: { type: "pack", size: 12 }, ref: 18, unitWeight: 55, flags: ["e"] },
    { id: "oil", name: "שמן", aliases: [], aisle: "oils", base: "ml", pack: { type: "pack", size: 1000 }, ref: 12, density: 0.92, flags: [], home: true },
    { id: "water", name: "מים", aliases: [], aisle: "free", base: "ml", pack: { type: "pack", size: 1000 }, ref: 0, flags: [], free: true },
  ];
  const stores = [
    { id: "a", name: "חנות א", index: 1, delivery: { fee: 30, freeOver: 100, min: 50 } },
    { id: "b", name: "חנות ב", index: 0.9, delivery: { fee: 20, freeOver: 80, min: 30 } },
  ];
  const recipes = [
    {
      id: "cake", name: "עוגה", servings: 4, prep: 20, cook: 30, order: 20,
      ingredients: [
        { id: "flour", qty: 300, unit: "g" },
        { id: "eggs", qty: 3, unit: "u" },
        { id: "onion", qty: 1, unit: "u" },
        { id: "oil", qty: 0.5, unit: "cup" },
        { id: "water", qty: 100, unit: "ml" },
      ],
      steps: [{ text: "ערבבו." }],
    },
  ];
  const prices = {
    meta: { kind: "test" },
    table: {
      flour: { a: 6, b: 5 },
      onion: { a: 8, b: 6 },
      eggs: { a: 16, b: null },
      oil: { a: 12, b: 11 },
    },
  };
  const sources = [
    { id: "s1", name: "מקור 1", markup: 0, fee: 0 },
    { id: "s2", name: "מקור 2", markup: 0.5, fee: 20 },
  ];
  return { ingredients, recipes, stores, prices, sources };
}
