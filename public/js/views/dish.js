import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings, stores as storeList, pantrySet, actions, sourcesFor } from "../app.js";
import { replaceQuery, render } from "../router.js";
import { moneyEl, stepper, kosherChip, settingChips, stepText, sampleBanner, addWithToast, ingredientText, toast } from "../ui.js";
import { duration, percent } from "../fmt.js";
import { compareDish, dishLines } from "../lib/calc.js";
import { ALLERGEN_LABELS, DIET_LABELS, EQUIPMENT_LABELS } from "../lib/derive.js";
import { CATEGORY_LABELS } from "../lib/catalog.js";

export function dishView({ match, query }) {
  const c = catalog();
  const rec = c.recById.get(match[1]);
  if (!rec) {
    return {
      title: "מתכון לא נמצא",
      el: h("div.page", h("h1", "המתכון לא נמצא"), h("p", "ייתכן שהמתכון נמחק."), h("a.btn", { href: "#/cook" }, "חזרה למתכונים")),
    };
  }
  const servings = Math.min(99, Math.max(1, Number(query.get("s")) || rec.servings));
  const factor = servings / rec.servings;
  const st = storeList();
  const hourly = settings().hourly;
  const have = pantrySet();
  const isFav = store.get().favorites.includes(rec.id);

  const cmp = compareDish(rec, servings, c, {
    sources: sourcesFor(rec.id),
    orderPrice: (d, s) => c.orderPrice(d, s),
    hourly,
    stores: st,
  });
  const cheapestStore = c.storeById.get(cmp.cook.storeId);
  const lines = dishLines(rec, servings, cheapestStore, c);

  const setServings = (n) => {
    replaceQuery({ s: n === rec.servings ? "" : n });
    render(true);
  };

  // ---- hero
  const chips = [
    h("span.chip", icon("clock", { size: 14 }), duration(rec.time.total)),
    rec.time.prep ? h("span.chip", `עבודה ${duration(rec.time.prep)}`) : null,
    kosherChip(rec),
    ...rec.diet.map((d) => h("span.chip.good", DIET_LABELS[d])),
    h("span.chip", CATEGORY_LABELS[rec.category]),
    rec.level === 3 ? h("span.chip", "מורכב") : rec.level === 2 ? h("span.chip", "בינוני") : h("span.chip", "קל"),
  ];
  const hero = h(
    "div.dish-hero",
    { class: `cat-${rec.category}` },
    h("div.art", { "aria-hidden": "true" }, rec.emoji),
    h("div.grow", h("h1", rec.name), rec.description ? h("p.muted", { style: { margin: "0.25rem 0 0.5rem" } }, rec.description) : null, h("div.chips", chips)),
  );

  // ---- compare card
  const cookSide = h(
    "div.side",
    { class: cmp.winner === "cook" && cmp.order ? "win" : "" },
    h("span.label", "בישול עצמי"),
    h("span.big-num", moneyEl(cmp.cook.total)),
    h("span.sub", moneyEl(cmp.cook.perServing), " למנה · ", cheapestStore.name),
    cmp.cook.time ? h("span.sub", "כולל ", moneyEl(cmp.cook.time), " שווי זמן") : null,
  );
  const orderSide = cmp.order
    ? h(
        "div.side",
        { class: cmp.winner === "order" ? "win" : "" },
        h("span.label", `הזמנה · ${cmp.order.source.name}`),
        h("span.big-num", moneyEl(cmp.order.total)),
        h("span.sub", moneyEl(cmp.order.unit), " למנה", cmp.order.fee ? [" + ", moneyEl(cmp.order.fee), " משלוח"] : null),
      )
    : h("div.side", h("span.label", "הזמנה"), h("span.big-num", "-"), h("span.sub", "אין מחיר הזמנה למנה הזו"));

  let message = null;
  if (cmp.order) {
    const abs = Math.abs(cmp.saving);
    message =
      cmp.winner === "cook"
        ? h("p.verdict-msg", { style: { color: "var(--good)" } }, "מבשלים וחוסכים ", moneyEl(abs), ` (${percent(Math.abs(cmp.pct))})`)
        : h("p.verdict-msg", { style: { color: "var(--bad)" } }, "במקרה הזה ההזמנה זולה ב-", moneyEl(abs), hourly ? " (כולל שווי הזמן שלכם)" : "");
  }

  const orderRows = cmp.options.map((o) =>
    h("tr", h("td", o.source.name), h("td.n", o.unit != null ? moneyEl(o.unit) : "-"), h("td.n", o.fee ? moneyEl(o.fee) : "-"), h("td.n", o.total != null ? moneyEl(o.total) : "-")),
  );
  const storeRows = cmp.byStore.map((r, i) =>
    h(
      "tr",
      { class: i === 0 ? "best" : "" },
      h("td", c.storeById.get(r.storeId).name, r.missing ? h("span.chip.warn", { style: { "margin-inline-start": "0.4rem" } }, `${r.missing} חסרים`) : null),
      h("td.n", moneyEl(r.total)),
      h("td.n", moneyEl(r.perServing)),
    ),
  );

  const comparePanel = h(
    "section.card",
    { "aria-labelledby": "cmp-h" },
    h("h2", { id: "cmp-h", style: { "margin-block-end": "0.75rem" } }, "בישול מול הזמנה"),
    h("div.verdict", cookSide, orderSide),
    message,
    h(
      "details",
      { style: { "margin-top": "0.75rem" } },
      h("summary", { style: { cursor: "pointer", "font-weight": "700", "min-height": "2.75rem", display: "flex", "align-items": "center" } }, "פירוט לפי חנות ואפשרויות הזמנה"),
      h("div.tbl-wrap", h("table.tbl", h("caption.sr-only", "עלות המנה לפי חנות"), h("thead", h("tr", h("th", "חנות"), h("th.n", "סה״כ"), h("th.n", "למנה"))), h("tbody", storeRows))),
      h("div.tbl-wrap", { style: { "margin-top": "0.75rem" } }, h("table.tbl", h("caption.sr-only", "אפשרויות הזמנה"), h("thead", h("tr", h("th", "הזמנה"), h("th.n", "למנה"), h("th.n", "משלוח"), h("th.n", "סה״כ"))), h("tbody", orderRows))),
      h("p.small.muted", "העלות היא רק על החלק שנצרך מכל מצרך. בקנייה בפועל קונים אריזות שלמות, ראו ", h("a", { href: "#/compare" }, "השוואת הסל"), "."),
    ),
  );

  // ---- ingredients
  const ingItems = lines.map(({ line, ing, cost, kind }) => {
    const name = ing ? ing.name : line.custom;
    const { q, n } = ingredientText(line, name, factor);
    const home = ing && have.has(ing.id);
    return h(
      "li",
      { class: home ? "have" : "" },
      h("span.q", q),
      h("span.n", n, line.note ? h("span.muted", ` · ${line.note}`) : null),
      cost != null && !ing.free ? h("span.c", { title: kind === "user" ? "מחיר שהוזן ידנית" : kind === "data" ? "" : "אומדן" }, moneyEl(cost)) : null,
      ing && !ing.free
        ? h("label.check", { title: "מסמן שהמצרך כבר קיים בבית (לא ייכנס לרשימת הקניות)" }, h("input", { type: "checkbox", checked: home, "data-fk": `have-${ing.id}`, "aria-label": `${ing.name} יש בבית`, onchange: (e) => actions.togglePantry(ing.id, e.target.checked) }), h("span.small", "בבית"))
        : null,
    );
  });

  const stepsList = rec.steps.map((s) => h("li", h("div", h("p", stepText(s.text)), s.settings?.length ? h("div.chips", settingChips(s.settings)) : null)));

  const allergens = rec.allergens.length ? h("p.small.muted", "מכיל: ", rec.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")) : null;
  const equipment = rec.equipment.length ? h("div.chips", rec.equipment.map((e) => h("span.chip.info", EQUIPMENT_LABELS[e]))) : null;

  const el = h(
    "div.page.wide",
    h("p", { style: { margin: "0 0 0.75rem" } }, h("a", { href: "#/cook" }, icon("arrow", { size: 16 }), " כל המתכונים")),
    hero,
    h(
      "div.row",
      { style: { margin: "1rem 0" } },
      stepper({ value: servings, label: "מנות", onChange: setServings }),
      h("span.muted", "מנות"),
      servings !== settings().household ? h("button.btn-link", { type: "button", onclick: () => setServings(settings().household) }, `התאמה ל-${settings().household}`) : null,
      h("span.grow"),
      h("button.btn.btn-green", { type: "button", onclick: () => addWithToast(rec, servings) }, icon("plus", { size: 20 }), "הוספה לסל"),
      h("a.btn", { href: `#/cook/${rec.id}?s=${servings}` }, icon("chef", { size: 20 }), "מצב בישול"),
      h("button.btn.btn-ghost.btn-icon", { type: "button", "aria-pressed": String(isFav), "aria-label": isFav ? "הסר ממועדפים" : "הוסף למועדפים", onclick: () => actions.toggleFavorite(rec.id) }, icon("heart", { size: 22, cls: isFav ? "filled" : "" })),
    ),
    h(
      "div.row.no-print",
      cmp.options.some((o) => o.source.id === "sharon" && o.unit != null) ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => orderFromSharon(rec, servings) }, icon("store", { size: 16 }), "הוספה להזמנה משרון") : null,
      h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => shareRecipe(rec, factor, c) }, icon("share", { size: 16 }), "שיתוף המתכון"),
      h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => window.print() }, icon("printer", { size: 16 }), "הדפסה"),
    ),
    sampleBanner(),
    h(
      "div.dish-cols",
      { style: { "margin-top": "1rem" } },
      h("div.stack.sticky", comparePanel, equipment, allergens, rec.src === "custom" ? h("div.row", h("a.btn.btn-ghost.btn-sm", { href: `#/import/${rec.id}` }, icon("pencil", { size: 16 }), "עריכה"), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => confirmDelete(rec) }, icon("trash", { size: 16 }), "מחיקה")) : null),
      h(
        "div.stack",
        h("section.card", { "aria-labelledby": "ing-h" }, h("h2", { id: "ing-h" }, "מצרכים"), h("ul.ing-list", ingItems), h("p.small.muted", "המחיר ליד כל מצרך הוא על הכמות הנצרכת ב", cheapestStore.name, ".")),
        h("section.card", { "aria-labelledby": "steps-h" }, h("h2", { id: "steps-h", style: { "margin-block-end": "0.75rem" } }, "אופן ההכנה"), h("ol.step-list", stepsList)),
        rec.src !== "custom" ? h("p.small.muted", "המתכון נכתב במיוחד לאפליקציה והוא מקורי. הגדרות המכשיר נכתבות בפורמט זמן/טמפרטורה/מהירות, ויש לוודא התאמה לדגם שלכם.") : null,
      ),
    ),
  );
  return { el, title: rec.name };
}

