// Nearest branches: plain distance math over public/data/branches.json. Pure, no DOM.
// The person's location never leaves the browser: it is only compared with the branch list here.

const R = 6371; // km

/** Great-circle distance in km between { lat, lon } points. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const located = (b) => Number.isFinite(b.lat) && Number.isFinite(b.lon);
const cityKey = (s) => String(s || "").replace(/[-־–]/g, " ").replace(/["'׳״]/g, "").replace(/\s+/g, " ").trim();

/** Cities that have at least one located branch, sorted in Hebrew order. */
export function cities(branches) {
  return [...new Set(branches.filter((b) => b.city && located(b)).map((b) => cityKey(b.city)))].sort((a, b) => a.localeCompare(b, "he"));
}

/** Rough centre of a city: the mean position of its located branches, or null. */
export function cityPoint(branches, city) {
  const key = cityKey(city);
  const here = branches.filter((b) => located(b) && cityKey(b.city) === key);
  if (!here.length) return null;
  return { lat: here.reduce((a, b) => a + b.lat, 0) / here.length, lon: here.reduce((a, b) => a + b.lon, 0) / here.length };
}

/**
 * The closest branches of each chain to a point: [{ store, branches: [{ ...branch, km }] }], in `stores` order.
 * Chains without a located branch are left out. `maxKm` drops branches further than that.
 */
export function nearestBranches(branches, point, { stores, perStore = 3, maxKm = Infinity } = {}) {
  const ids = stores || [...new Set(branches.map((b) => b.store))];
  const out = [];
  for (const store of ids) {
    const list = branches
      .filter((b) => b.store === store && located(b))
      .map((b) => ({ ...b, km: distanceKm(point, b) }))
      .filter((b) => b.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, perStore);
    if (list.length) out.push({ store, branches: list });
  }
  return out;
}
