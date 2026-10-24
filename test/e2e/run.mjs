// End-to-end checks in a real browser (Chromium via Playwright).
//   npm run e2e
// Needs `playwright` (global or local) and a Chromium. Set CHROMIUM_PATH if it is not found automatically.
// Optional: axe-core for the accessibility sweep (AXE_CORE=/path/to/axe.min.js, or install axe-core).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "../../server.js";

function loadPlaywright() {
  const attempts = [() => createRequire(import.meta.url)("playwright"), () => createRequire(path.join(execSync("npm root -g").toString().trim(), "x"))("playwright")];
  for (const a of attempts) {
    try {
      return a();
    } catch {
      /* try next */
    }
  }
  console.error("playwright not found. Install it (npm i -g playwright) and a Chromium, then re-run.");
  process.exit(2);
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, "chrome-linux", "chrome");
      if (d.startsWith("chromium-") && fs.existsSync(p)) return p;
    }
  } catch {
    /* default install */
  }
  return undefined;
}

function findAxe() {
  const candidates = [process.env.AXE_CORE, path.join(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/axe-core/axe.min.js")].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

const RECIPES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/recipes.json"), "utf8"));
const { chromium } = loadPlaywright();
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: findChromium() });

let passed = 0;
const failures = [];
async function step(name, fn, { width = 390, height = 844, setup } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "he-IL", acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
  try {
    if (setup) await setup(page, ctx);
    await fn(page, ctx);
    assert.deepEqual(problems, [], "browser reported errors");
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  } finally {
    await ctx.close();
  }
}

const go = async (page, hash) => {
  await page.goto(BASE + hash);
  await page.waitForSelector("#main > *");
};
const addDish = (page, id) => page.locator(`[data-fk="add-${id}"]`).click();
const text = (page, sel) => page.locator(sel).first().innerText();

// The app ships with no prices. Tests that need numbers type them in the way a person does.
const INGREDIENTS = new Map(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/data/ingredients.json"), "utf8")).map((i) => [i.id, i]));
const dishName = (id) => RECIPES.find((r) => r.id === id).name;
const FIRST_STORES = ["שופרסל", "רמי לוי", "ויקטורי", "אושר עד"]; // the other four stay unpriced on purpose

/** "ייבוא מחירים": every ingredient of the dishes at the first four stores; store i costs 8 + i per pack. */
async function seedPrices(page, dishIds) {
  const ids = new Set();
  for (const d of dishIds) for (const l of RECIPES.find((r) => r.id === d).ingredients) if (l.id && !INGREDIENTS.get(l.id).free) ids.add(l.id);
  const lines = [...ids].flatMap((id) => FIRST_STORES.map((s, i) => `${INGREDIENTS.get(id).name}, ${s}, ${8 + i}`));
  await go(page, "#/prices");
  await page.getByRole("button", { name: "ייבוא מחירים" }).click();
  await page.locator('[aria-label="מחירים בפורמט מצרך, חנות, מחיר"]').fill(lines.join("\n"));
  await page.getByRole("button", { name: "ייבוא", exact: true }).click();
  await page.waitForSelector("[role=status]");
  assert.match(await text(page, "[role=status]"), new RegExp(`יובאו ${lines.length} מחירים`), "every line was understood");
  await page.keyboard.press("Escape");
}

/** Sharon's "עריכת מחירון": a price per serving for each dish, { dishId: price }. */
async function setSharonPrices(page, prices) {
  await go(page, "#/order");
  await page.getByRole("button", { name: "עריכת מחירון" }).click();
  for (const [id, price] of Object.entries(prices)) {
    const input = page.locator(`[aria-label="מחיר למנה: ${dishName(id)}"]`);
    await input.fill(String(price));
    await input.press("Tab");
  }
  await page.getByRole("button", { name: "סיום עריכה" }).click();
}

console.log(`e2e against ${BASE}`);

await step("home: two big buttons link to Sharon and Thermomix", async (page) => {
  await go(page, "");
  assert.equal(await page.locator("a.big").count(), 2);
  assert.equal(await page.locator("#sharon").getAttribute("href"), "#/order");
  assert.equal(await page.locator("#thermomix").getAttribute("href"), "#/cook");
  assert.equal(await page.locator("#site-header").isVisible(), false);
  await page.locator("#thermomix").click();
  await page.waitForSelector(".dcard");
  assert.equal(await page.locator(".dcard").count(), RECIPES.length);
});

await step("recipes: search, category and kosher filters", async (page) => {
  await go(page, "#/cook");
  await page.locator('input[type="search"]').fill("עדשים");
  await page.waitForFunction(() => document.querySelectorAll(".dcard").length === 2);
  const names = await page.locator(".dcard h2").allInnerTexts();
  assert.ok(names.some((n) => n.includes("עדשים")) && names.some((n) => n.includes("מג'דרה")), names.join());
  await page.locator('input[type="search"]').fill("");
  await page.locator('[data-fk="cat-soup"]').click();
  const soups = RECIPES.filter((r) => r.category === "soup");
  await page.waitForFunction((n) => document.querySelectorAll(".dcard").length === n, soups.length);
  assert.match(page.url(), /cat=soup/);
  await page.locator("details summary").click();
  await page.locator('[data-fk="k-meat"]').click();
  const meatSoups = soups.filter((r) => r.kosher === "meat");
  await page.waitForFunction((n) => document.querySelectorAll(".dcard").length === n, meatSoups.length);
  await page.reload();
  await page.waitForSelector(".dcard");
  assert.equal(await page.locator(".dcard").count(), meatSoups.length, "filters survive reload via the URL");
});

await step("dish page: servings scale the ingredients and cost", async (page) => {
  await go(page, "#/dish/chicken-soup");
  const before = await text(page, ".ing-list li:first-child .q");
  assert.match(before, /550/);
  await page.getByRole("button", { name: /הוסף מנות/ }).click();
  await page.waitForFunction(() => document.querySelector(".stepper output")?.textContent === "6");
  const after = await text(page, ".ing-list li:first-child .q");
  assert.notEqual(before, after);
  assert.match(page.url(), /s=6/);
  assert.equal(await page.locator(".verdict").count(), 0, "no cook-vs-order block while nothing has a price");
  assert.equal(await page.locator(".ing-list .c").count(), 0, "no per-ingredient cost");
  assert.match(await text(page, ".notice.compact"), /אין מחירים/);
  assert.match(await text(page, ".dish-hero"), /קק״ל/);
  await page.locator('[data-fk="note-chicken-soup"]').fill("פחות מלח");
  await page.locator('[data-fk="note-chicken-soup"]').press("Tab");
  await page.reload();
  assert.equal(await page.locator('[data-fk="note-chicken-soup"]').inputValue(), "פחות מלח");
});

await step("no prices, no numbers: not one shekel sign on any screen until somebody types a price", async (page) => {
  await go(page, "#/cook");
  for (const id of ["chicken-soup", "pasta-pomodoro"]) await addDish(page, id);
  const screens = ["#/", "#/cook", "#/dish/chicken-soup", "#/compare", "#/list", "#/plan", "#/order", "#/pantry", "#/surprise"];
  for (const hash of screens) {
    await go(page, hash);
    await page.waitForTimeout(150);
    const body = await page.locator("body").innerText();
    assert.ok(!body.includes("₪"), `${hash} shows a price with none entered: ${body.match(/.{0,30}₪.{0,10}/)?.[0]}`);
  }
  await go(page, "#/compare");
  assert.match(await text(page, ".notice.compact"), /אין מחירים/);
  assert.equal(await page.locator(".verdict, .big-num").count(), 0);
  await go(page, "#/cook");
  assert.equal(await page.locator(".dcard-price").count(), 0, "recipe cards carry no price line");
  assert.equal(await page.locator('select[aria-label="מיון"] option[value="cheap"]').count(), 0, "no sort by price");
  // the list and the Sharon order still work: quantities need no price
  await go(page, "#/list");
  assert.ok((await page.locator(".shop-item").count()) > 5);
});

await step("basket and compare: a total exists only for stores that price every item", async (page) => {
  const dishes = ["chicken-soup", "pasta-pomodoro", "shakshuka"];
  await seedPrices(page, dishes);
  await setSharonPrices(page, Object.fromEntries(dishes.map((d) => [d, 60])));
  await go(page, "#/cook");
  for (const id of dishes) await addDish(page, id);
  assert.match(await text(page, "#basket-pill"), /3 מתכונים/);
  await go(page, "#/compare");
  assert.equal(await page.locator(".basket-row").count(), 3);
  const rows = page.locator('ul.rows[aria-label="עלות הסל לפי חנות"] > li');
  assert.equal(await rows.count(), 8, "all eight stores are listed");
  const withTotal = await rows.filter({ hasText: "₪" }).count();
  assert.equal(withTotal, 4, "only the four stores with prices get a total");
  assert.equal(await rows.filter({ hasText: "חסרים מחירים ל-" }).count(), 4, "the others say what is missing");
  assert.match(await text(page, 'ul.rows[aria-label="עלות הסל לפי חנות"] > li.best'), /שופרסל/, "the cheapest priced store wins");
  assert.match(await text(page, ".verdict-msg"), /בישול חוסך/);
  await page.locator("summary", { hasText: "התאמות לחישוב" }).click();
  assert.equal(await page.locator('[data-fk="delivery"]').count(), 0, "no delivery toggle: there is no delivery data");
  await go(page, "#/list");
  assert.ok((await page.locator(".shop-item").count()) > 5);
});

await step("compare with one dish unpriced: no store total, and it names what is missing", async (page) => {
  await seedPrices(page, ["chicken-soup", "pasta-pomodoro"]); // shakshuka's ingredients stay unpriced
  await go(page, "#/cook");
  for (const id of ["chicken-soup", "pasta-pomodoro", "shakshuka"]) await addDish(page, id);
  await go(page, "#/compare");
  await page.waitForSelector("#missing-h");
  assert.match(await text(page, "#missing-h"), /חסרים מחירים/);
  assert.match(await text(page, "section[aria-labelledby=missing-h]"), /חסרים \d+ מחירים/);
  assert.equal(await page.locator(".verdict, ul.rows[aria-label='עלות הסל לפי חנות']").count(), 0, "no verdict and no store totals while a price is missing");
  // the dishes that are fully priced still show their own cost in the basket
  const rowsText = await page.locator(".basket-row").allInnerTexts();
  assert.equal(rowsText.filter((t) => t.includes("₪")).length, 2);
  await page.getByRole("link", { name: "הזנת מחירים" }).first().click();
  await page.waitForSelector("table.tbl");
});

await step("dish page with prices: cook vs order, and a missing price shows as missing", async (page) => {
  await seedPrices(page, ["chicken-soup"]);
  await setSharonPrices(page, { "chicken-soup": 40 });
  await go(page, "#/dish/chicken-soup");
  const verdict = await text(page, ".verdict");
  assert.match(verdict, /בישול עצמי/);
  assert.match(verdict, /₪/);
  assert.match(verdict, /הזמנה · שרון/);
  assert.match(await text(page, ".verdict-msg"), /מבשלים וחוסכים|ההזמנה זולה/);
  assert.ok((await page.locator(".ing-list .c").count()) > 3, "each ingredient shows its cost");
  // a dish whose ingredients are not priced says so instead of showing a number
  await go(page, "#/dish/shakshuka");
  assert.match(await text(page, ".verdict"), /חסר מחיר ל-/);
  assert.equal(await page.locator(".verdict .big-num", { hasText: "₪" }).count(), 0);
});

await step("shopping list: tick items, persist after reload, text export", async (page) => {
  await go(page, "#/cook");
  await addDish(page, "shakshuka");
  await go(page, "#/list");
  const first = page.locator(".shop-item input[type=checkbox]").first();
  await first.check();
  await page.reload();
  await page.waitForSelector(".shop-item");
  assert.equal(await page.locator(".shop-item input[type=checkbox]").first().isChecked(), true);
  await page.getByRole("button", { name: "העתקה" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /רשימת קניות/);
  assert.match(clip, /✅/);
  const wa = await page.getByRole("link", { name: /וואטסאפ/ }).getAttribute("href");
  assert.match(wa, /^https:\/\/wa\.me\/\?text=/);
});

await step("cook mode: steps, keyboard, timer, finish logs saving", async (page) => {
  await go(page, "#/cook/chicken-soup");
  assert.match(await text(page, ".cook-step"), /לפני שמתחילים/);
  await page.keyboard.press("ArrowLeft"); // RTL: left = forward
  await page.waitForSelector(".cook-step .text");
  assert.match(await text(page, ".cook-step .count"), /שלב 1 מתוך 5/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  assert.match(await text(page, ".cook-step .count"), /שלב 3 מתוך 5/);
  const timer = page.locator("[data-timer]").first();
  assert.equal((await timer.locator(".time").innerText()).trim(), "35:00");
  await timer.getByRole("button", { name: /התחלה/ }).click();
  await page.waitForFunction(() => document.querySelector("[data-timer] .time")?.textContent !== "35:00");
  await page.locator("[data-timer]").getByRole("button", { name: /השהיה/ }).click();
  await page.keyboard.press("ArrowRight");
  assert.match(await text(page, ".cook-step .count"), /שלב 2 מתוך 5/);
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  assert.match(await text(page, ".cook-step"), /בתיאבון/);
  await page.getByRole("button", { name: /רשמו שבישלתי/ }).click();
  await page.waitForSelector(".chip.good");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("fb:v1")).cooked);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].saved, 0, "no prices, so no saving is claimed");
  await go(page, "#/");
  assert.doesNotMatch(await text(page, ".home-foot"), /חסכתם/);
});