function confirmDelete(rec) {
  if (confirm(`למחוק את "${rec.name}"?`)) {
    actions.deleteCustomRecipe(rec.id);
    location.hash = "#/cook";
  }
}

function orderFromSharon(rec, servings) {
  store.update((s) => void (s.orderCart[rec.id] = Math.min(30, (s.orderCart[rec.id] || 0) + servings)));
  toast(`${rec.name} נוסף להזמנה משרון`, { label: "להזמנה", href: "#/order" });
}

function recipeText(rec, factor, c) {
  const lines = rec.ingredients.map((l) => {
    const ing = l.id ? c.ingById.get(l.id) : null;
    const { q, n } = ingredientText(l, ing ? ing.name : l.custom, factor);
    return `• ${q} ${n}${l.note ? ` (${l.note})` : ""}`;
  });
  return [`${rec.emoji} ${rec.name} (${Math.round(rec.servings * factor)} מנות)`, "", "מצרכים:", ...lines, "", "הכנה:", ...rec.steps.map((st, i) => `${i + 1}. ${st.text}`)].join("\n");
}

function shareRecipe(rec, factor, c) {
  const text = recipeText(rec, factor, c);
  if (navigator.share) navigator.share({ title: rec.name, text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("המתכון הועתק"), () => toast("ההעתקה נכשלה"));
  else toast("השיתוף לא נתמך בדפדפן הזה");
}
