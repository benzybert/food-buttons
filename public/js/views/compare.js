import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings, report, actions, stores as storeList, pantrySet } from "../app.js";
import { replaceQuery, render } from "../router.js";
import { pageHead, moneyEl, stepper, emptyState, sampleBanner, toast, dishInfo, addWithToast } from "../ui.js";
import { suggestAdditions } from "../lib/calc.js";
import { percent, money, signedMoney, countOf, recipesWord, servingsWord } from "../fmt.js";
import { formatQty } from "../lib/units.js";


const DEMO = [["chicken-soup", 6], ["pasta-pomodoro", 4], ["shakshuka", 4]];

export function compareView({ query }) {
  const c = catalog();
  const s = store.get();
  const set = settings();
  const items = s.basket;

  const shared = parseShared(query.get("b"), c);
  const sharedCard = shared.length
    ? h(
        "div.notice",
        icon("share", { size: 22 }),
        h(
          "div",
          h("p", `שיתפו איתכם סל של ${recipesWord(shared.length)}: ${shared.map((x) => c.recById.get(x.dishId).name).join(", ")}`),
          h("div.row", { style: { "margin-top": "0.5rem" } }, h("button.btn.btn-sm.btn-green", { type: "button", onclick: () => (shared.forEach((x) => actions.addToBasket(x.dishId, x.servings)), replaceQuery({})) }, "הוספה לסל"), h("button.btn.btn-sm.btn-ghost", { type: "button", onclick: () => (replaceQuery({}), render(true)) }, "התעלמות")),
        ),
      )
    : null;

  if (!items.length) {
    return {
      title: "השוואת מחירים",
      el: h(
        "div.page",
        pageHead("השוואת מחירים", "בישול מול הזמנה, ובאיזו חנות הכי זול לקנות"),
        sharedCard,
        emptyState(
          "🛒",
          "הסל ריק",
          "הוסיפו מתכונים לסל כדי לראות כמה עולה לבשל אותם, כמה עולה להזמין אותם, ובאיזו חנות כדאי לקנות.",
          h("a.btn", { href: "#/cook" }, icon("book", { size: 20 }), "לבחירת מתכונים"),
          h("button.btn.btn-ghost", { type: "button", onclick: () => DEMO.forEach(([id, n]) => c.recById.has(id) && actions.addToBasket(id, n)) }, "נסו עם 3 מתכונים לדוגמה"),
        ),
        sampleBanner(),
      ),
    };
  }

  const rep = report();
  const st = storeList();
  const best = rep.bestStore;
  const order = rep.bestOrder;
  const cook = rep.cookTotal;
  const savingKnown = rep.saving != null;
  const cookWins = savingKnown && rep.saving >= 0;

  // ------------------------------------------------ basket card
  const basketRows = items.map((b) => {
    const rec = c.recById.get(b.dishId);
    if (!rec) return null;
    const info = dishInfo(b.dishId, b.servings);
    return h(
      "div.basket-row",
      h("span.emoji", { "aria-hidden": "true" }, rec.emoji),
      h("a.nm", { href: `#/dish/${rec.id}?s=${b.servings}` }, rec.name, b.day != null ? h("span.chip", { style: { "margin-inline-start": "0.5rem" } }, `יום ${["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"][b.day]}`) : null),
      h("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", "aria-label": `הסר את ${rec.name} מהסל`, onclick: () => actions.removeFromBasket(b.id) }, icon("trash", { size: 18 })),
      stepper({ value: b.servings, label: `מנות של ${rec.name}`, size: "sm", onChange: (n) => actions.setServings(b.id, n) }),
      h("span.small.muted.cost", "בישול ", moneyEl(info.cmp.cook.ingredients), info.cmp.order ? [" · הזמנה ", moneyEl(info.cmp.order.total)] : null),
    );
  });
  const basketCard = h(
    "section.card",
    { "aria-labelledby": "basket-h" },
    h("div.spread", h("h2", { id: "basket-h" }, `הסל שלכם (${items.length})`), h("div.row", h("a.btn.btn-ghost.btn-sm", { href: "#/cook" }, icon("plus", { size: 16 }), "עוד מנות"), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: shareBasket }, icon("share", { size: 16 }), "שיתוף"), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: clearBasket }, icon("trash", { size: 16 }), "ניקוי"))),
    basketRows,
  );

  // ------------------------------------------------ verdict
  const verdict = h(
    "section.card",
    { "aria-labelledby": "verdict-h" },
    h("h2", { id: "verdict-h", style: { "margin-block-end": "0.75rem" } }, "בישול מול הזמנה"),
    h(
      "div.verdict",
      h(
        "div.side",
        { class: cookWins ? "win" : "" },
        h("span.label", "בישול וקנייה בחנות"),
        h("span.big-num", moneyEl(cook)),
        h("span.sub", best.store.name, rep.timeTotal ? [" · כולל ", moneyEl(rep.timeTotal), " שווי זמן"] : null),
        h("span.sub", "נשארים לכם מצרכים בשווי ", moneyEl(best.leftover)),
      ),
      order
        ? h(
            "div.side",
            { class: savingKnown && !cookWins ? "win" : "" },
            h("span.label", `הזמנת הכול · ${order.source.name}`),
            h("span.big-num", moneyEl(order.total)),
            h("span.sub", order.fee ? ["כולל ", moneyEl(order.fee), " משלוח"] : "ללא דמי משלוח"),
          )
        : h("div.side", h("span.label", "הזמנה"), h("span.big-num", "-"), h("span.sub", "חסר מחיר הזמנה")),
    ),
    savingKnown
      ? h("p.verdict-msg", { style: { color: cookWins ? "var(--good)" : "var(--bad)" } }, cookWins ? ["בישול חוסך ", moneyEl(rep.saving), ` (${percent(rep.saving / order.total)})`] : ["ההזמנה זולה ב-", moneyEl(-rep.saving)])
      : null,
    rep.custom.length ? h("p.small.muted", `${rep.custom.length} מצרכים (למשל ${rep.custom[0].name}) אין להם מחיר ולכן לא נכללו בחישוב.`) : null,
    controls(set),
    set.budget > 0 ? budgetBar(set.budget, cook) : null,
  );

  // ------------------------------------------------ stores
  const cheapest = rep.ranked[0];
  const storesTable = h(
    "ul.rows",
    { "aria-label": "עלות הסל לפי חנות" },
    rep.ranked.map((r, i) =>
      h(
        "li",
        { class: i === 0 ? "best" : "" },
        h(
          "div.main",
          h("div.t", r.store.name, i === 0 ? h("span.chip.good", { style: { "margin-inline-start": "0.5rem" } }, "הזול ביותר") : null),
          h("div.s", [r.missingIds.length ? `לא מחזיקים ${countOf(r.missingIds.length, "פריט", "פריטים")} (באומדן)` : null, r.estimatedIds.length ? `${countOf(r.estimatedIds.length, "אומדן", "אומדנים")}` : null, set.delivery ? (r.delivery.fee ? `כולל משלוח ${money(r.delivery.fee)}` : "משלוח חינם") : null].filter(Boolean).join(" · ") || (i === 0 ? "" : `יקר יותר ב-${money(r.total - cheapest.total)}`)),
        ),
        h("div.amt", moneyEl(r.total), i > 0 && (r.missingIds.length || r.estimatedIds.length || set.delivery) ? h("small", signedMoney(r.total - cheapest.total)) : null),
        h("a.btn.btn-ghost.btn-sm", { href: "#/list", onclick: () => store.update((x) => void (x.settings.primaryStore = r.storeId)) }, "לרשימה"),
      ),
    ),
  );

  // ------------------------------------------------ smart splits
  const names = (ids) => ids.map((id) => c.storeById.get(id).name).join(" + ");
  const splitCards = [];
  const pair = rep.pair;
  if (pair && pair.total < cheapest.subtotal - 0.5 && !set.delivery) {
    splitCards.push(splitCard("שתי חנויות", names(pair.storeIds), pair.total, cheapest.subtotal - pair.total, "pair"));
  }
  if (rep.perItem.storeIds.length > 2 && rep.perItem.total < (pair ? Math.min(pair.total, cheapest.subtotal) : cheapest.subtotal) - 0.5 && !set.delivery) {
    splitCards.push(splitCard(`הכי זול לכל פריט (${rep.perItem.storeIds.length} חנויות)`, "קונים כל מצרך איפה שהוא הכי זול", rep.perItem.total, cheapest.subtotal - rep.perItem.total, "item"));
  }

  // ------------------------------------------------ cheap additions (reuse packs already bought)
  const additions = suggestAdditions(items.map((b) => ({ dishId: b.dishId, servings: b.servings })), c, { pantry: pantrySet(), stores: st, candidates: c.recipes.filter((r) => (set.kosher === "all" || r.kosher === set.kosher) && !set.avoid.some((a) => r.allergens.includes(a)) && set.diet.every((d) => r.diet.includes(d))) });
  const additionCards = additions.map((a) =>
    h("div.card.tight", h("div.row", h("span", { style: { "font-size": "1.8rem" }, "aria-hidden": "true" }, a.rec.emoji), h("a.strong", { href: `#/dish/${a.rec.id}`, style: { "text-decoration": "none" } }, a.rec.name)), h("p.small.muted", { style: { margin: "0.2rem 0 0.4rem" } }, "יתווסף לסל רק ", moneyEl(a.marginal), " (לבד: ", moneyEl(a.standalone), ")"), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => addWithToast(a.rec, a.servings) }, icon("plus", { size: 16 }), "הוספה לסל")),
  );

  // ------------------------------------------------ per-item table
  const perStoreCosts = new Map();
  for (const r of rep.ranked) for (const l of r.lines) if (l.kind !== "missing") (perStoreCosts.get(l.ingId) || perStoreCosts.set(l.ingId, []).get(l.ingId)).push({ cost: l.cost, storeId: r.storeId });
  const itemRows = [...rep.perItem.lines]
    .map((l) => {
      const ing = c.ingById.get(l.ingId);
      const costs = perStoreCosts.get(l.ingId) || [];
      const max = costs.length ? Math.max(...costs.map((x) => x.cost)) : l.cost;
      return { l, ing, spread: max - l.cost, max };
    })
    .sort((a, b) => b.spread - a.spread);
  const itemsTable = h(
    "ul.rows",
    { "aria-label": "הזול ביותר לכל מצרך" },
    itemRows.map(({ l, ing, max }) =>
      h("li", h("div.main", h("div.t", ing.name), h("div.s", `${buyText(ing, l)} · הכי זול ב${c.storeById.get(l.storeId).name}`)), h("div.amt", moneyEl(l.cost), max - l.cost > 0.05 ? h("small", "עד ", moneyEl(max)) : null)),
    ),
  );

  // ------------------------------------------------ order
  const ordersTable = h(
    "ul.rows",
    { "aria-label": "עלות הזמנת כל המנות" },
    rep.orders.map((o, i) => h("li", { class: i === 0 && !o.missing ? "best" : "" }, h("div.main", h("div.t", o.source.name), h("div.s", o.missing ? `חסר מחיר ל-${o.missing} מנות` : o.fee ? `כולל ${money(o.fee)} משלוח` : "ללא דמי משלוח")), h("div.amt", moneyEl(o.total)))),
  );

  // ------------------------------------------------ bars
  const max = Math.max(cook, ...rep.ranked.map((r) => r.total), ...rep.orders.map((o) => o.total), 1);
  const bars = h(
    "div.bars",
    { role: "img", "aria-label": "השוואת עלויות בגרף עמודות" },
    ...rep.ranked.slice(0, 4).map((r, i) => bar(`קנייה ב${r.store.name}`, r.total, max, i === 0 ? "best" : "")),
    ...rep.orders.map((o) => bar(`הזמנה: ${o.source.name}`, o.total, max, "order")),
  );

  const el = h(
    "div.page.wide",
    pageHead("השוואת מחירים", `${servingsWord(items.reduce((a, b) => a + b.servings, 0))} בסל · ${st.length} חנויות בהשוואה`),
    sharedCard,
    sampleBanner(),
    h(
      "div.grid.two",
      { style: { "margin-top": "1rem", "align-items": "start" } },
      h("div.stack", basketCard, h("section.card", h("h2", { style: { "margin-block-end": "0.75rem" } }, "השוואה בגרף"), bars)),
      h("div.stack", verdict),
    ),
    h("h2.section", "באיזו חנות לקנות?"),
    storesTable,
    h("p.small.muted", "הסכום הוא עלות קניית אריזות שלמות בפועל, בניכוי מה שיש לכם בבית (", h("a", { href: "#/pantry" }, "מזווה"), "). חנות שחסר בה פריט מופיעה אחרי החנויות המלאות, והפריט החסר מחושב באומדן."),
    splitCards.length ? [h("h2.section", "אפשר לחסוך עוד"), h("div.grid.two", splitCards)] : null,
    additionCards.length ? [h("h2.section", "כמעט בחינם: מנות שמנצלות אריזות שכבר קונים"), h("div.grid", additionCards)] : null,
    h("h2.section", "הכי זול לכל מצרך"),
    itemsTable,
    h("h2.section", "אם מזמינים הכול"),
    ordersTable,
    h("p.small.muted", "מחירי ההזמנה ניתנים לעריכה במסך ", h("a", { href: "#/order" }, "שרון"), "."),
    h("div.row.no-print", { style: { "margin-top": "1.5rem" } }, h("a.btn", { href: "#/list" }, icon("list", { size: 20 }), "לרשימת הקניות"), h("a.btn.btn-ghost", { href: "#/prices" }, icon("tag", { size: 20 }), "עדכון מחירים")),
  );
  return { el, title: "השוואת מחירים" };

  // ------------------------------------------------ local helpers
  function splitCard(title, sub, total, saving, mode) {
    return h("div.card", h("h3", title), h("p.muted", { style: { margin: "0.2rem 0" } }, sub), h("p", h("span.big-num", { style: { "font-size": "1.8rem", "font-weight": "700" } }, moneyEl(total)), " ", h("span.chip.good", "חיסכון ", moneyEl(saving))), h("a.btn.btn-sm", { href: `#/list?split=${mode}` }, "הרשימה לפי חנות"));
  }
}

