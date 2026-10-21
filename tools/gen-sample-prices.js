// Generates SAMPLE store prices (public/data/prices.json) from reference prices and store indexes.
// Deterministic (seeded) so the file only changes when the inputs do. These are NOT real prices:
// replace them with real data via tools/ingest-prices.js or by editing prices in the app.
//   node tools/gen-sample-prices.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data");

const ingredients = JSON.parse(fs.readFileSync(path.join(OUT, "ingredients.json"), "utf8"));
const { stores } = JSON.parse(fs.readFileSync(path.join(OUT, "stores.json"), "utf8"));

// FNV-1a -> mulberry32
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALWAYS = new Set(["shufersal", "ramilevy", "victory"]); // these three carry everything
const table = {};
for (const ing of ingredients) {
  if (ing.free) continue;
  const row = {};
  const volatile = ing.aisle === "produce" || ing.aisle === "meat";
  const spread = volatile ? 0.14 : 0.07;
  for (const s of stores) {
    const r = rng(`${ing.id}:${s.id}`);
    if (!ALWAYS.has(s.id) && r() < 0.05) {
      row[s.id] = null; // store does not carry it
      continue;
    }
    const noise = (r() * 2 - 1) * spread;
    let p = ing.ref * s.index * (1 + noise);
    p = p < 20 ? Math.round(p * 10) / 10 : Math.round(p * 2) / 2;
    row[s.id] = Math.max(0.5, p);
  }
  table[ing.id] = row;
}

const out = {
  meta: {
    kind: "sample",
    updated: "2026-10-21",
    note: "מחירי דוגמה שנוצרו אוטומטית, אינם מחירים אמיתיים. מחיר לאריזה, או לק״ג לפריטים הנמכרים בשקילה.",
  },
  table,
};
fs.writeFileSync(path.join(OUT, "prices.json"), JSON.stringify(out) + "\n");
console.log(`wrote sample prices: ${Object.keys(table).length} ingredients x ${stores.length} stores`);
