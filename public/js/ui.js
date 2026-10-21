// Shared UI building blocks.

import { h, $ } from "./dom.js";
import { icon } from "./icons.js";
import { money, percent, duration, settingParts } from "./fmt.js";
import { KOSHER_LABELS } from "./lib/derive.js";
import { CATEGORY_LABELS } from "./lib/catalog.js";
import { actions, catalog, settings, stores as enabledStoreList, sourcesFor } from "./app.js";
import { store } from "./store.js";
import { compareDish, dishCostByStore } from "./lib/calc.js";
import { splitBySettings } from "./lib/parse.js";

export const moneyEl = (n, cls = "") => h("bdi", { class: `money ${cls}`.trim() }, money(n));

export function pageHead(title, sub, ...actionsEls) {
  return h(
    "div.page-head",
    h("div", h("h1", title), sub ? h("p", sub) : null),
    actionsEls.length ? h("div.row", ...actionsEls) : null,
  );
}

export function notice(kind, text, ico = kind === "warn" ? "alert" : kind === "good" ? "check" : "info", ...extra) {
  return h("div.notice", { class: kind === "info" ? "" : kind, role: kind === "bad" ? "alert" : undefined }, icon(ico, { size: 22 }), h("div", h("p", text), ...extra));
}

/** Banner shown while prices are the bundled sample set. */
export function sampleBanner() {
  const { meta } = catalog().prices;
  if (meta.kind !== "sample") return null;
  const hasMine = Object.keys(store.get().priceOverrides).length > 0;
  return h(
    "div.notice.warn.compact",
    { role: "note" },
    icon("alert", { size: 20 }),
    h(
      "p",
      hasMine ? "רוב המחירים הם נתוני דוגמה (המחירים שהזנתם מסומנים בקו כחול). " : "מחירי דוגמה להמחשה, לא מחירון אמיתי. ",
      h("a", { href: "#/prices" }, "עדכון מחירים"),
      " · ",
      h("a", { href: "#/about" }, "על הנתונים"),
    ),
  );
}

export function emptyState(art, title, text, ...btns) {
  return h("div.empty", h("div.art", { "aria-hidden": "true" }, art), h("h2", title), text ? h("p", text) : null, btns.length ? h("div.row", { style: { "justify-content": "center", "margin-top": "1rem" } }, ...btns) : null);
}

export function stepper({ value, min = 1, max = 99, onChange, label, size = "" }) {
  const out = h("output", { "aria-live": "polite" }, String(value));
  const dec = h("button", { type: "button", "aria-label": `הפחת ${label || ""}`.trim(), disabled: value <= min, onclick: () => onChange(value - 1) }, icon("minus", { size: 20 }));
  const inc = h("button", { type: "button", "aria-label": `הוסף ${label || ""}`.trim(), disabled: value >= max, onclick: () => onChange(value + 1) }, icon("plus", { size: 20 }));
  return h("div.stepper", { class: size, role: "group", "aria-label": label || "כמות" }, inc, out, dec);
}

export function kosherChip(rec) {
  const k = rec.kosher;
  return h("span.chip", { class: k === "meat" ? "bad" : k === "dairy" ? "info" : "good" }, KOSHER_LABELS[k] || k);
}

export function settingChips(settings) {
  return (settings || []).map((s) => {
    const parts = settingParts(s);
    const kids = [];
    parts.forEach((p, i) => {
      if (i) kids.push(h("i", { "aria-hidden": "true" }, "/"));
      kids.push(h("bdi", p));
    });
    return h("span.chip.chip-tm", { "aria-label": parts.join(", ") }, kids);
  });
}

/** Step text with the machine-setting groups highlighted and bidi-isolated. */
export function stepText(text) {
  return splitBySettings(text).map((p) => (p.setting ? h("bdi.tm-inline", p.text) : p.text));
}

let toastTimer;
export function toast(message, action) {
  const host = $("#toast");
  clearTimeout(toastTimer);
  host.replaceChildren(
    h(
      "div",
      h("span", message),
      action ? h(action.href ? "a" : "button", { type: action.href ? undefined : "button", href: action.href, onclick: () => (action.onClick?.(), host.replaceChildren()) }, action.label) : null,
    ),
  );
  toastTimer = setTimeout(() => host.replaceChildren(), action ? 6000 : 2800);
}

/** Native <dialog>. Returns { dialog, close }. Content is a node or array; closes on backdrop click / Esc. */
export function openDialog(title, content, { onClose } = {}) {
  const dlg = h(
    "dialog.dialog",
    { "aria-labelledby": "dlg-title" },
    h("div.dialog-head", h("h2", { id: "dlg-title" }, title), h("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", "aria-label": "סגירה", onclick: () => dlg.close() }, icon("x", { size: 20 }))),
    h("div.dialog-body", content),
  );
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { dialog: dlg, close: () => dlg.close() };
}

// ------------------------------------------------------------------ dish summaries (memoised)

let sumKey = "";
let sums = new Map();

