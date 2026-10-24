// Build public/data/prices.json from the price files that Israeli supermarket chains publish
// (the "price transparency" files: PriceFull<chain>-<store>-<date>.xml/.gz), or from the parsed CSVs of the
// OpenIsraeliSupermarkets daily dataset on Kaggle. Also writes the price history and the branch list.
//
// Usage:
//   node tools/ingest-prices.js --store shufersal=./downloads/shufersal --store ramilevy=./downloads/rami \
//        [--report] [--out public/data/prices.json] [--min-matches 3] [--max-branches 8] \
//        [--history public/data/price-history.json | --no-history] [--branches public/data/branches.json] [--keep-missing]
//
//   --store id=path   chain id from public/data/stores.json = a file or a folder of .xml/.gz/.csv files (all branches are merged).
//                     A missing or empty folder is skipped with a warning (a chain that failed to download tonight).
//   --report          print what was matched per ingredient and write nothing. Run this first and read it.
//   --out             output file (default public/data/prices.json)
//   --max-branches    use at most this many branches per chain (default 8): the price is a median, more branches add little
//   --history         price history file to append today's prices to (default public/data/price-history.json)
//   --branches        write the branch list (from Stores files) here (default public/data/branches.json; "-" = don't)
//   --keep-missing    chains not given in this run keep their prices from the previous prices.json (nightly job)
//
// How it works: every product whose name contains all words of one of an ingredient's names/aliases
// (and none of the exclusion words) is a candidate. A product's barcode then stands for that ingredient in every chain,
// so the same product is found where its name is spelled differently. Its price is normalised to a price per
// gram / ml / unit, outliers are dropped, and the MEDIAN across candidates and branches is used, so one premium brand
// does not distort the price. Pack price = median x pack size. Ingredients with too few matches are left out (the app
// then shows no price for them) - this tool never invents a number, and nothing in the catalog is a price to compare
// against: outliers are judged against the median of the matches themselves.
//
// Product names in these files are messy; always read the --report before trusting the output.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { norm, stemTokens } from "../public/js/lib/text.js";
import { appendHistory } from "../public/js/lib/history.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ reading files

export function decodeBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Some chains publish Hebrew in cp1255. A real UTF-8 file can still carry a stray invalid byte or two,
  // so a few replacement characters among many Hebrew letters do not make it cp1255.
  const bad = utf8.match(/�/g)?.length || 0;
  if (!bad || (utf8.match(/[א-ת]/g)?.length || 0) > bad * 50) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1255").decode(buf);
}

export function readPriceFile(file) {
  let buf = fs.readFileSync(file);
  // A download cut short still has most of its items: read what is there instead of failing the whole file.
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  return decodeBuffer(buf);
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
const unescapeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]);

// Tag names differ per chain and so does their case (ItemCode, ITEMCODE; bIsWeighted, blsWeighted with a lowercase L).
// The same names, lowercased, are the column names of the parsed CSVs.
const FIELDS = {
  code: ["ItemCode", "ItemId", "Code"],
  name: ["ItemName", "ItemNm", "Name"],
  desc: ["ManufacturerItemDescription", "ItemDescription"],
  price: ["ItemPrice", "Price"],
  unitPrice: ["UnitOfMeasurePrice", "UnitPrice"],
  unitQty: ["UnitQty"],
  quantity: ["Quantity", "Qty"],
  weighted: ["bIsWeighted", "blsWeighted", "IsWeighted"],
  inPackage: ["QtyInPackage"],
  store: ["StoreId", "StoreID"],
};
const STORE_FIELDS = {
  id: ["StoreId", "StoreID"],
  name: ["StoreName"],
  address: ["Address"],
  city: ["City"],
  zip: ["ZipCode", "Zip"],
  subchain: ["SubChainName"],
};

