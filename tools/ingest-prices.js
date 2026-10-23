// Build public/data/prices.json from the price files that Israeli supermarket chains publish
// (the "price transparency" XML files, usually gzipped: PriceFull<chain>-<store>-<date>.gz).
//
// Usage:
//   node tools/ingest-prices.js --store shufersal=./downloads/shufersal --store ramilevy=./downloads/rami \
//        [--report] [--out public/data/prices.json] [--min-matches 3]
//
//   --store id=path   chain id from public/data/stores.json = a file or a folder of .xml/.gz files (all branches are merged)
//   --report          print what was matched per ingredient and write nothing. Run this first and read it.
//   --out             output file (default public/data/prices.json)
//
// How it works: every product whose name contains all words of one of an ingredient's names/aliases
// (and none of the exclusion words) is a candidate. Its price is normalised to a price per gram / ml / unit,
// outliers are dropped, and the MEDIAN across candidates and branches is used, so one premium brand does not
// distort the price. Pack price = median x pack size. Ingredients with too few matches are left out (the app
// then shows no price for them) - this tool never invents a number, and nothing in the catalog is a price to
// compare against: outliers are judged against the median of the matches themselves.
//
// IMPORTANT: written against the published file format and test fixtures, not against live files. Product
// names in these files are messy; always read the --report before trusting the output.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { norm, stemTokens } from "../public/js/lib/text.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ reading files

export function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1255").decode(buf); // some chains publish Hebrew in cp1255
}

