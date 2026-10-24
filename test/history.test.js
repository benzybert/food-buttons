import test from "node:test";
import assert from "node:assert/strict";
import { appendHistory, priceTrend, cheaperThanUsual, HISTORY_DAYS } from "../public/js/lib/history.js";
import { distanceKm, nearestBranches, cityPoint, cities } from "../public/js/lib/geo.js";

const day = (n) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);

test("appendHistory: aligned arrays, a chain missing tonight gets null, re-running a day replaces it", () => {
  let h = appendHistory(null, day(0), { flour: { a: 5, b: 6 } }, ["a", "b"]);
  h = appendHistory(h, day(1), { flour: { a: 5.5 } }, ["a"]); // b not downloaded
  assert.deepEqual(h.days, [day(0), day(1)]);
  assert.deepEqual(h.table.flour, { a: [5, 5.5], b: [6, null] });
  h = appendHistory(h, day(1), { flour: { a: 4.9, b: 6.1 } }, ["a", "b"]);
  assert.deepEqual(h.table.flour, { a: [5, 4.9], b: [6, 6.1] });
  h = appendHistory(h, day(2), { salt: { a: 2 } }, ["a"]); // flour lost its price at a tonight: null, not carried over
  assert.deepEqual(h.table.flour.a, [5, 4.9, null]);
  assert.deepEqual(h.table.salt.a, [null, null, 2]);
});

test("appendHistory keeps a bounded window and drops rows that never had a price", () => {
  let h = null;
  for (let i = 0; i < HISTORY_DAYS + 5; i++) h = appendHistory(h, day(i), { flour: { a: 5 + (i % 3) } }, ["a"]);
  assert.equal(h.days.length, HISTORY_DAYS);
  assert.equal(h.days[0], day(5));
  assert.equal(h.table.flour.a.length, HISTORY_DAYS);
  h = appendHistory(h, day(500), { ghost: { a: null } }, ["a"]);
  assert.equal(h.table.ghost, undefined);
});

test("priceTrend: needs a week of history, compares with the median before the latest day", () => {
  let h = null;
  for (let i = 0; i < 10; i++) h = appendHistory(h, day(i), { flour: { a: 10 } }, ["a"]);
  h = appendHistory(h, day(10), { flour: { a: 8.5 } }, ["a"]);
  const t = priceTrend(h, "flour", "a", 8.5);
  assert.equal(t.usual, 10);
  assert.equal(t.label, "cheap");
  assert.ok(Math.abs(t.change + 0.15) < 1e-9);
  assert.equal(priceTrend(h, "flour", "a", 9.5).label, null, "5% is within the usual range");
  assert.equal(priceTrend(h, "flour", "a", 11.5).label, "pricey");
  assert.equal(priceTrend(h, "flour", "b", 8), null);
  let short = null;
  for (let i = 0; i < 5; i++) short = appendHistory(short, day(i), { flour: { a: 10 } }, ["a"]);
  short = appendHistory(short, day(5), { flour: { a: 5 } }, ["a"]);
  assert.equal(priceTrend(short, "flour", "a", 5), null, "five earlier days are not enough");
  assert.deepEqual(cheaperThanUsual(h, { flour: { a: 8.5 } }).map((x) => [x.ingId, x.storeId, x.usual]), [["flour", "a", 10]]);
});

test("geo: distances, nearest branches per chain, city centres", () => {
  const telAviv = { lat: 32.0853, lon: 34.7818 };
  const jerusalem = { lat: 31.7683, lon: 35.2137 };
  const km = distanceKm(telAviv, jerusalem);
  assert.ok(km > 50 && km < 60, `${km}`);
  const branches = [
    { store: "a", id: "1", city: "תל אביב", lat: 32.08, lon: 34.78 },
    { store: "a", id: "2", city: "ירושלים", lat: 31.77, lon: 35.21 },
    { store: "b", id: "7", city: "תל-אביב", lat: 32.09, lon: 34.79 },
    { store: "b", id: "8", city: "חיפה" }, // not located
    { store: "c", id: "9", city: "ירושלים", lat: 31.76, lon: 35.2 },
  ];
  const near = nearestBranches(branches, telAviv, { stores: ["a", "b", "c", "z"], perStore: 1 });
  assert.deepEqual(near.map((x) => [x.store, x.branches[0].id]), [["a", "1"], ["b", "7"], ["c", "9"]]);
  assert.deepEqual(nearestBranches(branches, telAviv, { maxKm: 10 }).map((x) => x.store), ["a", "b"]);
  assert.deepEqual(cities(branches), ["ירושלים", "תל אביב"]);
  const tlv = cityPoint(branches, "תל-אביב");
  assert.ok(Math.abs(tlv.lat - 32.085) < 1e-9);
  assert.equal(cityPoint(branches, "חיפה"), null);
});

test("geocode: street first, then city; cached hits and misses; a failed request is not recorded; max lookups per run", async () => {
  const { geocode, queriesFor } = await import("../tools/geocode-branches.js");
  assert.deepEqual(queriesFor({ address: "בן יהודה 79", city: "תל אביב" }).map((q) => q.q), ["בן יהודה 79, תל אביב", "תל אביב"]);
  assert.deepEqual(queriesFor({ address: "", city: "" }), []);
  const asked = [];
  const lookup = async (q) => {
    asked.push(q);
    if (q === "בן יהודה 79, תל אביב") return { lat: 32.08123456, lon: 34.77 };
    if (q === "תל אביב") return { lat: 32.08, lon: 34.78 };
    if (q === "רחוב לא קיים 1, חיפה") return null;
    if (q === "חיפה") return { lat: 32.79, lon: 34.99 };
    throw new Error("network");
  };
  const branches = [
    { store: "a", id: "1", address: "בן יהודה 79", city: "תל אביב" },
    { store: "a", id: "2", address: "רחוב לא קיים 1", city: "חיפה" },
    { store: "a", id: "3", address: "x", city: "אילת" },
    { store: "a", id: "4", address: "y", city: "" },
  ];
  const r = await geocode(branches, {}, lookup, { today: "2026-10-24" });
  assert.deepEqual(r.branches.map((b) => [b.id, b.lat ?? null, b.approx ?? null]), [["1", 32.0812, null], ["2", 32.79, "city"], ["3", null, null], ["4", null, null]]);
  assert.equal(r.cache["רחוב לא קיים 1, חיפה"].miss, true);
  assert.equal(r.cache["x, אילת"], undefined, "a network error is not a miss");
  asked.length = 0;
  const again = await geocode(r.branches, r.cache, lookup, { today: "2026-10-25" });
  assert.deepEqual(asked, ["x, אילת", "אילת"], "only what is not cached is asked again");
  assert.equal(again.branches[0].lat, 32.0812);
  const limited = await geocode(branches, {}, lookup, { max: 1, today: "2026-10-24" });
  assert.equal(limited.looked, 1);
  assert.equal(limited.branches[1].lat, undefined);
  // with a settlement code the city centre needs no request: only the street is asked, and a miss falls back to it
  const settlements = { 2600: ["אילת", 29.5577, 34.9519] };
  asked.length = 0;
  const coded = await geocode([{ store: "a", id: "5", address: "x", city: "אילת", cityCode: "2600" }], {}, lookup, { today: "2026-10-24", settlements });
  assert.deepEqual(asked, ["x, אילת"]);
  assert.deepEqual([coded.branches[0].lat, coded.branches[0].approx], [29.5577, "city"]);
  assert.deepEqual(queriesFor({ address: "", city: "אילת", cityCode: "2600" }, settlements), []);
});
