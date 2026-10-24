// Price history: one price per ingredient, store and day, from the nightly price import (tools/ingest-prices.js).
// Shared by the import (appendHistory) and the app ("cheaper than usual" hints). Pure, no DOM.
//
// File shape: { days: ["2026-10-01", ...], table: { ingId: { storeId: [price | null, ...] } } }
// Every array is aligned with `days`. null = no price that day (the chain was not downloaded, or too few matches).
// Nothing is ever filled in: a missing day stays null.

export const HISTORY_DAYS = 120;

/** Append (or replace) one day. `table` = { ingId: { storeId: price } }, `fresh` = the stores priced in this run. */
export function appendHistory(history, day, table, fresh, keep = HISTORY_DAYS) {
  const h = history && Array.isArray(history.days) ? { days: [...history.days], table: structuredClone(history.table || {}) } : { days: [], table: {} };
  let idx = h.days.indexOf(day);
  if (idx === -1) {
    h.days.push(day);
    h.days.sort();
    idx = h.days.indexOf(day);
    for (const row of Object.values(h.table)) for (const sid of Object.keys(row)) row[sid].splice(idx, 0, null);
  }
  for (const sid of fresh) {
    for (const ingId of new Set([...Object.keys(h.table), ...Object.keys(table)])) {
      const v = table[ingId]?.[sid];
      const row = (h.table[ingId] ||= {});
      if (!row[sid]) row[sid] = h.days.map(() => null);
      row[sid][idx] = Number.isFinite(v) && v > 0 ? v : null;
    }
  }
  const drop = Math.max(0, h.days.length - keep);
  if (drop) {
    h.days = h.days.slice(drop);
    for (const row of Object.values(h.table)) for (const sid of Object.keys(row)) row[sid] = row[sid].slice(drop);
  }
  // Rows that never had a price carry no information.
  for (const [ingId, row] of Object.entries(h.table)) {
    for (const [sid, arr] of Object.entries(row)) if (arr.every((v) => v == null)) delete row[sid];
    if (!Object.keys(row).length) delete h.table[ingId];
  }
  return h;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** How many earlier observations a "usual price" needs, and how far from it counts as cheaper / pricier. */
export const TREND = { minDays: 7, windowDays: 30, threshold: 0.1 };

/**
 * Is `price` (today's price at this store) cheaper or pricier than usual?
 * "Usual" = the median of the last `windowDays` days before the latest day that had a price there.
 * -> { usual, n, change (fraction, -0.15 = 15% cheaper), label: "cheap" | "pricey" | null } or null without enough history.
 */
export function priceTrend(history, ingId, storeId, price, opts = TREND) {
  const arr = history?.table?.[ingId]?.[storeId];
  if (!arr || !Number.isFinite(price) || price <= 0) return null;
  let last = arr.length - 1;
  while (last >= 0 && arr[last] == null) last--;
  if (last < 0) return null;
  const before = arr.slice(Math.max(0, last - opts.windowDays), last).filter((v) => v != null);
  if (before.length < opts.minDays) return null;
  const usual = median(before);
  const change = price / usual - 1;
  const label = change <= -opts.threshold ? "cheap" : change >= opts.threshold ? "pricey" : null;
  return { usual: Math.round(usual * 10) / 10, n: before.length, change, label };
}

/** Every dataset price that is clearly cheaper than usual right now: [{ ingId, storeId, price, usual, change }], best first. */
export function cheaperThanUsual(history, table, opts = TREND) {
  const out = [];
  for (const [ingId, row] of Object.entries(table || {})) {
    for (const [storeId, price] of Object.entries(row)) {
      const t = priceTrend(history, ingId, storeId, price, opts);
      if (t?.label === "cheap") out.push({ ingId, storeId, price, usual: t.usual, change: t.change });
    }
  }
  return out.sort((a, b) => a.change - b.change);
}