function controls(set) {
  const hourly = h("input.input.num-in", { type: "number", min: "0", step: "5", inputmode: "numeric", value: String(set.hourly || 0), "aria-label": "שווי שעת עבודה בשקלים", "data-fk": "hourly", onchange: (e) => store.update((s) => void (s.settings.hourly = Math.max(0, Number(e.target.value) || 0))) });
  const budget = h("input.input.num-in", { type: "number", min: "0", step: "50", inputmode: "numeric", value: String(set.budget || 0), "aria-label": "תקציב בשקלים", "data-fk": "budget", onchange: (e) => store.update((s) => void (s.settings.budget = Math.max(0, Number(e.target.value) || 0))) });
  return h(
    "details",
    { style: { "margin-top": "0.75rem" } },
    h("summary", { style: { cursor: "pointer", "font-weight": "700", "min-height": "2.75rem", display: "flex", "align-items": "center" } }, "התאמות לחישוב"),
    h(
      "div.stack",
      h("label.check", h("input", { type: "checkbox", checked: set.delivery, "data-fk": "delivery", onchange: (e) => store.update((s) => void (s.settings.delivery = e.target.checked)) }), "קנייה במשלוח (כולל דמי משלוח לפי חנות)"),
      h("div.row", h("label", { for: "hourly-in" }, "שווי שעת עבודה שלי (₪):"), Object.assign(hourly, { id: "hourly-in" }), h("span.small.muted", "מוסיף לעלות הבישול את זמן העבודה")),
      h("div.row", h("label", { for: "budget-in" }, "תקציב לסל (₪):"), Object.assign(budget, { id: "budget-in" }), h("span.small.muted", "0 = ללא")),
    ),
  );
}

