import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, actions, pantrySet, rawData } from "../app.js";
import { pageHead, emptyState } from "../ui.js";
import { AISLE_LABELS, AISLE_ORDER } from "../lib/catalog.js";
import { cookableWith } from "../lib/plan.js";
import { norm } from "../lib/text.js";
import { render } from "../router.js";
import { dishInfo } from "../ui.js";
import { moneyEl } from "../ui.js";

let q = "";
let aisle = "";

export function pantryView() {
  const c = catalog();
  const have = pantrySet();
  const items = c.ingredients.filter((i) => !i.free && (!aisle || i.aisle === aisle) && (!q || norm([i.name, ...i.aliases].join(" ")).includes(norm(q))));
  const byAisle = new Map();
  for (const i of items) (byAisle.get(i.aisle) || byAisle.set(i.aisle, []).get(i.aisle)).push(i);

  const sections = AISLE_ORDER.filter((a) => byAisle.has(a)).map((a) =>
    h(
      "section.card",
      { style: { "margin-top": "0.75rem" } },
      h("h2", { style: { "font-size": "1.1rem", "margin-block-end": "0.5rem" } }, AISLE_LABELS[a]),
      h(
        "div.chips",
        byAisle.get(a).map((i) => h("button.chip", { type: "button", "aria-pressed": String(have.has(i.id)), "data-fk": `p-${i.id}`, onclick: () => actions.togglePantry(i.id) }, have.has(i.id) ? icon("check", { size: 14 }) : null, i.name)),
      ),
    ),
  );

  const cookable = cookableWith(c.recipes, have, c.ingById).filter((x) => x.missing.length <= 3 && x.have >= 3).slice(0, 8);
  const suggestions = cookable.length
    ? h(
        "div.grid",
        cookable.map(({ rec, missing }) =>
          h(
            "a.card.tight",
            { href: `#/dish/${rec.id}`, style: { "text-decoration": "none", display: "flex", "flex-direction": "column", gap: "0.2rem" } },
            h("div.row", h("span", { style: { "font-size": "1.8rem" }, "aria-hidden": "true" }, rec.emoji), h("strong", rec.name)),
            missing.length ? h("span.small.muted", "חסר: ", missing.map((id) => c.ingById.get(id).name).join(", ")) : h("span.chip.good", "יש לכם הכול!"),
            h("span.small", moneyEl(dishInfo(rec.id).perServing), " למנה"),
          ),
        ),
      )
    : h("p.muted", "סמנו עוד מצרכים שיש בבית כדי לראות הצעות.");

  const search = h("input.input", { type: "search", dir: "auto", placeholder: "חיפוש מצרך", "aria-label": "חיפוש מצרך", value: q, "data-fk": "pantry-q", oninput: debounce((e) => ((q = e.target.value.trim()), render(true)), 150) });

  const el = h(
    "div.page.wide",
    pageHead("מזווה", "מה יש בבית? מצרכים מסומנים לא נכנסים לרשימת הקניות ולא מחושבים בהשוואה", h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: resetPantry }, "איפוס למזווה בסיסי")),
    h(
      "div.grid.two",
      { style: { "align-items": "start" } },
      h("div", h("div.search", { style: { "margin-block-end": "0.5rem" } }, icon("search", { size: 22 }), search), h("div.scroll-x", h("button.chip", { type: "button", "aria-pressed": String(!aisle), onclick: () => ((aisle = ""), render(true)) }, "הכול"), AISLE_ORDER.filter((a) => a !== "free").map((a) => h("button.chip", { type: "button", "aria-pressed": String(aisle === a), onclick: () => ((aisle = a), render(true)) }, AISLE_LABELS[a]))), items.length ? sections : emptyState("🔍", "לא נמצא", "נסו חיפוש אחר.")),
      h("section", { "aria-labelledby": "can-h" }, h("h2", { id: "can-h", style: { "margin-block-end": "0.75rem" } }, "מה אפשר לבשל עכשיו?"), suggestions, h("p.small.muted", { style: { "margin-top": "0.75rem" } }, `${have.size} מצרכים מסומנים`)),
    ),
  );
  return { el, title: "מזווה" };
}

function resetPantry() {
  if (!confirm("לאפס את המזווה למצרכי הבסיס (מלח, פלפל, שמן, סוכר)?")) return;
  const base = rawData().ingredients.filter((i) => i.home).map((i) => i.id);
  store.update((s) => void (s.pantry = base));
}
