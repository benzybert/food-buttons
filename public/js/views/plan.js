import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings, actions, report } from "../app.js";
import { pageHead, moneyEl, openDialog, toast, dishInfo, sampleBanner, notice } from "../ui.js";
import { WEEKDAYS, MEAL_SLOTS, recipesWord } from "../fmt.js";
import { norm } from "../lib/text.js";
import { suggestWeek } from "../lib/plan.js";
import { CATEGORY_LABELS } from "../lib/catalog.js";

export function planView() {
  const c = catalog();
  const s = store.get();
  const set = settings();
  const today = new Date().getDay();
  const scheduled = s.basket.filter((b) => b.day != null);
  const loose = s.basket.filter((b) => b.day == null);

  const dayCard = (d) =>
    h(
      "section.day",
      { class: d === today ? "today" : "", "aria-labelledby": `day-${d}` },
      h("h3", { id: `day-${d}` }, h("span", `יום ${WEEKDAYS[d]}`), d === today ? h("span.chip.good", "היום") : null),
      MEAL_SLOTS.map((slot) => {
        const items = scheduled.filter((b) => b.day === d && (b.slot || "dinner") === slot.id);
        return h(
          "div.slot",
          h("span.label", slot.label),
          items.map((b) => {
            const rec = c.recById.get(b.dishId);
            if (!rec) return null;
            return h(
              "div.plan-item",
              h("span", { "aria-hidden": "true" }, rec.emoji),
              h("a", { href: `#/dish/${rec.id}?s=${b.servings}` }, rec.name, h("span.muted.small", ` · ${b.servings}`)),
              h("button", { type: "button", "aria-label": `הסר את ${rec.name} מיום ${WEEKDAYS[d]}`, onclick: () => actions.removeFromBasket(b.id) }, icon("x", { size: 16 })),
            );
          }),
          h("button.add-slot", { type: "button", "aria-label": `הוספת מנה ליום ${WEEKDAYS[d]} ${slot.label}`, onclick: () => pickDish((rec) => actions.addToBasket(rec.id, set.household, { day: d, slot: slot.id })) }, icon("plus", { size: 16 }), "הוספה"),
        );
      }),
    );

  const rep = s.basket.length ? report() : null;
  const budget = set.budget;

  const looseCard = loose.length
    ? h(
        "section.card",
        { style: { "margin-top": "1rem" } },
        h("h2", "בסל ובלי יום"),
        loose.map((b) => {
          const rec = c.recById.get(b.dishId);
          return h(
            "div.basket-row",
            h("span.emoji", { "aria-hidden": "true" }, rec.emoji),
            h("a.nm", { href: `#/dish/${rec.id}` }, rec.name),
            h("select.select", { style: { "inline-size": "auto" }, "aria-label": `שיבוץ ${rec.name} ליום`, onchange: (e) => e.target.value !== "" && store.update((x) => void Object.assign(x.basket.find((y) => y.id === b.id), { day: Number(e.target.value), slot: "dinner" })) }, h("option", { value: "" }, "שיבוץ ליום..."), WEEKDAYS.map((w, i) => h("option", { value: String(i) }, `יום ${w}`))),
          );
        }),
      )
    : null;

  const el = h(
    "div.page.wide",
    pageHead("תכנון שבועי", "מה אוכלים כל יום, כמה זה עולה, ורשימת קניות אחת לכל השבוע", h("button.btn", { type: "button", onclick: autoPlan }, icon("sparkle", { size: 20 }), "תכנון אוטומטי")),
    sampleBanner(),
    rep
      ? h(
          "div.card",
          { style: { margin: "1rem 0" } },
          h("div.spread", h("span", `${recipesWord(s.basket.length)} בתכנון`), h("span", "קנייה ב", rep.bestStore.store.name, ": ", h("strong", moneyEl(rep.cookTotal))), rep.saving != null && rep.saving > 0 ? h("span.chip.good", "חיסכון ", moneyEl(rep.saving), " מול הזמנה") : null),
          budget ? h("p.small", { style: { margin: "0.4rem 0 0", color: rep.cookTotal > budget ? "var(--bad)" : "var(--good)" } }, rep.cookTotal > budget ? ["חריגה של ", moneyEl(rep.cookTotal - budget), " מהתקציב"] : ["נשארו ", moneyEl(budget - rep.cookTotal), " מהתקציב"]) : null,
          h("div.row", { style: { "margin-top": "0.6rem" } }, h("a.btn.btn-sm", { href: "#/list" }, icon("list", { size: 16 }), "רשימת קניות"), h("a.btn.btn-ghost.btn-sm", { href: "#/compare" }, icon("scale", { size: 16 }), "השוואה")),
        )
      : h("div", { style: { margin: "1rem 0" } }, notice("info", "הוסיפו מנות לימים בשבוע, או תנו לנו להציע שבוע שלם לפי התקציב וההעדפות שלכם.")),
    h("div.week", [0, 1, 2, 3, 4, 5, 6].map(dayCard)),
    looseCard,
  );
  return { el, title: "תכנון שבועי" };

  function autoPlan() {
    const days = h("input.input.num-in", { type: "number", min: "1", max: "7", value: "5", id: "ap-days" });
    const bud = h("input.input.num-in", { type: "number", min: "0", step: "10", value: String(budget || 0), id: "ap-budget" });
    const replace = h("input", { type: "checkbox", id: "ap-replace", checked: true });
    const dlg = openDialog(
      "תכנון שבוע אוטומטי",
      h(
        "div.stack",
        h("p.muted", "נבחר מנות עיקריות ומרקים שמתאימים להעדפות שלכם (כשרות, תזונה ואלרגנים מההגדרות), בתקציב שתבחרו ועם מגוון."),
        h("div.row", h("label", { for: "ap-days" }, "כמה ארוחות ערב?"), days),
        h("div.row", h("label", { for: "ap-budget" }, "תקציב מצרכים לשבוע (₪, 0 = ללא):"), bud),
        h("label.check", replace, "להחליף את התכנון הקיים"),
        h("button.btn", { type: "button", onclick: () => run(Number(days.value) || 5, Number(bud.value) || 0, replace.checked, dlg) }, icon("sparkle", { size: 20 }), "הציעו לי"),
      ),
    );
  }

  function run(count, budgetVal, replaceExisting, dlg) {
    const prefs = settings();
    const cands = c.recipes.filter((r) => (prefs.kosher === "all" || r.kosher === prefs.kosher) && prefs.diet.every((d) => r.diet.includes(d)) && !prefs.avoid.some((a) => r.allergens.includes(a)));
    const costOf = (r) => dishInfo(r.id, prefs.household).cmp.cook.total;
    const pick = suggestWeek(cands, costOf, { count: Math.min(7, Math.max(1, count)), budget: budgetVal, seed: Math.floor(Date.now() / 1000) });
    if (!pick.length) {
      toast("לא נמצאו מנות שמתאימות להעדפות");
      return;
    }
    store.update((x) => {
      if (replaceExisting) x.basket = x.basket.filter((b) => b.day == null);
      // spread across the working week starting Sunday, evenings
      const order = [0, 1, 2, 3, 4, 5, 6];
      pick.forEach((rec, i) => x.basket.push({ id: `a${Date.now().toString(36)}${i}`, dishId: rec.id, servings: prefs.household, day: order[i % 7], slot: "dinner" }));
      if (budgetVal) x.settings.budget = budgetVal;
    });
    dlg.close();
    toast(`נוספו ${recipesWord(pick.length)} לשבוע`, { label: "להשוואה", href: "#/compare" });
  }
}

