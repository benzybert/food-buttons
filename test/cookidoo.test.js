import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, bridgeConfigured, bridgeMessage, checkBridge, fetchRecipe, normalizeBridgeUrl, searchRecipes } from "../public/js/lib/cookidoo.js";
import { parseJsonLd, buildIndex } from "../public/js/lib/parse.js";
import { textLang } from "../public/js/lib/text.js";
import { store } from "../public/js/store.js";
import { loadRaw } from "./helpers.js";

const S = { bridgeUrl: "https://bridge.example.com", bridgeToken: "tok-123" };
const reply = (status, body) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("normalizeBridgeUrl: https origin only (http allowed for localhost), no credentials, path dropped", () => {
  assert.equal(normalizeBridgeUrl(""), "");
  assert.equal(normalizeBridgeUrl("  "), "");
  assert.equal(normalizeBridgeUrl("https://bridge.example.com/some/path?x=1#y"), "https://bridge.example.com");
  assert.equal(normalizeBridgeUrl("http://localhost:8081/"), "http://localhost:8081");
  assert.equal(normalizeBridgeUrl("http://127.0.0.1:8081"), "http://127.0.0.1:8081");
  for (const bad of ["http://bridge.example.com", "ftp://x.example", "javascript:alert(1)", "https://u:p@x.example", "bridge.example.com", "//x.example"]) assert.equal(normalizeBridgeUrl(bad), null, bad);
});

test("bridgeConfigured needs a valid address and a token", () => {
  assert.equal(bridgeConfigured(S), true);
  assert.equal(bridgeConfigured({ ...S, bridgeToken: "" }), false);
  assert.equal(bridgeConfigured({ ...S, bridgeUrl: "http://evil.example" }), false);
  assert.equal(bridgeConfigured({}), false);
});

test("searchRecipes sends the token as a header, never in the URL, and omits credentials", async () => {
  let seen;
  const fetchImpl = async (url, init) => ((seen = { url: String(url), init }), reply(200, { total: 1, page: 0, recipes: [{ id: "r1", name: "Soup" }] })());
  const res = await searchRecipes(S, " chicken soup ", { maxMinutes: 45, fetchImpl });
  assert.equal(res.recipes[0].id, "r1");
  assert.equal(seen.url, "https://bridge.example.com/api/search?q=chicken+soup&maxMinutes=45");
  assert.equal(seen.init.headers.Authorization, "Bearer tok-123");
  assert.ok(!seen.url.includes("tok-123"));
  assert.equal(seen.init.credentials, "omit");
  assert.equal(seen.init.referrerPolicy, "no-referrer");
});

test("fetchRecipe encodes the id and checks the answer is a Recipe", async () => {
  let url;
  const ok = async (u) => ((url = String(u)), reply(200, { "@type": "Recipe", name: "x" })());
  await fetchRecipe(S, "r1/../x", ok);
  assert.equal(url, "https://bridge.example.com/api/recipe/r1%2F..%2Fx");
  await assert.rejects(() => fetchRecipe(S, "r1", reply(200, { hello: 1 })), { kind: "bad_response" });
});

test("errors are classified for the UI", async () => {
  const kind = async (fetchImpl) => {
    try {
      await searchRecipes(S, "a", { fetchImpl });
    } catch (e) {
      assert.ok(e instanceof BridgeError);
      return e.kind;
    }
    return "none";
  };
  assert.equal(await kind(reply(401, { error: "unauthorized" })), "token");
  assert.equal(await kind(reply(429, { error: "rate_limited" })), "rate");
  assert.equal(await kind(reply(502, { error: "cookidoo_auth" })), "cookidoo_auth");
  assert.equal(await kind(reply(502, { error: "cookidoo_unavailable" })), "cookidoo");
  assert.equal(await kind(reply(500, {})), "http");
  assert.equal(await kind(async () => new Response("<html>", { status: 200 })), "bad_response");
  assert.equal(await kind(async () => Promise.reject(new TypeError("Failed to fetch"))), "network");
  assert.equal(await kind(async () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" }))), "timeout");
  await assert.rejects(() => searchRecipes({ bridgeUrl: "", bridgeToken: "" }, "a"), { kind: "config" });
  for (const k of ["config", "network", "timeout", "token", "rate", "cookidoo_auth", "cookidoo", "bad_response"]) assert.ok(bridgeMessage({ kind: k }).length > 10);
});

test("checkBridge: health first (no token), then the token check", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([new URL(url).pathname, init.headers.Authorization]);
    return reply(200, new URL(url).pathname === "/healthz" ? { ok: true, configured: true } : { ok: true })();
  };
  assert.deepEqual(await checkBridge(S, fetchImpl), { configured: true });
  assert.deepEqual(calls, [["/healthz", undefined], ["/api/ping", "Bearer tok-123"]]);
  await assert.rejects(() => checkBridge(S, async (url) => (new URL(url).pathname === "/healthz" ? reply(200, { ok: true, configured: true })() : reply(401, {})())), { kind: "token" });
});

test("what the bridge returns imports cleanly through parseJsonLd", () => {
  const index = buildIndex(loadRaw().ingredients);
  const draft = parseJsonLd(
    {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Chicken soup",
      recipeYield: "6 servings",
      prepTime: "PT20M",
      totalTime: "PT1H10M",
      recipeIngredient: ["800 g chicken thighs", "2 carrots, sliced", "1 onion, quartered", "1 tsp salt", "2 bay leaves"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Chop onion 5 sec/speed 5." }, { "@type": "HowToStep", text: "Cook 40 min/100°C/reverse/speed 1." }],
      cookidoo: { id: "r1" },
    },
    index,
  );
  assert.equal(draft.servings, 6);
  assert.equal(draft.prep, 20);
  assert.equal(draft.cook, 50);
  assert.deepEqual(draft.ingredients.map((i) => i.id || i.custom), ["chicken-thighs", "carrot", "onion", "salt", "bay leaves"]);
  assert.equal(draft.steps[1].settings[0].reverse, true);
  assert.equal(draft.steps[1].settings[0].time, 2400);
});

test("textLang picks the voice by script", () => {
  assert.equal(textLang("Chop 5 sec/speed 5"), "en");
  assert.equal(textLang("קצצו 5 שניות"), "he");
  assert.equal(textLang("12345"), "he");
  assert.equal(textLang("Add oil ושמן"), "en");
});

test("backups never contain the bridge token, and restoring keeps this browser's token for the same address", () => {
  store.init();
  store.update((s) => void Object.assign(s.settings, { bridgeUrl: "https://bridge.example.com", bridgeToken: "tok-123" }));
  const backup = store.exportJSON();
  assert.ok(!backup.includes("tok-123"));
  assert.equal(JSON.parse(backup).data.settings.bridgeUrl, "https://bridge.example.com");
  assert.equal(store.importJSON(backup).ok, true);
  assert.equal(store.get().settings.bridgeToken, "tok-123");
  // a backup that points somewhere else does not inherit the old token
  const other = JSON.parse(backup);
  other.data.settings.bridgeUrl = "https://other.example.com";
  assert.equal(store.importJSON(JSON.stringify(other)).ok, true);
  assert.equal(store.get().settings.bridgeToken, "");
});