export function readPriceFile(file) {
  let buf = fs.readFileSync(file);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return decodeBuffer(buf);
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
const unescapeXml = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

const FIELDS = {
  code: ["ItemCode", "ItemId", "Code"],
  name: ["ItemName", "ItemNm", "Name"],
  desc: ["ManufacturerItemDescription", "ItemDescription"],
  price: ["ItemPrice", "Price"],
  unitPrice: ["UnitOfMeasurePrice", "UnitPrice"],
  unitQty: ["UnitQty", "UnitOfMeasure"],
  quantity: ["Quantity", "Qty"],
  weighted: ["bIsWeighted", "IsWeighted"],
  inPackage: ["QtyInPackage"],
  status: ["ItemStatus", "Status"],
};

function field(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`));
    if (m) return unescapeXml(m[1]).trim();
  }
  return "";
}

/** Parse the products out of one price file's text. */
export function parseProducts(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(Item|Product)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const b = m[2];
    const price = Number(field(b, FIELDS.price));
    const name = field(b, FIELDS.name);
    if (!name || !(price > 0)) continue;
    const status = field(b, FIELDS.status);
    if (status === "0") continue; // delisted
    out.push({
      code: field(b, FIELDS.code),
      name,
      desc: field(b, FIELDS.desc),
      price,
      unitPrice: Number(field(b, FIELDS.unitPrice)) || null,
      unitQty: field(b, FIELDS.unitQty),
      quantity: Number(field(b, FIELDS.quantity)) || null,
      weighted: field(b, FIELDS.weighted) === "1" || /^true$/i.test(field(b, FIELDS.weighted)),
      inPackage: Number(field(b, FIELDS.inPackage)) || null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ quantities

const UNIT_TO_BASE = [
  [/^(?:ק"?ג|קג|קילו|קילוגרם|kg)$/i, "g", 1000],
  [/^(?:גרם|גר|ג|g|gr)$/i, "g", 1],
  [/^(?:ליטר|ל|l|lt)$/i, "ml", 1000],
  [/^(?:מ"?ל|מל|מיליליטר|ml)$/i, "ml", 1],
  [/^(?:יח'?|יחידה|יחידות|יח׳)$/i, "u", 1],
];

function unitInfo(word) {
  const w = norm(word).replace(/\s/g, "");
  const w2 = String(word).replace(/[״"']/g, "").replace(/\s/g, "");
  for (const [re, base, mult] of UNIT_TO_BASE) if (re.test(w) || re.test(w2)) return { base, mult };
  return null;
}

/** "קמח לבן 1 ק"ג" -> { base: "g", amount: 1000 }. Looks for the LAST "<number> <unit>" in the text. */
export function sizeFromName(text) {
  let found = null;
  for (const m of String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*(ק"ג|קג|קילו|קילוגרם|גרם|גר'?|ג'|ליטר|מ"ל|מל|מיליליטר|יח'|יחידות|יחידה|kg|g|ml|l)(?![\p{L}])/giu)) {
    const info = unitInfo(m[2]);
    if (info) found = { base: info.base, amount: Number(m[1].replace(",", ".")) * info.mult };
  }
  return found;
}

/**
 * Price per base unit (g, ml or one unit) of a product, or null when it cannot be told.
 * Weighted products are priced per kg by the chains.
 */
export function normalisePrice(p, wantBase) {
  if (p.weighted) return wantBase === "g" ? { perBase: p.price / 1000, via: "weighted" } : null;
  let size = null;
  if (p.quantity && p.unitQty) {
    const info = unitInfo(p.unitQty);
    if (info) size = { base: info.base, amount: p.quantity * info.mult };
  }
  const fromName = sizeFromName(`${p.name} ${p.desc}`);
  // The name is usually more reliable than Quantity=1 / UnitQty="יחידה".
  if (fromName && (!size || size.base !== fromName.base || size.amount <= 1)) size = fromName;
  if (!size || !(size.amount > 0)) return null;
  if (size.base !== wantBase) {
    // eggs are sold "12 יחידות": a unit count is already what we want
    return null;
  }
  return { perBase: p.price / size.amount, via: "size" };
}

// ------------------------------------------------------------------ matching

// Words that mean "this is not the plain ingredient" for the common cases; extend via price-rules.json.
const DEFAULT_EXCLUDE = ["תופח", "מוכן", "מוכנה", "טעם", "בטעם", "חטיף", "עוגיות", "עוגת", "ביסקוויט", "שוקולד חלב", "משקה", "מיץ", "קפוא מוכן", "תערובת", "ללא גלוטן", "תינוקות", "לתינוק", "חתול", "כלב", "בושם", "סבון", "ריחני", "אורגני"];

export function loadRules(file = path.join(ROOT, "tools", "price-rules.json")) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Build a scorer for an ingredient: how well does a (pre-tokenised) product name match?
 * 0 = no match; otherwise the length of the longest matching phrase, so "בצל סגול" scores higher for
 * "red onion" than for "onion" and each product can be given to its best ingredient only.
 */
export function scorerFor(ing, rules = {}) {
  const r = rules[ing.id] || {};
  const phrases = [ing.name, ...(ing.aliases || []), ...(r.include || [])].map((p) => stemTokens(p)).filter((t) => t.length);
  const exclude = [...DEFAULT_EXCLUDE, ...(r.exclude || [])].map((e) => norm(e)).filter(Boolean);
  return ({ hay, tokens }) => {
    if (exclude.some((e) => hay.includes(e))) return 0;
    let best = 0;
    for (const ph of phrases) {
      if (ph.every((w) => tokens.some((t) => t === w || t.startsWith(w) || (w.length > 3 && t.includes(w))))) best = Math.max(best, ph.join("").length);
    }
    return best;
  };
}

export const prepare = (name) => ({ hay: norm(name), tokens: stemTokens(name) });

/** Boolean convenience: does the product name belong to this ingredient (ignoring other ingredients)? */
export function matcherFor(ing, rules = {}) {
  const score = scorerFor(ing, rules);
  return (productName) => score(prepare(productName)) > 0;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Matches further than this factor from the median of their own group (either way) are dropped as outliers. */
const OUTLIER_FACTOR = 4;

/**
 * products: Map<storeId, Product[]> -> { table, report }
 * minMatches: ingredients with fewer matched products in a chain are left out for that chain.
 */
export function buildPriceTable(ingredients, productsByStore, { rules = {}, minMatches = 3 } = {}) {
  const priced = ingredients.filter((i) => !i.free);
  const scorers = priced.map((ing) => ({ ing, score: scorerFor(ing, rules) }));

  // Give every product to its single best ingredient (longest matching phrase).
  const perStore = new Map(); // storeId -> Map<ingId, Product[]>
  for (const [storeId, products] of productsByStore) {
    const byIng = new Map();
    for (const p of products) {
      const prepared = prepare(p.name);
      let best = null;
      let bestScore = 0;
      for (const { ing, score } of scorers) {
        const sc = score(prepared);
        if (sc > bestScore) {
          best = ing;
          bestScore = sc;
        }
      }
      if (best) (byIng.get(best.id) || byIng.set(best.id, []).get(best.id)).push(p);
    }
    perStore.set(storeId, byIng);
  }

  const table = {};
  const report = [];
  for (const ing of priced) {
    const entry = { id: ing.id, name: ing.name, stores: {} };
    for (const storeId of productsByStore.keys()) {
      const found = [];
      for (const p of perStore.get(storeId).get(ing.id) || []) {
        const n = normalisePrice(p, ing.base);
        if (n) found.push({ perBase: n.perBase, label: `${p.name} (${p.price})` }); // unreadable sizes are skipped
      }
      const mid = found.length ? median(found.map((x) => x.perBase)) : 0;
      const kept = found.filter((x) => x.perBase >= mid / OUTLIER_FACTOR && x.perBase <= mid * OUTLIER_FACTOR);
      const vals = kept.map((x) => x.perBase);
      const samples = kept.slice(0, 3).map((x) => x.label);
      if (vals.length < minMatches) {
        entry.stores[storeId] = { matches: vals.length, price: null, samples };
        continue;
      }
      const price = Math.round(median(vals) * ing.pack.size * 10) / 10;
      entry.stores[storeId] = { matches: vals.length, price, samples };
      (table[ing.id] ||= {})[storeId] = price;
    }
    report.push(entry);
  }
  return { table, report };
}

// ------------------------------------------------------------------ CLI

function collectFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs
    .readdirSync(p)
    .filter((f) => /\.(xml|gz)$/i.test(f) && !/^(Promo|Stores)/i.test(f))
    .map((f) => path.join(p, f));
}

export function loadStoreProducts(p) {
  const all = [];
  for (const f of collectFiles(p)) {
    try {
      all.push(...parseProducts(readPriceFile(f)));
    } catch (err) {
      console.error(`skipping ${f}: ${err.message}`);
    }
  }
  return all;
}

function main(argv) {
  const stores = [];
  let report = false;
  let out = path.join(ROOT, "public", "data", "prices.json");
  let minMatches = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--store") stores.push(argv[++i]);
    else if (argv[i] === "--report") report = true;
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--min-matches") minMatches = Number(argv[++i]);
    else {
      console.error(`unknown argument ${argv[i]}\n` + fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));
      process.exit(2);
    }
  }
  if (!stores.length) {
    console.error("give at least one --store id=path (see the header of this file)");
    process.exit(2);
  }
  const ingredients = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "data", "ingredients.json"), "utf8"));
  const known = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "public", "data", "stores.json"), "utf8")).stores.map((s) => s.id));
  const byStore = new Map();
  for (const spec of stores) {
    const [id, p] = spec.split("=");
    if (!known.has(id)) {
      console.error(`unknown store id "${id}" (known: ${[...known].join(", ")})`);
      process.exit(2);
    }
    const products = loadStoreProducts(p);
    console.log(`${id}: ${products.length} products from ${p}`);
    byStore.set(id, products);
  }
  const { table, report: rep } = buildPriceTable(ingredients, byStore, { rules: loadRules(), minMatches });
  if (report) {
    for (const e of rep) {
      console.log(`\n${e.name} (${e.id})`);
      for (const [sid, s] of Object.entries(e.stores)) console.log(`  ${sid.padEnd(12)} ${String(s.matches).padStart(3)} matches  ${s.price ?? "-"}   ${s.samples.join(" | ")}`);
    }
    const covered = Object.keys(table).length;
    console.log(`\n${covered}/${rep.length} ingredients have a price in at least one store (nothing written)`);
    return;
  }
  const result = {
    meta: {
      kind: "ingested",
      updated: new Date().toISOString().slice(0, 10),
      note: `מחירים טיפוסיים (חציון) שחולצו מקובצי המחירים שהרשתות מפרסמות: ${[...byStore.keys()].join(", ")}. מחיר לאריזה, או לק״ג לפריטים הנמכרים בשקילה.`,
    },
    table,
  };
  fs.writeFileSync(out, JSON.stringify(result) + "\n");
  console.log(`wrote ${out}: ${Object.keys(table).length} ingredients`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