/** Dish picker dialog with search + category chips. */
export function pickDish(onPick) {
  const c = catalog();
  let q = "";
  let cat = "";
  const list = h("ul.pick-list");
  const chips = h("div.scroll-x");
  let dlg;
  const paint = () => {
    const items = c.recipes.filter((r) => (!cat || r.category === cat) && (!q || norm(r.name + " " + (r.tags || []).join(" ")).includes(norm(q))));
    list.replaceChildren(
      ...items.map((r) => {
        const info = dishInfo(r.id);
        return h("li", h("button", { type: "button", onclick: () => (onPick(r), dlg.close()) }, h("span", { style: { "font-size": "1.6rem" }, "aria-hidden": "true" }, r.emoji), h("span.grow", h("strong", r.name), h("div.small.muted", `${CATEGORY_LABELS[r.category]} · `, moneyEl(info.perServing), " למנה")), icon("plus", { size: 20 })));
      }),
    );
    if (!items.length) list.replaceChildren(h("li.muted", "לא נמצאו מנות"));
    chips.replaceChildren(h("button.chip", { type: "button", "aria-pressed": String(!cat), onclick: () => ((cat = ""), paint()) }, "הכול"), ...Object.entries(CATEGORY_LABELS).map(([id, l]) => h("button.chip", { type: "button", "aria-pressed": String(cat === id), onclick: () => ((cat = id), paint()) }, l)));
  };
  const search = h("input.input", { type: "search", dir: "auto", placeholder: "חיפוש מנה", "aria-label": "חיפוש מנה", oninput: debounce((e) => ((q = e.target.value.trim()), paint()), 100) });
  dlg = openDialog("בחירת מנה", [search, chips, list]);
  paint();
  search.focus();
}