function budgetBar(budget, cook) {
  const pct = Math.min(100, (cook / budget) * 100);
  const over = cook > budget;
  return h("div", { style: { "margin-top": "0.75rem" } }, h("div.spread", h("span.small.strong", "מתוך התקציב"), h("span.small", over ? ["חריגה של ", moneyEl(cook - budget)] : ["נשארו ", moneyEl(budget - cook)])), h("div.progress-track", { class: over ? "over" : "", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(budget), "aria-valuenow": String(Math.round(cook)) }, h("span", { style: { "--w": String(pct) } })));
}

function bar(label, value, max, kind) {
  return h("div.bar-row", { class: kind }, h("span.small", label), h("span.track", h("span.fill", { style: { "--w": String(Math.max(2, (value / max) * 100)) } })), h("span.v", moneyEl(value)));
}

function buyText(ing, l) {
  const unit = ing.base === "u" ? "u" : ing.base;
  const size = `${formatQty(ing.pack.size, unit)}${ing.base === "u" ? " יח׳" : ""}`;
  if (ing.pack.type === "loose") return `${formatQty(l.bought, unit)}${ing.base === "u" ? " יח׳" : ""}`;
  const n = Math.round(l.packs);
  return n === 1 ? `אריזה (${size})` : `${n} אריזות (${size})`;
}
export { buyText };

function shareBasket() {
  const b = store.get().basket.map((x) => `${x.dishId}:${x.servings}`).join(",");
  const url = `${location.origin}${location.pathname}#/compare?b=${b}`;
  const done = () => toast("הקישור לסל הועתק");
  if (navigator.share) navigator.share({ title: "סל מנות", url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => toast(url));
  else toast(url);
}

function clearBasket() {
  if (confirm("לנקות את כל הסל?")) actions.clearBasket();
}

function parseShared(param, c) {
  if (!param) return [];
  return param
    .split(",")
    .map((p) => p.split(":"))
    .map(([id, n]) => ({ dishId: id, servings: Math.min(99, Math.max(1, Number(n) || 4)) }))
    .filter((x) => c.recById.has(x.dishId))
    .slice(0, 30);
}