/** Cheapest cook cost vs cheapest order price for a dish at its default servings. */
export function dishInfo(dishId, servings) {
  const c = catalog();
  const st = enabledStoreList();
  const key = JSON.stringify([st.map((s) => s.id), store.get().priceOverrides, store.get().orderPrices, store.get().orderOff, c.recipes.length]);
  if (key !== sumKey) {
    sumKey = key;
    sums = new Map();
  }
  const rec = c.recById.get(dishId);
  const n = servings || rec.servings;
  const k = `${dishId}:${n}`;
  if (!sums.has(k)) {
    const cmp = compareDish(rec, n, c, {
      sources: sourcesFor(dishId),
      orderPrice: (d, s) => c.orderPrice(d, s),
      hourly: 0,
      stores: st,
    });
    const perServing = cmp.cook.perServing;
    const orderUnit = cmp.order ? Math.min(...cmp.options.filter((o) => o.unit != null).map((o) => o.unit)) : null;
    sums.set(k, { cmp, perServing, orderUnit, savePct: orderUnit ? (orderUnit - perServing) / orderUnit : null, storeId: cmp.cook.storeId });
  }
  return sums.get(k);
}

export function dishCard(rec) {
  const info = dishInfo(rec.id);
  const s = settings();
  const isFav = store.get().favorites.includes(rec.id);
  const total = rec.time?.total ?? rec.prep + rec.cook;
  return h(
    "article.dcard",
    { class: `cat-${rec.category}` },
    h(
      "a.dcard-link",
      { href: `#/dish/${rec.id}` },
      h("div.dcard-art", { "aria-hidden": "true" }, rec.emoji),
      h(
        "div.dcard-body",
        h("h2", rec.name),
        h(
          "div.meta",
          h("span", icon("clock", { size: 16 }), duration(total)),
          h("span", icon("users", { size: 16 }), `${rec.servings} מנות`),
          rec.kcal ? h("span", `≈${rec.kcal} קק״ל`) : null,
          kosherChip(rec),
          rec.src === "custom" ? h("span.chip.info", "שלי") : null,
        ),
        h(
          "div.dcard-price",
          h("span.cook", moneyEl(info.perServing), h("span.small.muted", " למנה")),
          info.orderUnit != null
            ? h("span.vs", "הזמנה ", moneyEl(info.orderUnit), info.savePct > 0.03 ? h("span.chip.good", { style: { "margin-inline-start": "0.4rem" } }, `חיסכון ${percent(info.savePct)}`) : info.savePct < -0.03 ? h("span.chip.bad", { style: { "margin-inline-start": "0.4rem" } }, "הזמנה זולה יותר") : null)
            : h("span.vs", "אין מחיר הזמנה"),
        ),
      ),
    ),
    h("button.fav", { type: "button", "aria-pressed": String(isFav), "aria-label": isFav ? `הסר את ${rec.name} ממועדפים` : `הוסף את ${rec.name} למועדפים`, "data-fk": `fav-${rec.id}`, onclick: () => actions.toggleFavorite(rec.id) }, icon("heart", { size: 22 })),
    h(
      "div.dcard-actions",
      h("button.btn.btn-green.btn-sm", { type: "button", "data-fk": `add-${rec.id}`, onclick: () => addWithToast(rec) }, icon("plus", { size: 18 }), `לסל (${s.household})`),
    ),
  );
}

export function addWithToast(rec, servings) {
  const n = servings || settings().household;
  actions.addToBasket(rec.id, n);
  toast(`${rec.name} נוסף לסל`, { label: "לסל", href: "#/compare" });
}

/** Cost of a dish at the user's enabled stores, cheapest first (for the dish page table). */
export function storeCostRows(rec, servings) {
  return dishCostByStore(rec, servings, catalog(), enabledStoreList());
}

export { CATEGORY_LABELS };

// ------------------------------------------------------------------ ingredient display

import { scaleQty, formatQty, formatNumber } from "./lib/units.js";

const SING = { שיני: "שן", שינים: "שן", גבעולי: "גבעול", גבעולים: "גבעול", פרוסות: "פרוסה", ענפים: "ענף", קופסאות: "קופסה", שקיות: "שקית", צרורות: "צרור", מקלות: "מקל" };
const PLUR = { שן: "שיני", גבעול: "גבעולי", פרוסה: "פרוסות", ענף: "ענפים", קופסה: "קופסאות", שקית: "שקיות", צרור: "צרורות", מקל: "מקלות" };

/** { q: "3 שיני", n: "שום" } - quantity column and name column of an ingredient line, scaled by `factor`. */
export function ingredientText(line, name, factor = 1) {
  if (line.unit === "pinch") return { q: "קורט", n: name };
  const { qty, unit } = scaleQty(line.qty, line.unit, factor);
  if (unit === "u") {
    const one = qty < 1.05;
    let word = line.unitWord;
    if (word) word = one ? SING[word] || word : PLUR[word] || word;
    return { q: `${formatNumber(qty)} ${word || "יח׳"}`, n: name };
  }
  return { q: formatQty(qty, unit), n: name };
}
