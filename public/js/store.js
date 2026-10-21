// App state: one plain object, persisted to localStorage (when available).
// Mutate it only through update(); subscribers re-render afterwards.

const KEY = "fb:v1";
const VERSION = 1;

export function defaults() {
  return {
    v: VERSION,
    settings: {
      household: 4, // default servings
      stores: [], // enabled store ids; [] = all
      delivery: false, // price baskets with delivery fees
      hourly: 0, // value of own time, shekel per hour
      budget: 0, // weekly food budget, 0 = none
      kosher: "all", // all | parve | dairy | meat  (filters recipe browsing)
      diet: [], // vegan | vegetarian | gluten-free
      avoid: [], // allergens to avoid
      sharonPhone: "",
      theme: "auto", // auto | light | dark
      textSize: 100, // percent
      primaryStore: "", // store used for the shopping list; "" = cheapest
    },
    basket: [], // { id, dishId, servings, day?, slot? }
    pantry: null, // array of ingredient ids at home; null until initialised from the catalog
    favorites: [],
    cooked: [], // { dishId, at, servings, saved }
    customRecipes: [],
    priceOverrides: {}, // ingId -> storeId -> pack price
    orderPrices: {}, // dishId -> sourceId -> per-serving price
    orderOff: {}, // sourceId -> [dishId] not offered
    orderCart: {}, // dishId -> servings being ordered from the order page
    checked: {}, // shopping list ticks: ingId -> true
    seen: {}, // one-time hints
  };
}

let state = defaults();
let persistOk = true;
const subs = new Set();
let timer = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state = merge(defaults(), saved);
  } catch {
    persistOk = false;
  }
}

/** Shallow-per-section merge so new settings keys get defaults but old data survives. */
function merge(base, saved) {
  const out = { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in saved)) continue;
    if (k === "settings") out.settings = { ...base.settings, ...saved.settings };
    else if (typeof base[k] === typeof saved[k] && Array.isArray(base[k]) === Array.isArray(saved[k])) out[k] = saved[k];
    else if (k === "pantry" && Array.isArray(saved.pantry)) out.pantry = saved.pantry;
  }
  out.v = VERSION;
  return out;
}

function persistSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      persistOk = false;
    }
  }, 150);
}

export const store = {
  init() {
    load();
    return state;
  },
  get: () => state,
  get persistent() {
    return persistOk;
  },
  /** update(s => { s.basket.push(...) }) */
  update(fn) {
    fn(state);
    persistSoon();
    for (const f of subs) f(state);
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  reset() {
    state = defaults();
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    for (const f of subs) f(state);
  },
  exportJSON() {
    return JSON.stringify({ app: "food-buttons", exportedAt: new Date().toISOString(), data: state }, null, 1);
  },
  /** Returns { ok, error? }. Replaces the current data. */
  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "הקובץ אינו JSON תקין" };
    }
    const data = parsed?.app === "food-buttons" ? parsed.data : null;
    if (!data || typeof data !== "object" || !data.settings) return { ok: false, error: "הקובץ אינו גיבוי של האפליקציה" };
    state = merge(defaults(), data);
    persistSoon();
    for (const f of subs) f(state);
    return { ok: true };
  },
};

let idCounter = 0;
export function uid(prefix = "i") {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
