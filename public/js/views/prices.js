import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, actions, stores as storeList } from "../app.js";
import { pageHead, moneyEl, openDialog, toast, notice } from "../ui.js";
import { render } from "../router.js";
import { AISLE_LABELS, AISLE_ORDER } from "../lib/catalog.js";
import { formatQty } from "../lib/units.js";
import { matchIngredient } from "../lib/parse.js";
import { norm } from "../lib/text.js";
import { money } from "../fmt.js";

let q = "";
let aisle = "";
let editing = null; // "ingId:storeId"

function packLabel(ing) {
  const unit = ing.base === "u" ? "u" : ing.base;
  if (ing.pack.type === "loose") return ing.base === "u" ? "ליחידה" : 'לק"ג';
  return `אריזה ${formatQty(ing.pack.size, unit)}${ing.base === "u" ? " יח׳" : ""}`;
}

export function pricesView() {
  const c = catalog();
  const st = storeList();
  const s = store.get();
  const meta = c.prices.meta;
  const mineCount = Object.values(s.priceOverrides).reduce((a, r) => a + Object.keys(r).length, 0);

  const ings = c.ingredients.filter((i) => !i.free && (!aisle || i.aisle === aisle) && (!q || norm([i.name, ...i.aliases].join(" ")).includes(norm(q))));

  const cell = (ing, sid) => {
    const key = `${ing.id}:${sid}`;
    const info = c.priceFor(ing.id, sid);
    const prices = st.map((x) => c.priceFor(ing.id, x.id)).filter((p) => p.price != null).map((p) => p.price);
    const min = prices.length ? Math.min(...prices) : null;
    if (editing === key) {
      const input = h("input", { type: "number", step: "0.1", min: "0", inputmode: "decimal", value: info.price != null ? String(info.price) : "", "aria-label": `מחיר ${ing.name} ב${c.storeById.get(sid).name}`, "data-fk": `edit-${key}` });
      const save = () => {
        editing = null;
        const v = Number(input.value);
        if (Number.isFinite(v) && v > 0 && v !== info.price) actions.setPriceOverride(ing.id, sid, v);
        else render(true);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
        else if (e.key === "Escape") ((editing = null), render(true));
      });
      input.addEventListener("blur", save);
      queueMicrotask(() => input.focus());
      return h("td", input);
    }
    const cls = info.kind === "user" ? "mine" : info.price == null ? "none" : "";
    const cheap = info.price != null && min != null && info.price === min && prices.length > 1;
    return h(
      "td.n",
      { class: `${cls} ${cheap ? "cheap" : ""}` },
      h("button.btn-link", { type: "button", style: { "text-decoration": "none", color: "inherit", padding: "0.4rem 0.2rem", "min-width": "3.5rem" }, "data-fk": `cell-${key}`, "aria-label": `${ing.name} ב${c.storeById.get(sid).name}: ${info.price == null ? "אין מחיר" : money(info.price)}. לעריכה`, title: info.price == null ? "אין מחיר. לחצו להזנה" : info.kind === "user" ? "המחיר שהזנתם" : "", onclick: () => ((editing = key), render(true)) }, info.price == null ? "—" : moneyEl(info.price)),
    );
  };

  const table = h(
    "div.tbl-wrap",
    h(
      "table.tbl",
      h("caption.sr-only", "מחירי מצרכים לפי חנות. אפשר ללחוץ על מחיר כדי לערוך."),
      h("thead", h("tr", h("th.sticky-col", "מצרך"), ...st.map((x) => h("th.n", x.name)))),
      h(
        "tbody",
        AISLE_ORDER.flatMap((a) => {
          const group = ings.filter((i) => i.aisle === a);
          if (!group.length) return [];
          return [
            h("tr", h("th.sticky-col", { colspan: String(st.length + 1), style: { background: "var(--surface-2)" } }, AISLE_LABELS[a])),
            ...group.map((ing) => h("tr", h("td.sticky-col", h("strong", ing.name), h("div.small.muted", packLabel(ing))), ...st.map((x) => cell(ing, x.id)))),
          ];
        }),
      ),
    ),
  );

  const search = h("input.input", { type: "search", dir: "auto", placeholder: "חיפוש מצרך", "aria-label": "חיפוש מצרך", value: q, "data-fk": "price-q", oninput: debounce((e) => ((q = e.target.value.trim()), render(true)), 150) });

  const el = h(
    "div.page.wide",
    pageHead("מחירים", `מחיר לאריזה בכל חנות${meta.updated ? ` · עודכן ${meta.updated}` : ""}`, h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: importDialog }, icon("upload", { size: 16 }), "ייבוא מחירים"), mineCount ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => confirm("למחוק את כל המחירים שהזנתם?") && store.update((x) => void (x.priceOverrides = {})) }, `איפוס ${mineCount} מחירים שלי`) : null),
    Object.keys(c.prices.table || {}).length === 0
      ? notice("info", "אין מחירים באתר, ואין בו מחירי דוגמה. המחירים כאן הם רק מה שתזינו: לחצו על תא כדי להזין את המחיר שראיתם בחנות, או הדביקו רשימה ב״ייבוא מחירים״. מחירים שהזנתם נשמרים בדפדפן הזה בלבד ומסומנים בקו כחול.")
      : notice("info", meta.note || ""),
    h("div.search", { style: { margin: "1rem 0 0.5rem" } }, icon("search", { size: 22 }), search),
    h("div.scroll-x", { style: { "margin-bottom": "0.75rem" } }, h("button.chip", { type: "button", "aria-pressed": String(!aisle), onclick: () => ((aisle = ""), render(true)) }, "הכול"), AISLE_ORDER.filter((a) => a !== "free").map((a) => h("button.chip", { type: "button", "aria-pressed": String(aisle === a), onclick: () => ((aisle = a), render(true)) }, AISLE_LABELS[a]))),
    table,
    h("p.small.muted", "ירוק = הזול ביותר מבין החנויות · — = אין מחיר. מחירי פריטים הנמכרים בשקילה הם לק״ג. סכומים באתר מחושבים רק כשיש מחיר לכל המצרכים הנדרשים באותה חנות."),
  );
  return { el, title: "מחירים" };
}

