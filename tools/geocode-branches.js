// Add coordinates to public/data/branches.json so the app can show the nearest branches.
// Addresses come from the chains' Stores files; positions come from OpenStreetMap's Nominatim, one lookup per
// address ever: results (and misses) are kept in data-src/geocache.json, which is committed. Nominatim's usage policy
// asks for at most one request per second, a real User-Agent and caching, which is what this does.
//
// Usage:
//   node tools/geocode-branches.js [--max 300] [--branches public/data/branches.json] [--cache data-src/geocache.json]
//
//   --max   at most this many new lookups per run (default 300, about 5 minutes); the rest wait for the next night
//
// A branch gets the position of its street address, or, failing that, of its city (marked approx: "city").
// A miss is retried after 60 days. Branches without a city are left without a position.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "food-buttons/1.0 (+https://github.com/benzybert/food-buttons)";
const RETRY_MISS_DAYS = 60;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** The queries to try for a branch, best first. */
export function queriesFor(b) {
  const city = clean(b.city);
  if (!city) return [];
  const address = clean(b.address);
  // Addresses like "קניון הזהב" or "מרכז מסחרי" are places, not streets; Nominatim handles both, so just try it.
  return address && address !== city ? [{ q: `${address}, ${city}`, approx: null }, { q: city, approx: "city" }] : [{ q: city, approx: "city" }];
}

const fresh = (entry, today) => entry && (!entry.miss || (Date.parse(today) - Date.parse(entry.at)) / 864e5 < RETRY_MISS_DAYS);

/**
 * Fill lat/lon on every branch it can. `lookup(q)` -> { lat, lon } | null does one network request.
 * Returns { branches, cache, looked } and never throws on a failed lookup (that branch just stays without a position).
 */
export async function geocode(branches, cache, lookup, { max = 300, today = new Date().toISOString().slice(0, 10), sleep = () => {} } = {}) {
  const c = { ...cache };
  let looked = 0;
  const out = [];
  for (const b of branches) {
    const { lat, lon, approx, ...rest } = b;
    let pos = null;
    for (const { q, approx: kind } of queriesFor(b)) {
      if (!fresh(c[q], today)) {
        if (looked >= max) break;
        looked++;
        let hit = null;
        try {
          hit = await lookup(q);
        } catch {
          hit = undefined; // network trouble: do not record a miss, try again next run
        }
        if (hit !== undefined) c[q] = hit ? { lat: Math.round(hit.lat * 1e4) / 1e4, lon: Math.round(hit.lon * 1e4) / 1e4, at: today } : { miss: true, at: today };
        await sleep();
      }
      const e = c[q];
      if (e && !e.miss) {
        pos = { lat: e.lat, lon: e.lon, ...(kind ? { approx: kind } : {}) };
        break;
      }
    }
    out.push(pos ? { ...rest, ...pos } : rest);
  }
  return { branches: out, cache: Object.fromEntries(Object.keys(c).sort().map((k) => [k, c[k]])), looked };
}

async function nominatim(q) {
  const url = `${ENDPOINT}?${new URLSearchParams({ q, format: "jsonv2", countrycodes: "il", limit: "1", "accept-language": "he" })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) throw new Error(`nominatim ${res.status}`);
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

async function main(argv) {
  let max = 300;
  let file = path.join(ROOT, "public", "data", "branches.json");
  let cacheFile = path.join(ROOT, "data-src", "geocache.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max") max = Number(argv[++i]);
    else if (argv[i] === "--branches") file = argv[++i];
    else if (argv[i] === "--cache") cacheFile = argv[++i];
    else {
      console.error(`unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  const { branches, cache: next, looked } = await geocode(data.branches || [], cache, nominatim, { max, sleep: () => new Promise((r) => setTimeout(r, 1100)) });
  fs.writeFileSync(file, JSON.stringify({ ...data, branches }) + "\n");
  // One address per line, so the nightly commit's diff shows what was added.
  fs.writeFileSync(cacheFile, `{\n${Object.entries(next).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`);
  const located = branches.filter((b) => Number.isFinite(b.lat)).length;
  console.log(`${looked} lookups; ${located}/${branches.length} branches located (${branches.filter((b) => b.approx === "city").length} by city only)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
