import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, bridgeConfigured, bridgeMessage, checkBridge, fetchRecipe, loginBridge, needsLogin, normalizeBridgeUrl, searchRecipes } from "../public/js/lib/cookidoo.js";
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

test("checkBridge: health first (no token), then the token and login check", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const p = new URL(url).pathname;
    calls.push([p, init.headers.Authorization, init.headers["X-Cookidoo-Session"]]);
    return reply(200, p === "/healthz" ? { ok: true, configured: false, sessions: true } : { ok: true, loggedIn: false, canLogin: true, fixedAccount: false })();
  };
  assert.deepEqual(await checkBridge(S, fetchImpl), { loggedIn: false, canLogin: true, fixedAccount: false });
  assert.deepEqual(calls, [["/healthz", undefined, undefined], ["/api/ping", "Bearer tok-123", undefined]]);
  await assert.rejects(() => checkBridge(S, async (url) => (new URL(url).pathname === "/healthz" ? reply(200, { ok: true })() : reply(401, { error: "unauthorized" })())), { kind: "token" });
  await assert.rejects(() => checkBridge({ ...S, bridgeSession: "old" }, async (url) => (new URL(url).pathname === "/healthz" ? reply(200, { ok: true })() : reply(401, { error: "session_invalid" })())), { kind: "login_expired" });
});

test("loginBridge posts the password once in a JSON body (never in the URL) and returns only the session", async () => {
  let seen;
  const fetchImpl = async (url, init) => ((seen = { url: String(url), init }), reply(200, { session: "sealed.abc", email: "me@example.com", days: 30 })());
  const r = await loginBridge({ ...S, bridgeSession: "stale" }, " me@example.com ", "pässword?&=1", fetchImpl);
  assert.deepEqual(r, { session: "sealed.abc", email: "me@example.com", days: 30 });
  assert.equal(seen.url, "https://bridge.example.com/api/login");
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), { email: "me@example.com", password: "pässword?&=1" });
  assert.equal(seen.init.headers.Authorization, "Bearer tok-123");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(seen.init.headers["X-Cookidoo-Session"], undefined, "a stale session is not sent along with a new login");
  assert.ok(!seen.url.includes("ss") && !JSON.stringify(seen.init.headers).includes("pässword"));
  await assert.rejects(() => loginBridge(S, "a@b.c", "x", reply(200, { email: "a@b.c" })), { kind: "bad_response" });
});

test("login errors are told apart from token errors", async () => {
  const kind = async (status, error) => {
    try {
      await loginBridge(S, "a@b.c", "x", reply(status, { error }));
    } catch (e) {
      return e.kind;
    }
    return "none";
  };
  assert.equal(await kind(401, "login_failed"), "login_failed");
  assert.equal(await kind(401, "unauthorized"), "token");
  assert.equal(await kind(429, "login_locked"), "login_locked");
  assert.equal(await kind(429, "rate_limited"), "rate");
  assert.equal(await kind(404, "sessions_disabled"), "login_unsupported");
  assert.equal(await kind(502, "cookidoo_unavailable"), "cookidoo");
  for (const k of ["login_required", "login_expired", "login_failed", "login_locked", "login_unsupported"]) assert.ok(bridgeMessage({ kind: k }).length > 10, k);
});

test("the Cookidoo session rides along as a header on search and recipe calls, and its loss means 'log in again'", async () => {
  const withSession = { ...S, bridgeSession: "sealed.abc" };
  const headers = [];
  const spy = (body) => async (url, init) => (headers.push(init.headers["X-Cookidoo-Session"]), reply(200, body)());
  await searchRecipes(withSession, "soup", { fetchImpl: spy({ recipes: [] }) });
  await fetchRecipe(withSession, "r1", spy({ "@type": "Recipe" }));
  assert.deepEqual(headers, ["sealed.abc", "sealed.abc"]);
  for (const [error, kind] of [["session_invalid", "login_expired"], ["login_required", "login_required"]]) {
    const e = await searchRecipes(withSession, "soup", { fetchImpl: reply(401, { error }) }).catch((x) => x);
    assert.equal(e.kind, kind);
    assert.equal(needsLogin(e), true);
  }
  assert.equal(needsLogin({ kind: "token" }), false);
  assert.equal(needsLogin(undefined), false);
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

test("backups never contain the bridge token or login, and restoring keeps this browser's for the same address", () => {
  store.init();
  store.update((s) => void Object.assign(s.settings, { bridgeUrl: "https://bridge.example.com", bridgeToken: "tok-123", bridgeSession: "sealed.abc", bridgeAccount: "me@example.com" }));
  const backup = store.exportJSON();
  assert.ok(!backup.includes("tok-123") && !backup.includes("sealed.abc") && !backup.includes("me@example.com"));
  assert.equal(JSON.parse(backup).data.settings.bridgeUrl, "https://bridge.example.com");
  assert.equal(store.importJSON(backup).ok, true);
  assert.deepEqual(
    [store.get().settings.bridgeToken, store.get().settings.bridgeSession, store.get().settings.bridgeAccount],
    ["tok-123", "sealed.abc", "me@example.com"],
  );
  // a backup that points somewhere else does not inherit the old token or login
  const other = JSON.parse(backup);
  other.data.settings.bridgeUrl = "https://other.example.com";
  assert.equal(store.importJSON(JSON.stringify(other)).ok, true);
  assert.deepEqual([store.get().settings.bridgeToken, store.get().settings.bridgeSession, store.get().settings.bridgeAccount], ["", "", ""]);
});
