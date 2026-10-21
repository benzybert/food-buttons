import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings } from "../app.js";
import { replaceQuery } from "../router.js";
import { pageHead, dishCard, dishInfo, emptyState, sampleBanner, CATEGORY_LABELS } from "../ui.js";
import { ALLERGEN_LABELS, DIET_LABELS, KOSHER_LABELS } from "../lib/derive.js";
import { norm } from "../lib/text.js";

const SORTS = [
  ["default", "לפי קטגוריה"],
  ["saving", "החיסכון הגדול ביותר"],
  ["cheap", "הזול ביותר למנה"],
  ["fast", "המהיר ביותר"],
  ["name", "לפי שם"],
];
const csv = (s) => (s ? s.split(",").filter(Boolean) : []);

export function browseView({ query }) {
  const c = catalog();
  const prefs = settings();
  const f = {
    q: query.get("q") || "",
    cat: query.get("cat") || "",
    // "all"/"none" in the URL means "the person cleared the preference from settings"
    k: query.has("k") ? (query.get("k") === "all" ? "" : query.get("k")) : prefs.kosher === "all" ? "" : prefs.kosher,
    d: query.has("d") ? csv(query.get("d")).filter((x) => x !== "none") : [...prefs.diet],
    a: query.has("a") ? csv(query.get("a")).filter((x) => x !== "none") : [...prefs.avoid],
    t: Number(query.get("t")) || 0,
    p: Number(query.get("p")) || 0,
    fav: query.get("fav") === "1",
    sort: query.get("sort") || "default",
  };

  const results = h("div", { id: "results" });
  const count = h("p.muted", { role: "status", "aria-live": "polite", style: { margin: "0 0 0.75rem" } });
  const filtersHost = h("div.filters");

  const sync = () =>
    replaceQuery({ q: f.q, cat: f.cat, k: f.k || (prefs.kosher !== "all" ? "all" : ""), d: f.d.length || !prefs.diet.length ? f.d : ["none"], a: f.a.length || !prefs.avoid.length ? f.a : ["none"], t: f.t || "", p: f.p || "", fav: f.fav ? "1" : "", sort: f.sort === "default" ? "" : f.sort });

  function matches(rec) {
    if (f.cat && rec.category !== f.cat) return false;
    if (f.k && rec.kosher !== f.k) return false;
    if (f.d.some((d) => !rec.diet.includes(d))) return false;
    if (f.a.some((a) => rec.allergens.includes(a))) return false;
    if (f.t && rec.time.total > f.t) return false;
    if (f.p && dishInfo(rec.id).perServing > f.p) return false;
    if (f.fav && !store.get().favorites.includes(rec.id)) return false;
    if (f.q) {
      const hay = norm([rec.name, rec.description, ...(rec.tags || []), ...rec.ingredients.map((l) => (l.id ? c.ingById.get(l.id)?.name : l.custom))].join(" "));
      if (!norm(f.q).split(" ").every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function refresh() {
    sync();
    favBtn.setAttribute("aria-pressed", String(f.fav));
    sortSel.value = f.sort;
    let list = c.recipes.filter(matches);
    const order = Object.keys(CATEGORY_LABELS);
    const by = {
      default: (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, "he"),
      saving: (a, b) => (dishInfo(b.id).savePct ?? -9) - (dishInfo(a.id).savePct ?? -9),
      cheap: (a, b) => dishInfo(a.id).perServing - dishInfo(b.id).perServing,
      fast: (a, b) => a.time.total - b.time.total,
      name: (a, b) => a.name.localeCompare(b.name, "he"),
    }[f.sort];
    list = list.sort(by);
    count.textContent = list.length === c.recipes.length ? `${list.length} מתכונים` : `${list.length} מתוך ${c.recipes.length} מתכונים`;
    results.replaceChildren(
      list.length
        ? h("div.grid", list.map(dishCard))
        : emptyState("🔍", "לא נמצאו מתכונים", "נסו להסיר חלק מהסינונים או לחפש משהו אחר.", h("button.btn", { type: "button", onclick: clearFilters }, "ניקוי סינונים")),
    );
    buildFilters();
  }

  function clearFilters() {
    Object.assign(f, { q: "", cat: "", k: "", d: [], a: [], t: 0, p: 0, fav: false, sort: "default" });
    search.value = "";
    refresh();
  }

  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const pill = (label, on, onClick, fk) => h("button.chip", { type: "button", "aria-pressed": String(on), "data-fk": fk, onclick: onClick }, label);

  function buildFilters() {
    const advancedCount = (f.k ? 1 : 0) + f.d.length + f.a.length + (f.t ? 1 : 0) + (f.p ? 1 : 0);
    const open = filtersHost.querySelector("details")?.open ?? advancedCount > 0;
    filtersHost.replaceChildren(
      h(
        "div.scroll-x",
        { role: "group", "aria-label": "קטגוריות" },
        pill("הכול", !f.cat, () => ((f.cat = ""), refresh()), "cat-all"),
        ...Object.entries(CATEGORY_LABELS).map(([id, label]) => pill(label, f.cat === id, () => ((f.cat = f.cat === id ? "" : id), refresh()), `cat-${id}`)),
      ),
      h(
        "details",
        { open },
        h("summary", `סינון מתקדם${advancedCount ? ` (${advancedCount})` : ""}`),
        h(
          "div.filter-group",
          h("span.label", "כשרות"),
          h("div.chips", ...["", "parve", "dairy", "meat"].map((k) => pill(k ? KOSHER_LABELS[k] : "הכול", f.k === k, () => ((f.k = k), refresh()), `k-${k || "all"}`))),
        ),
        h(
          "div.filter-group",
          h("span.label", "תזונה"),
          h("div.chips", ...Object.entries(DIET_LABELS).map(([id, label]) => pill(label, f.d.includes(id), () => ((f.d = toggleIn(f.d, id)), refresh()), `d-${id}`))),
        ),
        h(
          "div.filter-group",
          h("span.label", "בלי (אלרגנים)"),
          h("div.chips", ...Object.entries(ALLERGEN_LABELS).map(([id, label]) => pill(`בלי ${label}`, f.a.includes(id), () => ((f.a = toggleIn(f.a, id)), refresh()), `a-${id}`))),
        ),
        h(
          "div.filter-group",
          h("span.label", "זמן כולל"),
          h("div.chips", ...[[0, "הכול"], [20, "עד 20 דק׳"], [40, "עד 40 דק׳"], [60, "עד שעה"]].map(([v, l]) => pill(l, f.t === v, () => ((f.t = v), refresh()), `t-${v}`))),
        ),
        h(
          "div.filter-group",
          h("span.label", "עלות למנה (בישול)"),
          h("div.chips", ...[[0, "הכול"], [5, "עד ₪5"], [8, "עד ₪8"], [12, "עד ₪12"]].map(([v, l]) => pill(l, f.p === v, () => ((f.p = v), refresh()), `p-${v}`))),
        ),
      ),
    );
  }

  const search = h("input.input", {
    type: "search",
    dir: "auto",
    placeholder: "חיפוש מתכון או מצרך, למשל: עדשים",
    "aria-label": "חיפוש מתכון או מצרך",
    value: f.q,
    "data-fk": "q",
    oninput: debounce((e) => {
      f.q = e.target.value.trim();
      refresh();
    }, 120),
  });

  const favBtn = pill("♥ מועדפים", f.fav, () => ((f.fav = !f.fav), refresh()), "fav-filter");
  const sortSel = h(
    "select.select",
    { "aria-label": "מיון", style: { "inline-size": "auto" }, onchange: (e) => ((f.sort = e.target.value), refresh()) },
    SORTS.map(([v, l]) => h("option", { value: v, selected: f.sort === v }, l)),
  );

  const el = h(
    "div.page.wide",
    pageHead(
      "מתכונים",
      "מנות מוכנות להכנה עם Thermomix, כולל עלות למנה לעומת הזמנה",
      h("a.btn.btn-ghost", { href: "#/import" }, icon("download", { size: 20 }), "ייבוא מתכון"),
    ),
    sampleBanner(),
    h("div.stack", { style: { margin: "1rem 0" } }, h("div.search", icon("search", { size: 22 }), search)),
    filtersHost,
    h(
      "div.spread",
      { style: { "margin-block-end": "0.5rem" } },
      count,
      h("div.row", favBtn, sortSel),
    ),
    results,
  );
  refresh();
  return { el, title: "מתכונים" };
}
