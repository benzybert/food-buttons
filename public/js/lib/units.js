// Unit conversion between what recipes say (כפות, כוסות, יחידות...) and the
// base unit each ingredient is priced in (g, ml, or u).

export const ML_PER = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240 };
const VOLUME = new Set(Object.keys(ML_PER));
const WEIGHT_G = { g: 1, kg: 1000 };
const PINCH_G = 0.5;

/** Recipe unit keys and their Hebrew labels: [singular, plural]. */
export const UNIT_LABELS = {
  g: ["גרם", "גרם"],
  kg: ["ק״ג", "ק״ג"],
  ml: ["מ״ל", "מ״ל"],
  l: ["ליטר", "ליטר"],
  tsp: ["כפית", "כפיות"],
  tbsp: ["כף", "כפות"],
  cup: ["כוס", "כוסות"],
  u: ["יח׳", "יח׳"],
  pinch: ["קורט", "קורט"],
};

export const BASE_LABELS = { g: "גרם", ml: "מ״ל", u: "יח׳" };

/**
 * Convert a recipe quantity to the ingredient's base unit.
 * Returns NaN when it cannot be done (e.g. units of an ingredient with no unit weight).
 */
export function toBase(ing, qty, unit) {
  const density = ing.density || 1;
  const uw = ing.unitWeight || 0;
  if (!Number.isFinite(qty)) return NaN;

  if (unit === "pinch") {
    if (ing.base === "g") return PINCH_G * qty;
    if (ing.base === "ml") return (PINCH_G / density) * qty;
    return 0;
  }

  if (ing.base === "g") {
    if (unit in WEIGHT_G) return qty * WEIGHT_G[unit];
    if (VOLUME.has(unit)) return qty * ML_PER[unit] * density;
    if (unit === "u") return uw ? qty * uw : NaN;
  } else if (ing.base === "ml") {
    if (VOLUME.has(unit)) return qty * ML_PER[unit];
    if (unit in WEIGHT_G) return (qty * WEIGHT_G[unit]) / density;
    if (unit === "u") return uw ? (qty * uw) / density : NaN;
  } else if (ing.base === "u") {
    if (unit === "u") return qty;
    if (!uw) return NaN;
    if (unit in WEIGHT_G) return (qty * WEIGHT_G[unit]) / uw;
    if (VOLUME.has(unit)) return (qty * ML_PER[unit] * density) / uw;
  }
  return NaN;
}

const FRACTIONS = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [0.333, "⅓"],
  [0.5, "½"],
  [0.667, "⅔"],
  [0.75, "¾"],
];

/** 1.5 -> "1½", 0.25 -> "¼", 2 -> "2", 2.33 -> "2⅓". Falls back to up to 1 decimal. */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.04) return String(whole);
  for (const [v, glyph] of FRACTIONS) {
    if (Math.abs(frac - v) < 0.04) return (whole ? String(whole) : "") + glyph;
  }
  if (frac > 0.96) return String(whole + 1);
  return String(Math.round(n * 10) / 10).replace(/\.0$/, "");
}

/** "2 כפות", "½ כוס", "350 גרם". Weights/volumes in g/ml are rounded to friendly numbers. */
export function formatQty(qty, unit) {
  if (unit === "pinch") return "קורט";
  let q = qty;
  let u = unit;
  if (u === "g" && q >= 1000) {
    q /= 1000;
    u = "kg";
  } else if (u === "ml" && q >= 1000) {
    q /= 1000;
    u = "l";
  }
  const grams = u === "g" || u === "ml";
  const shown = grams ? formatGrams(q) : formatNumber(q);
  const [one, many] = UNIT_LABELS[u] || ["", ""];
  if (u === "u") return shown;
  const label = q > 1.05 ? many : one;
  return `${shown} ${label}`.trim();
}

function formatGrams(g) {
  if (g < 10) return String(Math.round(g * 10) / 10).replace(/\.0$/, "");
  if (g < 100) return String(Math.round(g));
  return String(Math.round(g / 5) * 5);
}

/** Scale a quantity. Keeps tsp/tbsp/cup tidy: 3 tsp -> 1 tbsp. */
export function scaleQty(qty, unit, factor) {
  let q = qty * factor;
  let u = unit;
  if (u === "tsp" && q >= 3) {
    q /= 3;
    u = "tbsp";
  }
  if (u === "tbsp" && q >= 16) {
    q /= 16;
    u = "cup";
  }
  return { qty: q, unit: u };
}
