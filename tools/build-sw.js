// Generates public/sw.js from tools/sw.template.js: a content hash becomes the cache version
// and every public file (except sw.js itself) is precached.
//   node tools/build-sw.js          write
//   node tools/build-sw.js --check  exit 1 when public/sw.js is stale

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SKIP = new Set(["sw.js", "fonts/README.txt"]);

// The shop pages (shared cart, real supermarket prices, Sharon/Thermomix workflows) need the server.
// They are never precached and the worker leaves them and /api alone. "dir/" = prefix, else exact path.
export const NETWORK_ONLY = [
  "/api/",
  "/cart.html",
  "/cart.css",
  "/cart.js",
  "/to-cart.js",
  "/app.js",
  "/shop.css",
  "/menu.json",
  "/groceries/",
  "/sharon/",
  "/thermomix/",
];
const isNetworkOnly = (rel) => NETWORK_ONLY.some((p) => (p.endsWith("/") ? `/${rel}`.startsWith(p) : `/${rel}` === p));

export function listFiles(dir = PUBLIC, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (!SKIP.has(rel) && !isNetworkOnly(rel)) out.push(rel);
  }
  return out;
}

export function buildSw() {
  const files = listFiles();
  const hash = crypto.createHash("sha1");
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(PUBLIC, f)));
  hash.update(fs.readFileSync(path.join(ROOT, "tools", "sw.template.js")));
  const version = hash.digest("hex").slice(0, 10);
  const precache = ["./", ...files.map((f) => f)];
  const source = fs
    .readFileSync(path.join(ROOT, "tools", "sw.template.js"), "utf8")
    .replace("__VERSION__", version)
    .replace("__FILES__", JSON.stringify(precache, null, 2))
    .replace("__NETWORK_ONLY__", JSON.stringify(NETWORK_ONLY));
  return { source, version, files: precache };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { source, version } = buildSw();
  const out = path.join(PUBLIC, "sw.js");
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (current !== source) {
      console.error("public/sw.js is stale (run npm run build:sw)");
      process.exit(1);
    }
    console.log("sw.js is up to date");
  } else {
    fs.writeFileSync(out, source);
    console.log(`wrote public/sw.js (version ${version})`);
  }
}