function importDialog() {
  const c = catalog();
  const area = h("textarea.textarea", { dir: "auto", placeholder: "בצל, שופרסל, 5.90\nשמן זית, רמי לוי, 34.9\n...", "aria-label": "מחירים בפורמט מצרך, חנות, מחיר" });
  const out = h("div");
  const dlg = openDialog(
    "ייבוא מחירים",
    h(
      "div.stack",
      h("p.muted", "הדביקו שורות בפורמט: מצרך, חנות, מחיר (אפשר גם עם טאב). המחיר הוא לאריזה, או לק״ג לפריטים הנמכרים בשקילה."),
      area,
      h("button.btn", { type: "button", onclick: () => doImport(area.value, out, c, dlg) }, "ייבוא"),
      out,
    ),
  );
}

function doImport(text, out, c) {
  const storeByName = new Map();
  for (const s of c.stores) {
    storeByName.set(norm(s.name), s.id);
    storeByName.set(s.id, s.id);
  }
  let ok = 0;
  const bad = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split(/\t|,(?=[^,]*,[^,]*$)|;/).map((p) => p.trim());
    const m = line.match(/^(.+?)[,\t;]\s*(.+?)[,\t;]\s*([\d.,]+)\s*₪?$/);
    const [name, storeName, priceRaw] = m ? [m[1], m[2], m[3]] : parts;
    const hit = name && matchIngredient(name, c.index);
    const sid = storeName && storeByName.get(norm(storeName));
    const price = Number(String(priceRaw || "").replace(",", "."));
    if (hit && sid && price > 0) {
      actions.setPriceOverride(hit.id, sid, price);
      ok++;
    } else bad.push(line);
  }
  out.replaceChildren(h("div", h("p", { role: "status" }, `יובאו ${ok} מחירים.`), bad.length ? h("div.notice.warn", h("div", h("p", `${bad.length} שורות לא זוהו:`), h("ul", bad.slice(0, 8).map((b) => h("li", b))))) : null));
  if (ok) toast(`יובאו ${ok} מחירים`);
}
