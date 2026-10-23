import { h } from "../dom.js";
import { icon } from "../icons.js";
import { catalog, settings, pantrySet } from "../app.js";
import { pageHead, moneyEl, kosherChip, addWithToast, dishInfo, emptyState } from "../ui.js";
import { duration, percent } from "../fmt.js";
import { render } from "../router.js";
import { cookableWith } from "../lib/plan.js";

let seen = [];
let mode = "any"; // any | pantry | cheap
let currentId = null; // the shown suggestion survives state-change re-renders
let maxTime = 0; // minutes, 0 = any

export function surpriseView() {
  const c = catalog();
  const prefs = settings();
  const have = pantrySet();
  let pool = c.recipes.filter((r) => ["main", "soup"].includes(r.category) && (prefs.kosher === "all" || r.kosher === prefs.kosher) && prefs.diet.every((d) => r.diet.includes(d)) && !prefs.avoid.some((a) => r.allergens.includes(a)));
  if (maxTime) pool = pool.filter((r) => r.time.total <= maxTime);
  if (mode === "pantry") pool = cookableWith(pool, have, c.ingById).filter((x) => x.missing.length <= 3).map((x) => x.rec);
  if (mode === "cheap") pool = [...pool].sort((a, b) => dishInfo(a.id).perServing - dishInfo(b.id).perServing).slice(0, Math.max(3, Math.ceil(pool.length / 3)));

  let pick = pool.find((r) => r.id === currentId) || null;
  if (!pick) {
    const fresh = pool.filter((r) => !seen.includes(r.id));
    const list = fresh.length ? fresh : pool;
    if (!fresh.length) seen = [];
    pick = list.length ? list[Math.floor(Math.random() * list.length)] : null;
    currentId = pick ? pick.id : null;
    if (pick) seen.push(pick.id);
  }

  const modes = [["any", "הפתעה"], ["pantry", "ממה שיש בבית"], ["cheap", "הכי זול"]];
  const chips = h("div.chips", { role: "group", "aria-label": "סוג הצעה" }, modes.map(([v, l]) => h("button.chip", { type: "button", "aria-pressed": String(mode === v), onclick: () => ((mode = v), (seen = []), (currentId = null), render(true)) }, l)));

  const timeChips = h("div.chips", { role: "group", "aria-label": "זמן הכנה מקסימלי" }, [[0, "בלי הגבלת זמן"], [20, "עד 20 דק׳"], [40, "עד 40 דק׳"], [60, "עד שעה"]].map(([v, l]) => h("button.chip", { type: "button", "aria-pressed": String(maxTime === v), onclick: () => ((maxTime = v), (seen = []), (currentId = null), render(true)) }, l)));

  let body;
  if (!pick) body = emptyState("🤷", "אין הצעה שמתאימה", mode === "pantry" ? "סמנו במזווה עוד מצרכים שיש בבית." : "ההעדפות בהגדרות מסננות את כל המנות.", h("a.btn", { href: mode === "pantry" ? "#/pantry" : "#/settings" }, mode === "pantry" ? "למזווה" : "להגדרות"));
  else {
    const info = dishInfo(pick.id);
    body = h(
      "div.card.stack",
      { style: { "text-align": "center", "align-items": "center", padding: "1.5rem" } },
      h("div", { style: { "font-size": "5rem", "line-height": 1 }, "aria-hidden": "true" }, pick.emoji),
      h("h2", { style: { "font-size": "2rem" } }, pick.name),
      pick.description ? h("p.muted", pick.description) : null,
      h("div.chips", { style: { "justify-content": "center" } }, h("span.chip", icon("clock", { size: 14 }), duration(pick.time.total)), kosherChip(pick), h("span.chip", moneyEl(info.perServing), " למנה"), info.savePct > 0.03 ? h("span.chip.good", `חיסכון ${percent(info.savePct)} מול הזמנה`) : null),
      h("div.row", { style: { "justify-content": "center" } }, h("a.btn", { href: `#/dish/${pick.id}` }, icon("book", { size: 20 }), "למתכון"), h("a.btn.btn-green", { href: `#/cook/${pick.id}` }, icon("chef", { size: 20 }), "מבשלים!"), h("button.btn.btn-ghost", { type: "button", onclick: () => addWithToast(pick) }, icon("plus", { size: 20 }), "לסל")),
      h("button.btn.btn-ghost", { type: "button", onclick: () => ((currentId = null), render(true)) }, icon("shuffle", { size: 20 }), "עוד הצעה"),
    );
  }
  const el = h("div.page", pageHead("מה לאכול הערב?", "תנו לנו להחליט, לפי ההעדפות שלכם"), h("div.stack", chips, timeChips, body));
  return { el, title: "מה לאכול הערב?" };
}
