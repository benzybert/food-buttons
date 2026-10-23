import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../server.js";

let server;
let base;
test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// fetch() follows/normalises paths, so use raw http for traversal tests
const raw = (path, headers = {}, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });

test("serves the app shell with security headers", async () => {
  const r = await raw("/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html; charset=utf-8/);
  assert.match(r.headers["content-security-policy"], /script-src 'self'/);
  assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.match(r.body.toString(), /הזמנת אוכל/);
});

test("correct content types for modules, json, manifest, fonts", async () => {
  assert.match((await raw("/js/main.js")).headers["content-type"], /text\/javascript/);
  assert.match((await raw("/data/recipes.json")).headers["content-type"], /application\/json/);
  assert.match((await raw("/manifest.webmanifest")).headers["content-type"], /application\/manifest\+json/);
  const font = await raw("/fonts/alef-he-700.woff2");
  assert.equal(font.headers["content-type"], "font/woff2");
  assert.match(font.headers["cache-control"], /immutable/);
});

test("gzip when accepted, ETag revalidation gives 304", async () => {
  const plain = await raw("/data/recipes.json");
  const gz = await raw("/data/recipes.json", { "accept-encoding": "gzip" });
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.ok(gz.body.length < plain.body.length / 3);
  const again = await raw("/data/recipes.json", { "if-none-match": plain.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test("HEAD has headers and no body; other methods are rejected", async () => {
  const head = await raw("/", {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal((await raw("/", {}, "POST")).status, 405);
});

test("path traversal and unknown files", async () => {
  // URL parsing already collapses dot segments, so these never leave public/ (404); an encoded slash is caught by the root check (403)
  for (const p of ["/../server.js", "/%2e%2e/server.js", "/..%2fpackage.json", "/%2e%2e%2fpackage.json", "/js/..%2f..%2fserver.js"]) {
    const r = await raw(p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.toString().includes("createServer"), `${p} leaked a source file`);
  }
  assert.equal((await raw("/..%2fpackage.json")).status, 403);
  assert.equal((await raw("/nope.html")).status, 404);
  assert.equal((await raw("/%E0%A4%A")).status, 400);
  assert.equal((await raw("/data")).status, 404); // directories are not listed
});

test("health check", async () => {
  const r = await raw("/healthz");
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), "ok");
});

test("service worker may control the whole origin", async () => {
  assert.equal((await raw("/sw.js")).headers["service-worker-allowed"], "/");
});

test("static-host configs carry the same security headers as server.js", async () => {
  const fs = await import("node:fs");
  const { SECURITY_HEADERS } = await import("../server.js");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const fromVercel = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
  assert.deepEqual(fromVercel, SECURITY_HEADERS);
  const netlify = fs.readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.ok(netlify.includes(`${k} = ${JSON.stringify(v)}`), `netlify.toml lacks ${k}`);
});

test("BRIDGE_ORIGIN adds exactly one origin to connect-src, and only a clean https origin", async () => {
  const { bridgeOrigin, securityHeaders, SECURITY_HEADERS } = await import("../server.js");
  assert.equal(securityHeaders({}), SECURITY_HEADERS, "unset: the strict default");
  assert.equal(bridgeOrigin("https://bridge.up.railway.app"), "https://bridge.up.railway.app");
  assert.equal(bridgeOrigin("https://bridge.up.railway.app/"), "https://bridge.up.railway.app");
  assert.equal(bridgeOrigin("http://localhost:8081"), "http://localhost:8081");
  for (const bad of ["", "http://bridge.example.com", "https://a.example/path", "https://a.example?x=1", "https://user:pw@a.example", "javascript:alert(1)", "not a url", "*", "https://a.example; script-src *"]) {
    assert.equal(bridgeOrigin(bad), "", `rejected: ${bad}`);
    assert.equal(securityHeaders({ BRIDGE_ORIGIN: bad }), SECURITY_HEADERS);
  }
  const csp = securityHeaders({ BRIDGE_ORIGIN: "https://bridge.up.railway.app" })["Content-Security-Policy"];
  assert.match(csp, /connect-src 'self' https:\/\/bridge\.up\.railway\.app;/);
  assert.match(csp, /script-src 'self';/);
  assert.equal(csp.replace(" https://bridge.up.railway.app", ""), SECURITY_HEADERS["Content-Security-Policy"], "nothing else changes");
});

test("server sends the bridge-aware CSP when BRIDGE_ORIGIN is set", async () => {
  const server = createServer({ env: { BRIDGE_ORIGIN: "https://bridge.up.railway.app" } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    assert.match(res.headers.get("content-security-policy"), /connect-src 'self' https:\/\/bridge\.up\.railway\.app;/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