await step("cook mode with prices: finishing logs a real saving", async (page) => {
  await seedPrices(page, ["chicken-soup"]);
  await setSharonPrices(page, { "chicken-soup": 60 });
  await go(page, "#/cook/chicken-soup");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: /רשמו שבישלתי/ }).click();
  await page.waitForSelector(".chip.good");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("fb:v1")).cooked);
  assert.ok(saved[0].saved > 50, `saved ${saved[0].saved}`);
  await go(page, "#/");
  assert.match(await text(page, ".home-foot"), /חסכתם החודש/);
});

await step("Sharon order: cart total, WhatsApp link with number and text", async (page) => {
  await go(page, "#/order");
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.waitForFunction(() => /2 מנות/.test(document.querySelector("#cart-h")?.textContent || "")); // re-rendering is async
  await page.locator("#order-phone").fill("050-123-4567");
  await page.locator("#order-phone").press("Tab");
  const link = page.getByRole("link", { name: /שליחה לשרון/ });
  await link.waitFor();
  const href = await link.getAttribute("href");
  assert.match(href, /^https:\/\/wa\.me\/972501234567\?text=/);
  assert.match(decodeURIComponent(href), /2 × מרק עוף של שישי/);
  assert.doesNotMatch(decodeURIComponent(href), /₪|סה״כ/, "ordering works without a price: the message has quantities only");
  assert.doesNotMatch(await text(page, "section[aria-labelledby=cart-h]"), /₪/);
  // edit mode: enter a price and see it in the cart and in the message
  await page.getByRole("button", { name: "עריכת מחירון" }).click();
  const input = page.locator('[aria-label="מחיר למנה: מרק עוף של שישי"]');
  await input.fill("40");
  await input.press("Tab");
  await page.getByRole("button", { name: "סיום עריכה" }).click();
  await page.waitForSelector("#cart-h");
  assert.match(await text(page, ".price"), /40/);
  assert.match(await text(page, "section[aria-labelledby=cart-h]"), /80/);
  assert.match(decodeURIComponent(await page.getByRole("link", { name: /שליחה לשרון/ }).getAttribute("href")), /סה״כ לפי המחירון: 80 ₪/);
});

