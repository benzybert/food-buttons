// Runs the real server as a child process against a fake Instinct endpoint.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const KEY = "test-key";
const received = [];
let instinctStatus = 200;
let instinct;
let app;
let base;

const call = (method, url, body, key = KEY) =>
  fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "X-Actor": encodeURIComponent("שבן"), "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });

const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("timed out");
};

test.before(async () => {
  instinct = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(instinctStatus).end();
    });
  });
  await new Promise((r) => instinct.listen(0, "127.0.0.1", r));

  const port = 20000 + Math.floor(Math.random() * 20000);
  app = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      ACCESS_KEY: KEY,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "fb-api-")),
      INSTINCT_WEBHOOK_URL: `http://127.0.0.1:${instinct.address().port}/hook`,
      INSTINCT_TOKEN: "secret-token",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = `http://127.0.0.1:${port}`;
  await new Promise((resolve) => app.stdout.on("data", (d) => String(d).includes("listening") && resolve()));
});

test.after(() => {
  app.kill();
  instinct.close();
});

test("the API needs the access key; static files do not", async () => {
  assert.equal((await call("GET", "/api/cart", undefined, "wrong")).status, 401);
  assert.equal((await fetch(base + "/api/cart")).status, 401);
  assert.equal((await fetch(base + "/")).status, 200);
});

test("an added item shows up in the cart and is pushed to Instinct", async () => {
  const res = await call("POST", "/api/cart/items", { name: "חלב", qty: 2, unit: "ליטר", source: "sharon" });
  assert.equal(res.status, 201);

  const cart = await (await call("GET", "/api/cart")).json();
  assert.equal(cart.items[0].name, "חלב");

  await until(() => received.length >= 1);
  assert.equal(received[0].auth, "Bearer secret-token");
  assert.equal(received[0].body.source, "food-buttons");
  assert.equal(received[0].body.event.type, "cart.item_added");
  assert.equal(received[0].body.event.actor, "שבן");
  assert.match(received[0].body.event.summary, /חלב/);
});

test("a recipe import and an order both reach Instinct", async () => {
  received.length = 0;
  const imp = await call("POST", "/api/thermomix/import", { recipe: "מרק", lines: "2 גזר\n1 בצל" });
  assert.equal(imp.status, 201);
  const order = await call("POST", "/api/orders", { provider: "shufersal" });
  assert.equal(order.status, 201);
  await until(() => received.length >= 2);
  assert.deepEqual(
    received.map((r) => r.body.event.type),
    ["cart.recipe_imported", "order.placed"],
  );
});

test("events are retried when Instinct is down, then delivered in order", async () => {
  received.length = 0;
  instinctStatus = 503;
  await call("POST", "/api/cart/items", { name: "אורז" });
  await call("POST", "/api/cart/items", { name: "עדשים" });
  const getStatus = async () => (await call("GET", "/api/instinct")).json();
  await until(async () => (await getStatus()).lastError === "HTTP 503");
  const status = await getStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.pending, 2);

  instinctStatus = 200;

  const sync = await call("POST", "/api/instinct/sync");
  assert.equal(sync.status, 201);
  const after = await sync.json();
  assert.equal(after.pending, 0);
  const names = received.filter((r) => r.body.event.type === "cart.item_added").map((r) => r.body.event.data.name);
  assert.deepEqual(names.slice(-2), ["אורז", "עדשים"]);
  assert.equal(received.at(-1).body.event.type, "instinct.sync");
});

test("bad requests get clear errors", async () => {
  assert.equal((await call("POST", "/api/cart/items", { name: "" })).status, 400);
  assert.equal((await call("PATCH", "/api/cart/items/nope", { qty: 1 })).status, 404);
  assert.equal((await call("PUT", "/api/cart")).status, 405);
  assert.equal((await call("GET", "/api/nothing")).status, 404);
  const big = await call("POST", "/api/cart/items", { name: "x", note: "y".repeat(70000) });
  assert.equal(big.status, 413);
});

test("Instinct's read-only key can read but not write", async () => {
  const invite = await (await call("GET", "/api/instinct/invite")).json();
  const readKey = decodeURIComponent(invite.whatsappUrl).match(/Bearer (\S+)/)[1];
  assert.notEqual(readKey, KEY);

  assert.equal((await call("GET", "/api/cart", undefined, readKey)).status, 200);
  assert.equal((await call("GET", "/api/events", undefined, readKey)).status, 200);
  assert.equal((await call("POST", "/api/cart/items", { name: "x" }, readKey)).status, 403);
  assert.equal((await call("POST", "/api/instinct/sync", undefined, readKey)).status, 403);
  assert.equal((await call("GET", "/api/instinct/invite", undefined, readKey)).status, 403);
});

test("the invite is a WhatsApp link to Instinct with the spec and read key", async () => {
  const invite = await (await call("GET", "/api/instinct/invite")).json();
  const url = new URL(invite.whatsappUrl);
  assert.equal(url.origin + url.pathname, "https://wa.me/16508702892");
  const text = url.searchParams.get("text");
  assert.equal(text, invite.message);
  assert.ok(text.includes(`${base}/api/instinct/spec`));
  assert.ok(text.includes("Authorization: Bearer "));
  assert.ok(!text.includes(KEY), "the main key must never be in the message");
});

test("the spec is markdown an agent can fetch with the read key", async () => {
  const res = await call("GET", "/api/instinct/spec");
  assert.match(res.headers.get("content-type"), /text\/markdown/);
  const text = await res.text();
  assert.ok(text.includes(`Base URL: ${base}`));
  assert.ok(text.includes("order.placed"));
});

test("events can be polled with after= without gaps or repeats", async () => {
  const all = await (await call("GET", "/api/events?after=&limit=200")).json();
  assert.ok(all.length >= 3);
  const mid = all[Math.floor(all.length / 2)];
  const rest = await (await call("GET", `/api/events?after=${mid.id}&limit=200`)).json();
  assert.deepEqual(rest.map((e) => e.id), all.slice(all.indexOf(mid) + 1).map((e) => e.id));
  assert.deepEqual(await (await call("GET", `/api/events?after=${all.at(-1).id}`)).json(), []);
});

test("the grocery proxy routes stay public and report when the API is not connected", async () => {
  const res = await fetch(base + "/api/health");
  assert.equal(res.status, 503);
  assert.equal((await fetch(base + "/api/compare", { method: "POST", body: "{}" })).status, 503);
  assert.equal((await fetch(base + "/api/cart")).status, 401);
});

test("workflow pages from the grocery feature are served", async () => {
  assert.equal((await fetch(base + "/sharon/")).status, 200);
  const dir = await fetch(base + "/thermomix", { redirect: "manual" });
  assert.equal(dir.status, 301);
  assert.equal(dir.headers.get("location"), "/thermomix/");
  assert.equal((await fetch(base + "/menu.json")).headers.get("content-type"), "application/json; charset=utf-8");
});
