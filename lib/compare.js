// Price comparison. Prices are per unit and entered by hand per provider
// (item.prices[providerId]); there is no public price API to pull them from.
const round2 = (n) => Math.round(n * 100) / 100;

function compare(items, providers) {
  const rows = providers.map((p) => {
    let total = 0;
    let missing = 0;
    for (const item of items) {
      const price = item.prices?.[p.id];
      if (typeof price === "number") total += price * item.qty;
      else missing++;
    }
    return { id: p.id, name: p.name, total: round2(total), missing, complete: missing === 0 };
  });

  // Only a provider priced for every item can be "cheapest"; a partial total is
  // always lower and would win unfairly.
  const complete = rows.filter((r) => r.complete);
  const cheapest = items.length && complete.length ? complete.reduce((a, b) => (b.total < a.total ? b : a)).id : null;
  return rows.map((r) => ({ ...r, cheapest: r.id === cheapest }));
}

module.exports = { compare, round2 };