await step("custom order source: added, priced, and compared on the dish page", async (page) => {
  await go(page, "#/order");
  await page.getByRole("button", { name: "הוספת מקור" }).click();
  await page.locator("#src-name").fill("וולט");
  await page.locator("#src-markup").fill("30");
  await page.locator("#src-fee").fill("20");
  await page.getByRole("button", { name: "הוספה", exact: true }).click();
  await page.waitForSelector('h1:has-text("הזמנה דרך וולט")');
  assert.match(page.url(), /src=src-/);
  // the source has a markup and a fee but nothing to apply the markup to: the dish has no price there yet
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.waitForSelector("#cart-h");
  assert.doesNotMatch(await text(page, "section[aria-labelledby=cart-h]"), /₪/, "no price, no total");
  await page.getByRole("button", { name: "עריכת מחירון" }).click();
  const price = page.locator('[aria-label="מחיר למנה: מרק עוף של שישי"]');
  await price.fill("32");
  await price.press("Tab");
  await page.getByRole("button", { name: "סיום עריכה" }).click();
  await page.waitForSelector("#cart-h");
  // 32 for the serving + 20 delivery
  assert.match(await text(page, "section[aria-labelledby=cart-h]"), /52/);
  await go(page, "#/dish/chicken-soup");
  await page.locator("summary", { hasText: "פירוט לפי חנות" }).click();
  assert.match(await text(page, "details"), /וולט/);
});

