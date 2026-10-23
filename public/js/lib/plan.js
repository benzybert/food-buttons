// Weekly meal suggestions. Pure and seeded, so it is testable and repeatable.

/** Small deterministic PRNG (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEALS = new Set(["main", "soup"]);

/**
 * Pick `count` distinct dishes for the week.
 * recipes: candidate recipes (already filtered by the user's preferences)
 * costOf(rec) -> cost of cooking the dish for the household, or null when its ingredients have no price
 * Tries many random combinations and prefers: within budget > more categories > cheaper.
 */
export function suggestWeek(recipes, costOf, { count = 5, budget = 0, seed = 1, tries = 400 } = {}) {
  const pool = recipes.filter((r) => MEALS.has(r.category));
  const source = pool.length >= count ? pool : recipes;
  if (!source.length) return [];
  const n = Math.min(count, source.length);
  const rnd = seeded(seed);
  let best = null;
  for (let t = 0; t < tries; t++) {
    const pick = [];
    const used = new Set();
    while (pick.length < n) {
      const i = Math.floor(rnd() * source.length);
      if (used.has(i)) continue;
      used.add(i);
      pick.push(source[i]);
    }
    const costs = pick.map(costOf);
    const known = costs.every((c) => c != null); // unknown prices count as 0 for ranking, but never "break" a budget
    const cost = costs.reduce((a, c) => a + (c ?? 0), 0);
    const variety = new Set(pick.map((r) => r.category)).size + new Set(pick.map((r) => r.kosher)).size * 0.5;
    const within = !budget || !known || cost <= budget;
    const score = (within ? 1000 : 0) + variety * 10 - cost / 10 - (within ? 0 : cost - budget);
    if (!best || score > best.score) best = { pick, cost, score };
  }
  return best.pick;
}

/** Recipes you could cook with what is at home: [{ rec, missing: ingredientIds[] }] fewest missing first. */
export function cookableWith(recipes, pantry, ingById) {
  const out = [];
  for (const rec of recipes) {
    const need = [...new Set(rec.ingredients.filter((l) => l.id && !ingById.get(l.id)?.free).map((l) => l.id))];
    const missing = need.filter((id) => !pantry.has(id));
    out.push({ rec, missing, total: need.length, have: need.length - missing.length });
  }
  return out.sort((a, b) => a.missing.length - b.missing.length || b.have - a.have);
}
