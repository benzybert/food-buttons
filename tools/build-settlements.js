// Writes data-src/settlements.json: Israeli settlements by Central Bureau of Statistics code -> [name, lat, lon].
// The chains' Stores files give a branch's city as this code (5000 = תל אביב - יפו), so the price import uses it for
// the city name and the branch screen for a city-centre position.
//
// Source: the npm package israel-geolocation (MIT, see data-src/settlements.LICENSE), built from Israeli government data.
//   npm pack israel-geolocation && tar xzf israel-geolocation-*.tgz && node tools/build-settlements.js package

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/build-settlements.js <unpacked israel-geolocation package folder>");
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
const list = JSON.parse(fs.readFileSync(path.join(dir, "dist", "locations.json"), "utf8"));
const round = (n) => Math.round(n * 1e4) / 1e4;
const rows = list
  .filter((x) => /^\d+$/.test(x.id) && x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon))
  .sort((a, b) => Number(a.id) - Number(b.id))
  .map((x) => `${JSON.stringify(x.id)}: ${JSON.stringify([x.name, round(x.lat), round(x.lon)])}`);
const source = `Israeli settlements by Central Bureau of Statistics code: [name, lat, lon]. From the npm package ${pkg.name} ${pkg.version} (${pkg.license}, see settlements.LICENSE; ${pkg.homepage || ""}), built from Israeli government data. Rebuild with tools/build-settlements.js.`;
fs.writeFileSync(path.join(ROOT, "data-src", "settlements.json"), `{\n"_source": ${JSON.stringify(source)},\n${rows.join(",\n")}\n}\n`);
fs.copyFileSync(path.join(dir, "LICENSE"), path.join(ROOT, "data-src", "settlements.LICENSE"));
console.log(`wrote data-src/settlements.json: ${rows.length} settlements`);
