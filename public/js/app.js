// Application singleton: raw data, derived catalog, and the selectors every view uses.

import { store, uid } from "./store.js";
import { buildCatalog, enabledStores } from "./lib/catalog.js";
import { basketReport } from "./lib/calc.js";

let raw = null;
let cat = null;
let catKey = "";
let memo = { key: "", report: null };

async function getJSON(name) {
  // A host page can ship the data inline (window.__FB_DATA__) instead of serving the files.
  const inline = globalThis.__FB_DATA__?.[name];
  if (inline) return inline;
  const res = await fetch(`data/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

export async function loadData() {
  // History and branches only add hints, so the app still starts without them (an older cached copy, a host page).
  const optional = (name, empty) => getJSON(name).catch(() => empty);
  const [ingredients, recipes, stores, prices, sources, history, branches] = await Promise.all([
    getJSON("ingredients.json"),
    getJSON("recipes.json"),
    getJSON("stores.json"),
    getJSON("prices.json"),
    getJSON("sources.json"),
    optional("price-history.json", { days: [], table: {} }),
    optional("branches.json", { meta: {}, branches: [] }),
  ]);
  raw = { ingredients, recipes, stores: stores.stores, prices, sources: sources.sources, storesNote: stores.note, sourcesNote: sources.note, history, branches: branches.branches || [], branchesMeta: branches.meta || {} };
  // First run: assume the usual staples are at home.
  const s = store.get();
  if (s.pantry === null) store.update((st) => void (st.pantry = ingredients.filter((i) => i.home).map((i) => i.id)));
  return raw;
}

export const rawData = () => raw;

/** Catalog rebuilt only when recipes, price overrides or order prices change. */
export function catalog() {
  const s = store.get();
  const key = JSON.stringify([s.customRecipes, s.priceOverrides, s.orderPrices, s.customSources]);
  if (!cat || key !== catKey) {
    cat = buildCatalog(raw, { customRecipes: s.customRecipes, priceOverrides: s.priceOverrides, orderPrices: s.orderPrices, customSources: s.customSources });
    catKey = key;
    memo = { key: "", report: null };
  }
  return cat;
}

/**
 * false until somebody has given a price: in the dataset, typed in by the person, or an order price.
 * Nothing is bundled, so a fresh install shows no money at all. Screens use this to hide cost blocks
 * (and say how to add prices) instead of showing empty or partial numbers.
 */
export function anyPrices() {
  const c = catalog();
  const s = store.get();
  return Object.keys(c.prices.table || {}).length > 0 || Object.keys(s.priceOverrides).length > 0 || Object.keys(s.orderPrices).length > 0 || c.recipes.some((r) => Number.isFinite(r.order));
}

export const settings = () => store.get().settings;
export const stores = () => enabledStores(catalog(), settings().stores);
export const pantrySet = () => new Set(store.get().pantry || []);

/** Sources (Sharon etc.) that offer the dish. */
export function sourcesFor(dishId) {
  const off = store.get().orderOff;
  return catalog().sources.filter((src) => !(off[src.id] || []).includes(dishId));
}

export function basketCalcItems() {
  return store.get().basket.map((b) => ({ dishId: b.dishId, servings: b.servings }));
}

/** Memoised report for the current basket + settings. */
export function report() {
  const c = catalog();
  const s = store.get();
  const key = JSON.stringify([s.basket.map((b) => [b.dishId, b.servings]), s.pantry, s.settings.stores, s.settings.delivery, s.settings.hourly, s.orderOff, catKey]);
  if (memo.key !== key) {
    memo = {
      key,
      report: basketReport(basketCalcItems(), c, {
        pantry: pantrySet(),
        delivery: s.settings.delivery,
        hourly: s.settings.hourly,
        stores: stores(),
        sources: c.sources,
        orderPrice: (dishId, sourceId) => ((s.orderOff[sourceId] || []).includes(dishId) ? null : c.orderPrice(dishId, sourceId)),
      }),
    };
  }
  return memo.report;
}

// ------------------------------------------------------------------ actions

export const actions = {
  addToBasket(dishId, servings, extra = {}) {
    const n = servings || settings().household;
    store.update((s) => {
      s.basket.push({ id: uid("b"), dishId, servings: n, ...extra });
    });
  },
  setServings(entryId, servings) {
    store.update((s) => {
      const e = s.basket.find((b) => b.id === entryId);
      if (e) e.servings = Math.min(99, Math.max(1, Math.round(servings)));
    });
  },
  removeFromBasket(entryId) {
    store.update((s) => void (s.basket = s.basket.filter((b) => b.id !== entryId)));
  },
  clearBasket() {
    store.update((s) => void (s.basket = []));
  },
  toggleFavorite(dishId) {
    store.update((s) => {
      s.favorites = s.favorites.includes(dishId) ? s.favorites.filter((x) => x !== dishId) : [...s.favorites, dishId];
    });
  },
  togglePantry(ingId, has) {
    store.update((s) => {
      const set = new Set(s.pantry || []);
      if (has ?? !set.has(ingId)) set.add(ingId);
      else set.delete(ingId);
      s.pantry = [...set];
    });
  },
  setPriceOverride(ingId, storeId, price) {
    store.update((s) => {
      s.priceOverrides[ingId] ??= {};
      if (Number.isFinite(price) && price > 0) s.priceOverrides[ingId][storeId] = Math.round(price * 100) / 100;
      else delete s.priceOverrides[ingId][storeId];
      if (!Object.keys(s.priceOverrides[ingId]).length) delete s.priceOverrides[ingId];
    });
  },
  setOrderPrice(dishId, sourceId, price) {
    store.update((s) => {
      s.orderPrices[dishId] ??= {};
      if (Number.isFinite(price) && price > 0) s.orderPrices[dishId][sourceId] = Math.round(price * 100) / 100;
      else delete s.orderPrices[dishId][sourceId];
      if (!Object.keys(s.orderPrices[dishId]).length) delete s.orderPrices[dishId];
    });
  },
  setOrderOff(sourceId, dishId, off) {
    store.update((s) => {
      const set = new Set(s.orderOff[sourceId] || []);
      if (off) set.add(dishId);
      else set.delete(dishId);
      s.orderOff[sourceId] = [...set];
    });
  },
  logCooked(dishId, servings, saved) {
    store.update((s) => void s.cooked.push({ dishId, servings, saved: Math.round(saved * 100) / 100, at: new Date().toISOString() }));
  },
  saveCustomRecipe(recipe) {
    store.update((s) => {
      const i = s.customRecipes.findIndex((r) => r.id === recipe.id);
      if (i >= 0) s.customRecipes[i] = recipe;
      else s.customRecipes.push(recipe);
    });
  },
  saveSource(src) {
    store.update((s) => {
      const i = s.customSources.findIndex((x) => x.id === src.id);
      if (i >= 0) s.customSources[i] = src;
      else s.customSources.push(src);
    });
  },
  deleteSource(id) {
    store.update((s) => {
      s.customSources = s.customSources.filter((x) => x.id !== id);
      for (const d of Object.values(s.orderPrices)) delete d[id];
      delete s.orderOff[id];
    });
  },
  deleteCustomRecipe(id) {
    store.update((s) => {
      s.customRecipes = s.customRecipes.filter((r) => r.id !== id);
      s.basket = s.basket.filter((b) => b.dishId !== id);
      s.favorites = s.favorites.filter((x) => x !== id);
    });
  },
};
