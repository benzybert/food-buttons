// The site server against a fake grocery API: proxy, token, startup probe and the cart's price fill.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const KEY = "test-key";
const TOKEN = "grocery-token";
const seen = [];
let mode = "ok";
let upstream;
let app;
let base;
let log = "";

const call = (method, url, body) =>
  fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "X-Actor": encodeURIComponent("דנה"), "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });

// Answers like grocery-api: every line comes back as a row; flour is found at
// Shufersal only, eggs at Tiv Taam only, anything else is not found.
function fakeCompare(text) {
  const lines = text.split("\n");
  return {
    ingredients: lines.map((raw) => ({
      raw,
      offers: {
        shufersal: raw.includes("קמח") ? { line_cost: 12 } : null,
        tivtaam: raw.includes("ביצים") ? { line_cost: 9 } : null,
      },
    })),
  };
}

test.before(async () => {
  upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, key: req.headers["x-api-key"], body: raw });
      if (mode === "unauthorized") return res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"לא מורשה"}');
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/health") return res.end('{"ok":true}');
      res.end(JSON.stringify(fakeCompare(JSON.parse(raw).text)));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));

  const port = 20000 + Math.floor(Math.random() * 20000);
  app = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      ACCESS_KEY: KEY,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "fb-grocery-")),
      GROCERY_API_URL: `http://127.0.0.1:${upstream.address().port}/`,
      GROCERY_API_TOKEN: TOKEN,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = `http://127.0.0.1:${port}`;
  app.stdout.on("data", (d) => (log += d));
  await new Promise((resolve) => app.stdout.on("data", () => log.includes("reachable") && resolve()));
});

test.after(() => {
  app.kill();
  upstream.close();
});

test("the startup probe reports the grocery API in the deploy log", () => {
  assert.match(log, /grocery api: reachable at 127\.0\.0\.1:\d+ \(health 200\)/);
  assert.equal(seen[0].url, "/health");
  assert.equal(seen[0].key, TOKEN);
});

test("/api/compare is proxied with the token and stays public", async () => {
  const res = await fetch(base + "/api/compare", { method: "POST", body: JSON.stringify({ text: "2 כוסות קמח" }) });
  assert.equal(res.status, 200);
  const sent = seen.at(-1);
  assert.equal(sent.url, "/compare");
  assert.equal(sent.key, TOKEN);
  assert.equal(JSON.parse(sent.body).text, "2 כוסות קמח");
});

test("prices from the grocery API are stored so that price x qty is the estimated cost", async () => {
  await call("POST", "/api/cart/items", { name: "קמח", qty: 2, unit: "כוסות" });
  await call("POST", "/api/cart/items", { name: "ביצים", qty: 7 });
  await call("POST", "/api/cart/items", { name: "משהו נדיר", qty: 1 });

  const res = await call("POST", "/api/cart/fill-prices");
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { filled: 2, total: 3 });

  const sent = JSON.parse(seen.at(-1).body);
  assert.equal(sent.include_pantry, true);
  assert.equal(sent.text, "2 כוסות קמח\n7 ביצים\n1 משהו נדיר");

  const cart = await (await call("GET", "/api/cart")).json();
  const items = Object.fromEntries(cart.items.map((i) => [i.name, i]));
  assert.deepEqual(items["קמח"].prices, { shufersal: 6 });
  assert.deepEqual(items["ביצים"].prices, { tivtaam: 1.2857 });
  // 9 for 7 eggs must add back up to 9, not 8.99
  assert.equal(cart.compare.find((r) => r.id === "tivtaam").total, 9);
  assert.deepEqual(items["משהו נדיר"].prices, {});

  const events = await (await call("GET", "/api/events?limit=1")).json();
  assert.equal(events[0].type, "cart.prices_filled");
  assert.deepEqual(events[0].data, { filled: 2, total: 3, providers: ["shufersal", "tivtaam"] });
});

test("a wrong token on our side is a 502 for the caller, and nothing is changed", async () => {
  mode = "unauthorized";
  const before = await (await call("GET", "/api/cart")).json();
  const res = await call("POST", "/api/cart/fill-prices");
  assert.equal(res.status, 502);
  assert.deepEqual((await (await call("GET", "/api/cart")).json()).items, before.items);
  mode = "ok";
});

test("filling prices needs the main key and a non-empty cart", async () => {
  assert.equal((await fetch(base + "/api/cart/fill-prices", { method: "POST" })).status, 401);
  for (const item of (await (await call("GET", "/api/cart")).json()).items) await call("DELETE", `/api/cart/items/${item.id}`);
  assert.equal((await call("POST", "/api/cart/fill-prices")).status, 409);
});

test("importing a list can say whose it is", async () => {
  const res = await call("POST", "/api/cart/import", { recipe: "מנות השבוע", lines: "2 עגבניות", source: "sharon" });
  assert.equal(res.status, 201);
  const [item] = await res.json();
  assert.deepEqual(item.sources, ["sharon"]);
  assert.equal((await call("POST", "/api/cart/import", { lines: "1 חלב", source: "wolt" })).status, 400);
});
