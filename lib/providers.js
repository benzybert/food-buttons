// Platforms the cart can be compared across and ordered from. Edit providers.json.
const providers = require("../providers.json");

const seen = new Set();
for (const p of providers) {
  if (!/^[a-z0-9-]+$/.test(p.id) || typeof p.name !== "string" || seen.has(p.id)) {
    throw new Error(`providers.json: bad or duplicate provider ${JSON.stringify(p)}`);
  }
  if (p.url && !/^https:\/\//.test(p.url)) throw new Error(`providers.json: ${p.id} url must be https`);
  seen.add(p.id);
}

module.exports = providers;