await step("import: paste a recipe, fix it, save, price it, cook it", async (page) => {
  await go(page, "#/import");
  const recipe = `פסטה בשמנת
4 מנות
זמן הכנה: 10 דקות

מצרכים
400 גרם פסטה
250 מ"ל שמנת לבישול
1 בצל
2 שיני שום
קורט מלח
100 גרם קינואה

אופן ההכנה
1. קצצו את הבצל והשום 5 שנ'/מהירות 5.
2. הוסיפו שמנת ובשלו 8 דק'/100°C/מהירות 1.`;
  await page.locator('[data-fk="paste"]').fill(recipe);
  await page.getByRole("button", { name: "ניתוח המתכון" }).click();
  await page.waitForSelector("form");
  assert.match(await text(page, ".notice.warn"), /לא זוהו/);
  assert.equal(await page.locator('input[aria-label^="שם מצרך"]').count(), 1, "the unknown ingredient keeps a free-text name");
  await page.getByRole("button", { name: "שמירת המתכון" }).click();
  await page.waitForURL(/#\/dish\/my-/);
  assert.match(await text(page, "h1"), /פסטה בשמנת/);
  assert.match(await text(page, ".notice.compact"), /אין מחירים/);
  assert.equal(await page.locator(".chip-tm").count(), 2);
  await go(page, "#/cook");
  assert.match((await page.locator(".dcard h2").allInnerTexts()).join("|"), /פסטה בשמנת/);
  await go(page, "#/cook");
  await page.locator('.dcard a.dcard-link[href^="#/dish/my-"]').click();
  await page.getByRole("link", { name: "עריכה" }).click();
  await page.waitForSelector("form");
  assert.equal(await page.locator('input[type="number"]').first().inputValue(), "4");
});

// A stand-in for bridge/ (no Cookidoo account needed): same routes, token check, login/session and CORS as the real one.
const BRIDGE_TOKEN = "e2e-token-0123456789abcdef0123";
const E2E_LOGIN = { email: "me@example.com", password: "correct horse" };
const E2E_SESSION = "sealed-e2e-session";
const bridgeStub = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Cookidoo-Session", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
  const json = (status, body) => (res.writeHead(status, { ...cors, "Content-Type": "application/json" }), res.end(JSON.stringify(body)));
  if (req.method === "OPTIONS") return (res.writeHead(204, cors), res.end());
  if (url.pathname === "/healthz") return json(200, { ok: true, configured: false, sessions: true });
  if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return json(401, { error: "unauthorized" });
  const hasSession = req.headers["x-cookidoo-session"] === E2E_SESSION;
  if (req.headers["x-cookidoo-session"] && !hasSession) return json(401, { error: "session_invalid" });
  if (url.pathname === "/api/ping") return json(200, { ok: true, loggedIn: hasSession, canLogin: true, fixedAccount: false });
  if (url.pathname === "/api/login" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    return body.email === E2E_LOGIN.email && body.password === E2E_LOGIN.password ? json(200, { session: E2E_SESSION, email: body.email, days: 30 }) : json(401, { error: "login_failed" });
  }
  if (!hasSession) return json(401, { error: "login_required" });
  if (url.pathname === "/api/search") return json(200, { total: 1, page: 0, recipes: [{ id: "r1", name: "Tomato soup", thumbnail: null, url: "https://cookidoo.example/r1" }] });
  if (url.pathname === "/api/recipe/r1") {
    return json(200, {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Tomato soup",
      recipeYield: "4 servings",
      prepTime: "PT15M",
      totalTime: "PT45M",
      recipeIngredient: ["600 g tomatoes", "1 onion, peeled", "2 tbsp olive oil", "1 star anise"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Chop onion 5 sec/speed 5." }, { "@type": "HowToStep", text: "Cook 20 min/100°C/speed 2." }],
      cookidoo: { id: "r1" },
    });
  }
  json(404, { error: "not_found" });
});
await new Promise((r) => bridgeStub.listen(0, "127.0.0.1", r));
const BRIDGE_URL = `http://127.0.0.1:${bridgeStub.address().port}`;
// The app server must be told which origin the page may call (CSP connect-src), as in a real deployment.
const linkedServer = createServer({ env: { BRIDGE_ORIGIN: BRIDGE_URL } });
await new Promise((r) => linkedServer.listen(0, "127.0.0.1", r));
const LINKED = `http://127.0.0.1:${linkedServer.address().port}/`;