const fieldRes = new Map();
function fieldRe(names) {
  const key = names.join("|");
  if (!fieldRes.has(key)) fieldRes.set(key, new RegExp(`<(${key})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "i"));
  return fieldRes.get(key);
}

function field(block, names) {
  const m = block.match(fieldRe(names));
  return m ? unescapeXml(m[2]).trim() : "";
}

const isTrue = (v) => v === "1" || /^true$/i.test(v);

function toProduct(get, fileStore) {
  const price = Number(get(FIELDS.price));
  const name = get(FIELDS.name);
  if (!name || !(price > 0)) return null;
  const store = get(FIELDS.store) || fileStore || "";
  return {
    code: get(FIELDS.code),
    name,
    desc: get(FIELDS.desc),
    price,
    unitPrice: Number(get(FIELDS.unitPrice)) || null,
    unitQty: get(FIELDS.unitQty),
    quantity: Number(get(FIELDS.quantity)) || null,
    weighted: isTrue(get(FIELDS.weighted)),
    inPackage: Number(get(FIELDS.inPackage)) || null,
    store: /^\d+$/.test(store) ? String(Number(store)) : store,
  };
}

/**
 * Parse the products out of one price file's text. Items are <Item>, <Product> or <Line> blocks, in any case.
 * ItemStatus is not a "delisted" flag (real files carry 0 on every item), so every priced item counts.
 */
export function parseProducts(xml) {
  const head = xml.slice(0, 2000);
  const fileStore = field(head, FIELDS.store);
  const out = [];
  for (const m of xml.matchAll(/<(Item|Product|Line)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const p = toProduct((names) => field(m[2], names), fileStore);
    if (p) out.push(p);
  }
  return out;
}

/** Branches out of a Stores file: <Store>/<STORE>/<Branch> blocks. A numeric City is a ministry code, not a name. */
export function parseStores(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(Store|Branch)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const b = toBranch((names) => field(m[2], names));
    if (b) out.push(b);
  }
  return out;
}

function toBranch(get) {
  const id = get(STORE_FIELDS.id);
  if (!id) return null;
  const city = get(STORE_FIELDS.city);
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  return {
    id: String(Number(id) || id),
    name: clean(get(STORE_FIELDS.name)),
    address: clean(get(STORE_FIELDS.address)),
    city: /^\d*$/.test(city) || city === "unknown" ? "" : clean(city),
    zip: /^\d{5,7}$/.test(get(STORE_FIELDS.zip)) ? get(STORE_FIELDS.zip) : "",
  };
}

// ------------------------------------------------------------------ CSV (the parsed dataset)

/**
 * Stream a CSV file row by row (RFC 4180: quoted fields, "" escapes, newlines inside quotes) without holding it all.
 * The first row is the header; onRow gets (get(names) -> string) for each data row. Column names are matched lowercased.
 */
export function readCsv(file, onRow) {
  let text = null;
  if (/\.gz$/i.test(file)) text = decodeBuffer(zlib.gunzipSync(fs.readFileSync(file)));
  const fd = text == null ? fs.openSync(file, "r") : null;
  const decoder = new TextDecoder("utf-8");
  const buf = Buffer.alloc(1 << 20);
  let header = null;
  let row = [];
  let cell = "";
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field: either "" or the closing quote
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (!header) header = new Map(row.map((h, i) => [h.replace(/^﻿/, "").trim().toLowerCase(), i]));
    else if (row.length > 1 || row[0] !== "") {
      const r = row;
      onRow((names) => {
        for (const n of names) {
          const i = header.get(n.toLowerCase());
          if (i !== undefined && r[i] !== undefined && r[i] !== "") return r[i].trim();
        }
        return "";
      });
    }
    row = [];
  };
  const feed = (chunk) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (quotePending) {
        quotePending = false;
        if (ch === '"') {
          cell += '"';
          continue;
        }
        inQuotes = false;
      }
      if (inQuotes) {
        if (ch === '"') quotePending = true;
        else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") (row.push(cell), (cell = ""));
      else if (ch === "\n") endRow();
      else if (ch !== "\r") cell += ch;
    }
  };
  if (text != null) feed(text);
  else {
    try {
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) feed(decoder.decode(buf.subarray(0, n), { stream: true }));
      feed(decoder.decode());
    } finally {
      fs.closeSync(fd);
    }
  }
  if (cell !== "" || row.length) endRow();
}

// ------------------------------------------------------------------ quantities

const UNIT_TO_BASE = [
  [/^(?:ק"?ג|קג|קילו|קילוגרם|קילוגרמים|kg)$/i, "g", 1000],
  [/^(?:גרם|גרמים|גר|ג|g|gr)$/i, "g", 1],
  [/^(?:ליטר|ליטרים|ל|l|lt)$/i, "ml", 1000],
  [/^(?:מ"?ל|מל|מיליליטר|מיליליטרים|ml)$/i, "ml", 1],
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

// Words that mean "this is not the plain ingredient": processed foods that carry an ingredient's name ("מרק בצל",
// "סוכריות לימון") and things that are not food at all ("שמן רחצה", "חלב ודבש" shower gel). A word that is part of
// the ingredient's own phrase does not exclude it ("רוטב סויה" is soy sauce). Extend per ingredient via price-rules.json.
const DEFAULT_EXCLUDE = [
  // processed
  "תופח", "מוכן", "מוכנה", "טעם", "בטעם", "חטיף", "חטיפי", "עוגיות", "עוגת", "עוגה", "עוגות", "טראפל", "פרלינים", "ביסקוויט", "וופל", "ופלים", "וופלים", "קרקר", "פריכיות", "ציפס",
  "סוכריות", "סוכריה", "מסטיק", "שוקולד חלב", "משקה", "מיץ", "נקטר", "תה", "מרק", "ממרח", "רוטב", "פסטו", "מחית", "מעדן", "פודינג", "גלידה",
  "דגני", "גרנולה", "במבה", "ביסלי", "תבלין", "תיבול", "מילוי", "ציפוי", "קפוא מוכן", "תערובת", "ללא גלוטן", "אורגני", "שימורים", "חמוצים", "כבוש",
  // babies and pets
  "בצק", "ממתק", "שוקו", "פנטזיה", "יופלה", "גמדים", "דנונה", "מולר", "מילקי",
  // babies and pets
  "תינוקות", "לתינוק", "בייביז", "דייסה", "מטרנה", "סימילאק", "חתול", "חתולים", "כלב", "כלבים",
  // not food
  "בושם", "סבון", "ריחני", "שמפו", "מרכך", "רחצה", "אמבט", "עיסוי", "ארגן", "תחליב", "קרם", "דאודורנט", "ספריי", "מפיץ", "ריח", "שעווה", "ניקוי", "כביסה", "מדיח", "למדיח", "מגבונים", "שיער", "גוף", "פנים",
];

export function loadRules(file = path.join(ROOT, "tools", "price-rules.json")) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** A brand may come first ("לייף וולנס שמן זית", "קנור מרק עוף"): the ingredient's phrase may start up to two words in. */
const MAX_LEAD = 2;

/** What follows these words is a side component, not the product ("יוגורט עם אננס", "חמאה ללא מלח"). */
const SIDE = new Set(["עם", "ללא", "בלי", "בתוספת", "במילוי", "בטעם", "ברוטב", "בציפוי"]);

const LATIN_ONLY = /^[\x00-\x7f]*$/;

/**
 * Build a scorer for an ingredient: how well does a (pre-tokenised) product name match?
 * 0 = no match; otherwise the length of the longest matching phrase, so "בצל סגול" scores higher for
 * "red onion" than for "onion" and each product can be given to its best ingredient only.
 * A phrase matches when its words appear in order, next to each other, starting at most MAX_LEAD words in,
 * each equal to a word of the name (after the plural stemmer): "סוכר" does not match "סוכריות".
 */
export function scorerFor(ing, rules = {}) {
  const r = rules[ing.id] || {};
  // The price files are in Hebrew; the English aliases (for imported recipes) would only match imported cosmetics.
  const own = r.only || [ing.name, ...(ing.aliases || []).filter((a) => !LATIN_ONLY.test(a)), ...(r.include || [])];
  const phrases = own.map((p) => stemTokens(p)).filter((t) => t.length);
  const exclude = [...DEFAULT_EXCLUDE, ...(r.exclude || [])].map((e) => stemTokens(e)).filter((t) => t.length);
  const has = (tokens, seq, from = 0, to = tokens.length - seq.length) => {
    for (let i = from; i <= Math.min(to, tokens.length - seq.length); i++) if (seq.every((w, k) => tokens[i + k] === w)) return true;
    return false;
  };
  return ({ tokens }) => {
    let best = 0;
    let bestPhrase = null;
    const side = tokens.findIndex((t) => SIDE.has(t));
    const main = side === -1 ? tokens : tokens.slice(0, side);
    for (const ph of phrases) {
      const len = ph.join("").length;
      if (len > best && has(main, ph, 0, MAX_LEAD)) (best = len), (bestPhrase = ph);
    }
    if (!best) return 0;
    if (exclude.some((e) => has(tokens, e) && !has(bestPhrase, e))) return 0;
    return best;
  };
}

export const prepare = (name) => ({ hay: norm(name), tokens: stemTokens(name) });

/** Boolean convenience: does the product name belong to this ingredient (ignoring other ingredients)? */
export function matcherFor(ing, rules = {}) {
  const score = scorerFor(ing, rules);
  return (productName) => score(prepare(productName)) > 0;
}

/**
 * A manufacturer barcode (EAN-8/13, UPC-12, GTIN-14) names the same product in every chain.
 * Codes starting with 2 are in-store codes (weighed produce, deli) and short codes are chain-internal: those
 * mean different things in different chains, so they never carry a match across.
 */
export const isGlobalBarcode = (code) => /^\d{8}$|^\d{12,14}$/.test(String(code || "")) && !/^0*2/.test(String(code));

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
 *
 * Two passes: (1) every product goes to its single best ingredient by name; (2) the global barcodes of those
 * matches (plus any listed in price-rules.json "barcodes") pull in the same products in every chain, even where the
 * chain spells the name so that it does not match. A barcode claimed by two ingredients is ambiguous and ignored.
 */
export function buildPriceTable(ingredients, productsByStore, { rules = {}, minMatches = 3 } = {}) {
  const priced = ingredients.filter((i) => !i.free);
  const scorers = priced.map((ing) => ({ ing, score: scorerFor(ing, rules) }));

  const perStore = new Map(); // storeId -> Map<ingId, {p, via}[]>
  const unmatched = new Map(); // storeId -> Product[]
  const barcodeOwner = new Map(); // code -> ingId | null (ambiguous)
  const claim = (code, ingId) => {
    if (!isGlobalBarcode(code)) return;
    const cur = barcodeOwner.get(code);
    if (cur === undefined) barcodeOwner.set(code, ingId);
    else if (cur !== ingId) barcodeOwner.set(code, null);
  };
  for (const ing of priced) for (const code of rules[ing.id]?.barcodes || []) claim(String(code), ing.id);

  for (const [storeId, products] of productsByStore) {
    const byIng = new Map();
    const rest = [];
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
      if (best) {
        (byIng.get(best.id) || byIng.set(best.id, []).get(best.id)).push({ p, via: "name" });
        claim(p.code, best.id);
      } else rest.push(p);
    }
    perStore.set(storeId, byIng);
    unmatched.set(storeId, rest);
  }

  for (const [storeId, rest] of unmatched) {
    const byIng = perStore.get(storeId);
    for (const p of rest) {
      const owner = barcodeOwner.get(String(p.code));
      if (owner) (byIng.get(owner) || byIng.set(owner, []).get(owner)).push({ p, via: "barcode" });
    }
  }

  const table = {};
  const report = [];
  for (const ing of priced) {
    const entry = { id: ing.id, name: ing.name, stores: {} };
    for (const storeId of productsByStore.keys()) {
      const found = [];
      for (const { p, via } of perStore.get(storeId).get(ing.id) || []) {
        // Produce, meat and fish are priced per kg: a pack that merely names them ("טבעות בצל 500 גר") is another product.
        if (ing.pack.type === "loose" && !p.weighted && !rules[ing.id]?.packaged) continue;
        const n = normalisePrice(p, ing.base);
        if (n) found.push({ perBase: n.perBase, via, label: `${p.name} (${p.price})${via === "barcode" ? " [ברקוד]" : ""}` }); // unreadable sizes are skipped
      }
      const mid = found.length ? median(found.map((x) => x.perBase)) : 0;
      const kept = found.filter((x) => x.perBase >= mid / OUTLIER_FACTOR && x.perBase <= mid * OUTLIER_FACTOR);
      const vals = kept.map((x) => x.perBase);
      const byBarcode = kept.filter((x) => x.via === "barcode").length;
      const samples = kept.slice(0, 3).map((x) => x.label);
      if (vals.length < minMatches) {
        entry.stores[storeId] = { matches: vals.length, byBarcode, price: null, samples };
        continue;
      }
      const price = Math.round(median(vals) * ing.pack.size * 10) / 10;
      entry.stores[storeId] = { matches: vals.length, byBarcode, price, samples };
      (table[ing.id] ||= {})[storeId] = price;
    }
    report.push(entry);
  }
  return { table, report };
}

// ------------------------------------------------------------------ folders

const isStoresFile = (f) => /^stores?|store_file|^branches/i.test(f);
const isPromoFile = (f) => /promo/i.test(f);

function listFiles(p, want) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, want));
    else if (/\.(xml|gz|csv)$/i.test(e.name) || (!/\.\w{1,4}$/.test(e.name) && /^(price|stores)/i.test(e.name))) {
      // Some chains publish without an extension (PriceFull7290...-001-2026...).
      if (want(e.name)) out.push(full);
    }
  }
  return out;
}

/**
 * Every product in a folder (XML, gzipped XML, or the dataset's CSVs), promo and store files skipped.
 * One row per branch, item code and name (the latest file wins), at most `maxBranches` branches.
 */
export function loadStoreProducts(p, { maxBranches = Infinity } = {}) {
  const files = listFiles(p, (f) => !isPromoFile(f) && !isStoresFile(f) && (!/\.csv$/i.test(f) || /price/i.test(f)));
  const byKey = new Map();
  const branches = new Set();
  const add = (prod) => {
    if (!prod) return;
    if (!branches.has(prod.store)) {
      if (branches.size >= maxBranches) return;
      branches.add(prod.store);
    }
    byKey.set(`${prod.store}|${prod.code}|${prod.name}`, prod);
  };
  for (const f of files) {
    try {
      if (/\.csv(\.gz)?$/i.test(f)) readCsv(f, (get) => add(toProduct((names) => get(names.map((n) => n.toLowerCase())))));
      else for (const prod of parseProducts(readPriceFile(f))) add(prod);
    } catch (err) {
      console.error(`skipping ${f}: ${err.message}`);
    }
  }
  return [...byKey.values()];
}

/** Branches from the Stores files (XML) or the dataset's store CSVs in a folder, de-duplicated by branch id. */
export function loadBranches(p) {
  const byId = new Map();
  for (const f of listFiles(p, isStoresFile)) {
    try {
      if (/\.csv(\.gz)?$/i.test(f)) readCsv(f, (get) => {
        const b = toBranch((names) => get(names.map((n) => n.toLowerCase())));
        if (b) byId.set(b.id, b);
      });
      else for (const b of parseStores(readPriceFile(f))) byId.set(b.id, b);
    } catch (err) {
      console.error(`skipping ${f}: ${err.message}`);
    }
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
}

/** Where a folder's files came from, as the download script recorded it in SOURCE ("scraper", "kaggle"). */
function sourceOf(p) {
  try {
    return fs.readFileSync(path.join(p, "SOURCE"), "utf8").trim() || "files";
  } catch {
    return "files";
  }
}

// ------------------------------------------------------------------ output

/**
 * The new prices.json. With keepMissing, chains that were not part of this run keep their previous column and their
 * previous "updated" date, so a chain that failed to download tonight does not lose its prices; it just ages.
 */
export function mergePrices(previous, table, runStores, { today, keepMissing = false } = {}) {
  const out = {};
  const sources = {};
  if (keepMissing && previous?.meta?.kind === "real") {
    for (const [ingId, row] of Object.entries(previous.table || {})) {
      for (const [sid, v] of Object.entries(row)) if (!runStores.has(sid)) (out[ingId] ||= {})[sid] = v;
    }
    for (const [sid, s] of Object.entries(previous.meta.sources || {})) if (!runStores.has(sid)) sources[sid] = s;
  }
  for (const [ingId, row] of Object.entries(table)) for (const [sid, v] of Object.entries(row)) (out[ingId] ||= {})[sid] = v;
  for (const [sid, info] of runStores) sources[sid] = { updated: today, ...info };
  const names = Object.keys(sources).sort();
  return {
    meta: {
      kind: "real",
      updated: today,
      note: "מחירים טיפוסיים (חציון של כמה סניפים ומותגים) מתוך קובצי המחירים שהרשתות מחויבות לפרסם. מחיר לאריזה, או לק״ג לפריטים הנמכרים בשקילה. המחיר בסניף שלכם יכול להיות שונה.",
      sources: Object.fromEntries(names.map((n) => [n, sources[n]])),
    },
    table: Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]])),
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ CLI

function main(argv) {
  const stores = [];
  let report = false;
  let out = path.join(ROOT, "public", "data", "prices.json");
  let historyFile = path.join(ROOT, "public", "data", "price-history.json");
  let branchesFile = path.join(ROOT, "public", "data", "branches.json");
  let minMatches = 3;
  let maxBranches = 8;
  let keepMissing = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--store") stores.push(argv[++i]);
    else if (argv[i] === "--report") report = true;
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--min-matches") minMatches = Number(argv[++i]);
    else if (argv[i] === "--max-branches") maxBranches = Number(argv[++i]);
    else if (argv[i] === "--history") historyFile = argv[++i];
    else if (argv[i] === "--no-history") historyFile = null;
    else if (argv[i] === "--branches") branchesFile = argv[++i] === "-" ? null : argv[i];
    else if (argv[i] === "--keep-missing") keepMissing = true;
    else {
      console.error(`unknown argument ${argv[i]}\n` + fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).join("\n"));
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
  const runStores = new Map();
  const branchesByStore = new Map();
  for (const spec of stores) {
    const [id, p] = spec.split("=");
    if (!known.has(id)) {
      console.error(`unknown store id "${id}" (known: ${[...known].join(", ")})`);
      process.exit(2);
    }
    if (!p || !fs.existsSync(p)) {
      console.warn(`${id}: ${p} does not exist, skipped`);
      continue;
    }
    const products = loadStoreProducts(p, { maxBranches });
    const branches = loadBranches(p);
    if (branches.length) branchesByStore.set(id, branches);
    const nBranches = new Set(products.map((x) => x.store)).size;
    console.log(`${id}: ${products.length} products from ${nBranches} branches, ${branches.length} branches listed (${branches.filter((b) => b.city).length} with a city) (${sourceOf(p)})`);
    if (branches.length && !branches.some((b) => b.city)) console.log(`  first branch as read: ${JSON.stringify(branches[0])}`);
    if (!products.length) continue;
    byStore.set(id, products);
    runStores.set(id, { source: sourceOf(p), branches: nBranches, products: products.length });
  }
  if (!byStore.size) {
    console.error("no products in any store: nothing written");
    process.exit(report ? 0 : 1);
  }
  const { table, report: rep } = buildPriceTable(ingredients, byStore, { rules: loadRules(), minMatches });
  if (report) {
    for (const e of rep) {
      console.log(`\n${e.name} (${e.id})`);
      for (const [sid, s] of Object.entries(e.stores)) console.log(`  ${sid.padEnd(12)} ${String(s.matches).padStart(3)} matches${s.byBarcode ? ` (${s.byBarcode} by barcode)` : ""}  ${s.price ?? "-"}   ${s.samples.join(" | ")}`);
    }
    const covered = Object.keys(table).length;
    console.log(`\n${covered}/${rep.length} ingredients have a price in at least one store (nothing written)`);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = mergePrices(readJson(out, null), table, runStores, { today, keepMissing });
  fs.writeFileSync(out, JSON.stringify(result) + "\n");
  console.log(`wrote ${out}: ${Object.keys(result.table).length} ingredients, stores ${Object.keys(result.meta.sources).join(", ")}`);

  if (historyFile) {
    const history = appendHistory(readJson(historyFile, null), today, table, [...runStores.keys()]);
    fs.writeFileSync(historyFile, JSON.stringify(history) + "\n");
    console.log(`wrote ${historyFile}: ${history.days.length} days`);
  }
  if (branchesFile && branchesByStore.size) {
    const previous = keepMissing ? readJson(branchesFile, { branches: [] }).branches || [] : [];
    const kept = previous.filter((b) => !branchesByStore.has(b.store));
    const fresh = [...branchesByStore].flatMap(([store, list]) => list.map((b) => ({ store, ...b })));
    const all = [...kept, ...fresh].sort((a, b) => a.store.localeCompare(b.store) || Number(a.id) - Number(b.id));
    fs.writeFileSync(branchesFile, JSON.stringify({ meta: { updated: today, note: "סניפים מתוך קובצי הסניפים שהרשתות מפרסמות. המיקום לפי הכתובת או מרכז העיר, בקירוב." }, branches: all }) + "\n");
    console.log(`wrote ${branchesFile}: ${all.length} branches`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
