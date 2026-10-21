// End-to-end checks in a real browser (Chromium via Playwright).
//   npm run e2e
// Needs `playwright` (global or local) and a Chromium. Set CHROMIUM_PATH if it is not found automatically.
// Optional: axe-core for the accessibility sweep (AXE_CORE=/path/to/axe.min.js, or install axe-core).

import assert from "node:assert/strict";
import fs from "node:fs";
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
  const names = await page.locator(".dcard h3").allInnerTexts();
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
  const verdict = await text(page, ".verdict");
  assert.match(verdict, /בישול עצמי/);
  assert.match(verdict, /הזמנה/);
  assert.match(await text(page, ".dish-hero"), /קק״ל/);
  await page.locator('[data-fk="note-chicken-soup"]').fill("פחות מלח");
  await page.locator('[data-fk="note-chicken-soup"]').press("Tab");
  await page.reload();
  assert.equal(await page.locator('[data-fk="note-chicken-soup"]').inputValue(), "פחות מלח");
});

await step("basket and compare: totals, stores, delivery toggle", async (page) => {
  await go(page, "#/cook");
  for (const id of ["chicken-soup", "pasta-pomodoro", "shakshuka"]) await addDish(page, id);
  assert.match(await text(page, "#basket-pill"), /3 מתכונים/);
  await go(page, "#/compare");
  assert.equal(await page.locator(".basket-row").count(), 3);
  assert.ok((await page.locator('ul.rows[aria-label="עלות הסל לפי חנות"] > li').count()) >= 4);
  assert.match(await text(page, ".verdict-msg"), /בישול חוסך/);
  const before = await text(page, 'ul.rows[aria-label="עלות הסל לפי חנות"] > li.best .amt');
  await page.locator("summary", { hasText: "התאמות לחישוב" }).click();
  await page.locator('[data-fk="delivery"]').check();
  await page.waitForFunction((b) => document.querySelector('ul.rows[aria-label="עלות הסל לפי חנות"] > li.best .amt')?.innerText !== b, before);
  // pantry-aware: marking everything at home empties the shopping bill
  await go(page, "#/list");
  assert.ok((await page.locator(".shop-item").count()) > 5);
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
  assert.ok(saved[0].saved > 50);
  await go(page, "#/");
  assert.match(await text(page, ".home-foot"), /חסכתם החודש/);
});

await step("Sharon order: cart total, WhatsApp link with number and text", async (page) => {
  await go(page, "#/order");
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.waitForSelector("#cart-h");
  assert.match(await text(page, "#cart-h"), /2 מנות/);
  await page.locator("#order-phone").fill("050-123-4567");
  await page.locator("#order-phone").press("Tab");
  const link = page.getByRole("link", { name: /שליחה לשרון/ });
  await link.waitFor();
  const href = await link.getAttribute("href");
  assert.match(href, /^https:\/\/wa\.me\/972501234567\?text=/);
  assert.match(decodeURIComponent(href), /2 × מרק עוף של שישי/);
  assert.match(decodeURIComponent(href), /64 ₪/);
  // edit mode: change a price and see it reflected
  await page.getByRole("button", { name: "עריכת מחירון" }).click();
  const input = page.locator('[aria-label="מחיר למנה: מרק עוף של שישי"]');
  await input.fill("40");
  await input.press("Tab");
  await page.getByRole("button", { name: "סיום עריכה" }).click();
  await page.waitForSelector("#cart-h");
  assert.match(await text(page, ".price"), /40/);
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
  await page.getByRole("button", { name: /הוסף מנות של מרק עוף/ }).click();
  await page.waitForSelector("#cart-h");
  // 32 x 1.3 = 41.60 + 20 delivery
  assert.match(await text(page, "section[aria-labelledby=cart-h]"), /61\.60/);
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
  assert.match(await text(page, ".verdict"), /בישול עצמי/);
  assert.equal(await page.locator(".chip-tm").count(), 2);
  await go(page, "#/cook");
  assert.match((await page.locator(".dcard h3").allInnerTexts()).join("|"), /פסטה בשמנת/);
  await go(page, "#/cook");
  await page.locator('.dcard a.dcard-link[href^="#/dish/my-"]').click();
  await page.getByRole("link", { name: "עריכה" }).click();
  await page.waitForSelector("form");
  assert.equal(await page.locator('input[type="number"]').first().inputValue(), "4");
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
  const before = await page.locator(".shop-item").count();
  await go(page, "#/pantry");
  await page.locator('[data-fk="p-eggs"]').click();
  await go(page, "#/list");
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
const ROUTES = ["", "#/cook", "#/dish/chicken-soup", "#/compare", "#/list", "#/cook/shakshuka", "#/order", "#/plan", "#/pantry", "#/prices", "#/import", "#/settings", "#/about", "#/more", "#/surprise"];
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
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