await step("cookidoo bridge: connect in settings, search, import an English recipe, save and cook it", async (page) => {
  const open = async (hash) => (await page.goto(LINKED + hash), page.waitForSelector("#main > *"));
  await open("#/import");
  assert.match(await text(page, "main"), /בהגדרות/, "without a bridge the import page points to the settings");
  assert.equal(await page.locator('[data-fk="cookidoo-q"]').count(), 0);

  const axeFile = findAxe();
  const axeCheck = async (where) => {
    if (!axeFile) return;
    await page.evaluate(fs.readFileSync(axeFile, "utf8"));
    const res = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
    assert.deepEqual(res.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${where}: ${v.id} ${v.nodes[0].target.join(" ")}`), []);
  };
  await open("#/settings");
  await page.locator('[data-fk="set-bridge-url"]').fill(BRIDGE_URL + "/");
  await page.locator('[data-fk="set-bridge-url"]').blur();
  assert.equal(await page.locator('[data-fk="set-bridge-url"]').inputValue(), BRIDGE_URL, "normalised to a bare origin");
  assert.equal(await page.locator('[data-fk="ck-login"]').count(), 0, "no login form until the address and token are in");
  await page.locator('[data-fk="set-bridge-token"]').fill("wrong-token");
  await page.locator('[data-fk="set-bridge-token"]').blur();
  await page.locator('[data-fk="bridge-test"]').click();
  await page.waitForFunction(() => /הטוקן שגוי/.test(document.querySelector('[role="status"]')?.textContent || ""));
  await page.locator('[data-fk="set-bridge-token"]').fill(BRIDGE_TOKEN);
  await page.locator('[data-fk="set-bridge-token"]').blur();
  await page.locator('[data-fk="bridge-test"]').click();
  await page.waitForFunction(() => /התחברו לחשבון Cookidoo/.test(document.body.textContent));

  // search before logging in points to the settings
  await open("#/import");
  await page.locator('[data-fk="cookidoo-q"]').fill("tomato");
  await page.locator('[data-fk="cookidoo-search"]').click();
  await page.waitForFunction(() => /צריך להתחבר/.test(document.querySelector('[role="alert"]')?.textContent || ""));
  await page.getByRole("link", { name: "להגדרות" }).click();

  await axeCheck("settings with the Cookidoo login form");
  // log in: a wrong password is refused, the right one leaves only the session behind
  await page.locator('[data-fk="ck-email"]').fill(E2E_LOGIN.email);
  await page.locator('[data-fk="ck-pass"]').fill("wrong");
  await page.locator('[data-fk="ck-login"]').click();
  await page.waitForFunction(() => /Cookidoo לא קיבלה/.test(document.body.textContent));
  await page.locator('[data-fk="ck-pass"]').fill(E2E_LOGIN.password);
  await page.locator('[data-fk="ck-login"]').click();
  await page.waitForSelector('[data-fk="ck-logout"]');
  assert.match(await text(page, "main"), /מחובר כ-\s*me@example\.com/);
  const stored = await page.evaluate(() => localStorage.getItem("fb:v1"));
  assert.ok(!stored.includes(E2E_LOGIN.password), "the password is not kept in this browser");
  assert.ok(stored.includes(E2E_SESSION));
  await page.locator('[data-fk="bridge-test"]').click();
  await page.waitForFunction(() => /מחובר לחשבון me@example\.com/.test(document.querySelector('[role="status"]')?.textContent || ""));
  assert.ok(!(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).includes(E2E_LOGIN.password));

  await axeCheck("settings, logged in to Cookidoo");

  await open("#/import");
  await page.locator('[data-fk="cookidoo-q"]').fill("tomato");
  await page.locator('[data-fk="cookidoo-search"]').click();
  await page.waitForSelector('[data-fk="cookidoo-import-r1"]');
  await axeCheck("import with search results");
  await page.locator('[data-fk="cookidoo-import-r1"]').click();
  await page.waitForSelector("form");
  assert.match(await text(page, ".notice.warn"), /באנגלית/);
  assert.equal(await page.locator('input[dir="auto"]').first().inputValue(), "Tomato soup");
  assert.equal(await page.locator('input[aria-label^="שם מצרך"]').count(), 1, "only the star anise is left without a catalog match");
  await page.getByRole("button", { name: "שמירת המתכון" }).click();
  await page.waitForURL(/#\/dish\/my-/);
  assert.match(await text(page, "h1"), /Tomato soup/);
  assert.equal(await page.locator(".chip-tm").count(), 2);
  assert.match(await text(page, ".notice.compact"), /אין מחירים/);
  assert.equal(await page.locator("ol p[dir='auto']").count(), 2);

  const kept = await page.evaluate(() => localStorage.getItem("fb:v1"));
  assert.ok(kept.includes(BRIDGE_TOKEN) && kept.includes(E2E_SESSION), "token and login session are kept in this browser");
  assert.ok(!kept.includes(E2E_LOGIN.password), "the password never is");

  // the backup file leaves out the token and the login; logging out forgets the session
  await open("#/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "גיבוי לקובץ" }).click();
  const file = fs.readFileSync(await (await download).path(), "utf8");
  assert.ok(!file.includes(BRIDGE_TOKEN) && !file.includes(E2E_SESSION) && !file.includes(E2E_LOGIN.email), "backup is free of secrets");
  await page.locator('[data-fk="ck-logout"]').click();
  await page.waitForSelector('[data-fk="ck-login"]');
  assert.ok(!(await page.evaluate(() => localStorage.getItem("fb:v1"))).includes(E2E_SESSION));
});

await step("prices: override a price, compare and persistence", async (page) => {
  await go(page, "#/prices");
  const cell = page.locator('[data-fk="cell-onion:ramilevy"]');
  await cell.click();
  const input = page.locator('[data-fk="edit-onion:ramilevy"]');
  await input.fill("1.5");
  await input.press("Enter");
  await page.waitForSelector('td.mine');
  await page.reload();
  assert.match(await text(page, 'td.mine'), /1\.50/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("fb:v1")).priceOverrides);
  assert.deepEqual(saved, { onion: { ramilevy: 1.5 } });
});

await step("pantry: marking an ingredient removes it from the list", async (page) => {
  await go(page, "#/cook");
  await addDish(page, "shakshuka");
  await go(page, "#/list");
  await page.waitForSelector("section.card .shop-item"); // `go` returns on the first child of #main, which can still be a placeholder
  const before = await page.locator("section.card .shop-item").count();
  await go(page, "#/pantry");
  await page.locator('[data-fk="p-eggs"]').click();
  await go(page, "#/list");
  await page.waitForSelector("section.card .shop-item");
  assert.equal(await page.locator("section.card .shop-item .what", { hasText: /^ביצים$/ }).count(), 0);
  assert.ok((await page.locator("section.card .shop-item").count()) < before);
});

await step("planner: auto plan fills the week and a basket pill appears", async (page) => {
  await go(page, "#/plan");
  await page.getByRole("button", { name: /תכנון אוטומטי/ }).click();
  await page.getByRole("button", { name: /הציעו לי/ }).click();
  await page.waitForSelector(".plan-item");
  assert.equal(await page.locator(".plan-item").count(), 5);
  assert.match(await text(page, "#basket-pill"), /5 מתכונים/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "ייצוא ליומן" }).click()]);
  const ics = fs.readFileSync(await dl.path(), "utf8");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
});

await step("tonight: suggestion respects the time limit, shuffle gives another", async (page) => {
  await go(page, "#/surprise");
  await page.getByRole("button", { name: "עד 40 דק׳" }).click();
  await page.waitForSelector(".card h2");
  const mins = async () => {
    const t = await page.locator(".card .chips .chip", { hasText: "דק׳" }).first().innerText();
    const h = /שעה/.test(t) ? 60 : 0;
    return h || Number(t.match(/\d+/)[0]);
  };
  assert.ok((await mins()) <= 40);
  const first = await text(page, ".card h2");
  let different = false;
  for (let i = 0; i < 6 && !different; i++) {
    await page.getByRole("button", { name: "עוד הצעה" }).click();
    // the re-render is async and the pick is random: wait briefly for a different dish rather than a fixed time
    different = await page.waitForFunction((f) => document.querySelector(".card h2")?.textContent !== f, first, { timeout: 500 }).then(() => true, () => false);
    assert.ok((await mins()) <= 40);
  }
  assert.ok(different, "a new suggestion appears");
});

await step("settings: dark theme, big text, export and kosher default", async (page) => {
  await go(page, "#/settings");
  await page.getByLabel("כהה").check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.getByLabel("גדול מאוד").check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.text), "130");
  await page.getByLabel("חלבי").check();
  await go(page, "#/cook");
  assert.match(page.url(), /k=dairy/);
  const kinds = await page.locator(".dcard .chip").allInnerTexts();
  assert.ok(!kinds.includes("בשרי"));
  await go(page, "#/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "גיבוי לקובץ" }).click()]);
  const file = await download.path();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.app, "food-buttons");
  assert.equal(data.data.settings.theme, "dark");
});

await step("offline: service worker serves the app without a network", async (page, ctx) => {
  await go(page, "#/cook");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => (await caches.keys()).length > 0);
  await page.reload();
  await ctx.setOffline(true);
  await page.goto(BASE + "#/dish/shakshuka");
  await page.reload();
  await page.waitForSelector("h1");
  assert.match(await text(page, "h1"), /שקשוקה/);
  await ctx.setOffline(false);
});

await step("desktop layout: header nav replaces the tab bar", async (page) => {
  await go(page, "#/cook");
  assert.equal(await page.locator("#tabbar").isVisible(), false);
  assert.equal(await page.locator("#nav-top").isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}, { width: 1280, height: 800 });

// ---------------------------------------------------------------- no horizontal overflow on any route, phone width
const ROUTES = ["", "#/cook", "#/dish/chicken-soup", "#/compare", "#/list", "#/cook/shakshuka", "#/order", "#/plan", "#/pantry", "#/prices", "#/branches", "#/import", "#/settings", "#/about", "#/more", "#/surprise"];
const seedBasket = (page) =>
  page.addInitScript(() => {
    if (!localStorage.getItem("fb:v1")) localStorage.setItem("fb:v1", JSON.stringify({ v: 1, basket: [{ id: "b1", dishId: "chicken-soup", servings: 6 }, { id: "b2", dishId: "shakshuka", servings: 4, day: 1, slot: "dinner" }] }));
  });
await step("no horizontal scrolling on any page at 320px", async (page) => {
  for (const r of ROUTES) {
    await go(page, r);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 320, `${r || "home"} is ${w}px wide`);
  }
}, { width: 320, height: 640, setup: seedBasket });

// ---------------------------------------------------------------- accessibility sweep
const axePath = findAxe();
if (!axePath) console.log("  skip accessibility sweep (axe-core not found; set AXE_CORE=/path/to/axe.min.js)");
else {
  const axeSrc = fs.readFileSync(axePath, "utf8");
  for (const scheme of ["light", "dark"]) {
    await step(`accessibility (axe, ${scheme}): no serious or critical violations`, async (page) => {
      const bad = [];
      for (const r of ROUTES) {
        await go(page, r);
        await page.waitForTimeout(150);
        await page.evaluate(axeSrc); // via CDP, so the page's CSP does not block it
        const res = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
        for (const v of res.violations.filter((x) => ["serious", "critical"].includes(x.impact))) bad.push(`${r || "home"}: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(" ")}`);
      }
      assert.deepEqual(bad, []);
    }, { setup: async (page) => { await seedBasket(page); await page.emulateMedia({ colorScheme: scheme }); } });
  }
}

await browser.close();
server.close();
linkedServer.close();
bridgeStub.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

