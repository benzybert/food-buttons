import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings, report, actions, pantrySet, stores as storeList } from "../app.js";
import { replaceQuery, render } from "../router.js";
import { pageHead, moneyEl, emptyState, sampleBanner, toast } from "../ui.js";
import { priceAtStore } from "../lib/calc.js";
import { AISLE_LABELS, AISLE_ORDER } from "../lib/catalog.js";
import { money, plainMoney } from "../fmt.js";
import { buyText } from "./compare.js";
import { formatQty } from "../lib/units.js";

export function listView({ query }) {
  const c = catalog();
  const s = store.get();
  const set = settings();
  if (!s.basket.length) {
    return {
      title: "רשימת קניות",
      el: h("div.page", pageHead("רשימת קניות", "נבנית אוטומטית מהמנות שבסל"), emptyState("📝", "אין מה לקנות עדיין", "הוסיפו מתכונים לסל והרשימה תיבנה כאן, עם כמויות ומחירים.", h("a.btn", { href: "#/cook" }, "לבחירת מתכונים"))),
    };
  }
  const rep = report();
  const pantry = pantrySet();
  const st = storeList();
  const split = query.get("split") === "pair" && rep.pair ? "pair" : query.get("split") === "item" ? "item" : "";

  let primary = st.find((x) => x.id === set.primaryStore) || rep.bestStore.store;
  const priced = priceAtStore(rep.needs, primary, c, pantry);

  // ---- which lines to show, grouped
  /** @type {{ title: string, subtitle?: string, lines: any[], total: number }[]} */
  let groups;
  if (split) {
    const lines = split === "pair" ? rep.pair.lines : rep.perItem.lines;
    const byStore = new Map();
    for (const l of lines) (byStore.get(l.storeId) || byStore.set(l.storeId, []).get(l.storeId)).push(l);
    groups = [...byStore.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([sid, ls]) => ({ title: c.storeById.get(sid).name, lines: ls, total: ls.reduce((a, l) => a + l.cost, 0), aisleGroups: true }));
  } else {
    groups = [{ title: primary.name, lines: priced.lines, total: priced.subtotal, aisleGroups: true }];
  }
  const cheaperElsewhere = (l) => {
    if (split) return null;
    let best = null;
    for (const r of rep.ranked) {
      if (r.storeId === primary.id) continue;
      const o = r.lines.find((x) => x.ingId === l.ingId);
      if (o && o.kind !== "missing" && o.cost < l.cost - 1 && (!best || o.cost < best.cost)) best = { store: r.store.name, cost: o.cost };
    }
    return best;
  };

  const check = (ingId) => (e) =>
    store.update((x) => {
      if (e.target.checked) x.checked[ingId] = true;
      else delete x.checked[ingId];
    });

  const renderLine = (l) => {
    const ing = c.ingById.get(l.ingId);
    const done = !!s.checked[l.ingId];
    const cheaper = cheaperElsewhere(l);
    const uses = rep.needs.get(l.ingId).uses.map((u) => c.recById.get(u.dishId)?.name).filter(Boolean);
    return h(
      "li.shop-item",
      { class: done ? "done" : "" },
      h("input", { type: "checkbox", checked: done, "aria-label": `${ing.name} נקנה`, "data-fk": `chk-${l.ingId}`, onchange: check(l.ingId) }),
      h(
        "div.info",
        h("span.what", ing.name),
        h("span.qty", buyText(ing, l), l.kind === "missing" ? " · לא נמצא בחנות (אומדן)" : "", [...new Set(uses)].length ? ` · ${[...new Set(uses)].slice(0, 2).join(", ")}${new Set(uses).size > 2 ? "…" : ""}` : ""),
        cheaper ? h("span.small", { style: { color: "var(--good)" } }, `זול יותר ב${cheaper.store}: `, moneyEl(cheaper.cost)) : null,
      ),
      h("span.price", moneyEl(l.cost)),
    );
  };

  const groupEls = groups.map((g) => {
    const byAisle = new Map();
    for (const l of g.lines) {
      const a = c.ingById.get(l.ingId).aisle;
      (byAisle.get(a) || byAisle.set(a, []).get(a)).push(l);
    }
    return h(
      "section.card",
      { style: { "margin-top": "1rem" }, "aria-label": `רשימה ל${g.title}` },
      h("div.spread", h("h2", g.title), h("span.strong", "סה״כ ", moneyEl(g.total))),
      AISLE_ORDER.filter((a) => byAisle.has(a)).map((a) => h("div.aisle", h("h3", AISLE_LABELS[a]), h("ul.list-plain", byAisle.get(a).sort((x, y) => c.ingById.get(x.ingId).name.localeCompare(c.ingById.get(y.ingId).name, "he")).map(renderLine)))),
    );
  });

  // ---- pantry items
  const pantryItems = [...rep.needs.values()].filter((n) => pantry.has(n.ing.id) && !n.ing.free);
  const pantrySection = pantryItems.length
    ? h(
        "details.card.tight",
        { style: { "margin-top": "1rem" } },
        h("summary", { style: { cursor: "pointer", "font-weight": "700", "min-height": "2.75rem", display: "flex", "align-items": "center" } }, `יש בבית, לא צריך לקנות (${pantryItems.length})`),
        h("ul.list-plain", pantryItems.map((n) => h("li.shop-item", h("div.info", h("span.what", n.ing.name), h("span.qty", `צריך ${formatQty(n.need, n.ing.base === "u" ? "u" : n.ing.base)}${n.ing.base === "u" ? " יח׳" : ""}`)), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => actions.togglePantry(n.ing.id, false) }, "אין לי")))),
      )
    : null;

  const customSection = rep.custom.length
    ? h("section.card", { style: { "margin-top": "1rem" } }, h("h2", "מצרכים ללא מחיר"), h("p.small.muted", "לא נמצאו בקטלוג ולכן לא נכללו בסכום."), h("ul.list-plain", rep.custom.map((x) => h("li.shop-item", h("div.info", h("span.what", x.name), h("span.qty", `${Math.round(x.qty * 10) / 10} ${x.unit}`))))))
    : null;

  // ---- store switcher
  const switcher = split
    ? h("div.row", h("span.chip.info", split === "pair" ? "שתי חנויות" : "הכי זול לכל פריט"), h("button.btn-link", { type: "button", onclick: () => (replaceQuery({}), render(true)) }, "חזרה לחנות אחת"))
    : h(
        "div.scroll-x",
        { role: "group", "aria-label": "בחירת חנות" },
        ...rep.ranked.map((r) => h("button.chip", { type: "button", "aria-pressed": String(r.storeId === primary.id), "data-fk": `st-${r.storeId}`, onclick: () => store.update((x) => void (x.settings.primaryStore = r.storeId)) }, r.store.name, " ", moneyEl(r.subtotal))),
      );

  const text = listText(groups, c, s.checked, split);
  const doneCount = groups.flatMap((g) => g.lines).filter((l) => s.checked[l.ingId]).length;
  const totalCount = groups.flatMap((g) => g.lines).length;

  const el = h(
    "div.page",
    pageHead("רשימת קניות", `${doneCount} מתוך ${totalCount} סומנו`, h("button.btn.btn-ghost.btn-sm.no-print", { type: "button", onclick: () => window.print() }, icon("printer", { size: 18 }), "הדפסה")),
    sampleBanner(),
    h("div.stack.no-print", { style: { margin: "0.75rem 0" } }, switcher),
    ...groupEls,
    pantrySection,
    customSection,
    h(
      "div.row.no-print",
      { style: { "margin-top": "1.25rem" } },
      h("a.btn.btn-green", { href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, icon("whatsapp", { size: 20 }), "שליחה בוואטסאפ"),
      h("button.btn.btn-ghost", { type: "button", onclick: () => copy(text) }, icon("copy", { size: 20 }), "העתקה"),
      doneCount ? h("button.btn.btn-ghost", { type: "button", onclick: () => store.update((x) => void (x.checked = {})) }, "ניקוי סימונים") : null,
      h("a.btn.btn-ghost", { href: "#/compare" }, icon("scale", { size: 20 }), "חזרה להשוואה"),
    ),
  );
  void money;
  return { el, title: "רשימת קניות" };
}

function listText(groups, c, checked, split) {
  const out = [];
  for (const g of groups) {
    out.push(`🛒 ${split ? g.title : `רשימת קניות - ${g.title}`}`);
    const byAisle = new Map();
    for (const l of g.lines) {
      const a = c.ingById.get(l.ingId).aisle;
      (byAisle.get(a) || byAisle.set(a, []).get(a)).push(l);
    }
    for (const a of AISLE_ORDER) {
      if (!byAisle.has(a)) continue;
      out.push("", `${AISLE_LABELS[a]}:`);
      for (const l of byAisle.get(a)) {
        const ing = c.ingById.get(l.ingId);
        out.push(`${checked[l.ingId] ? "✅" : "▫️"} ${ing.name} - ${buyText(ing, l)}`);
      }
    }
    out.push("", `סה״כ משוער: ${plainMoney(g.total)}`, "");
  }
  return out.join("\n").trim();
}

function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("הרשימה הועתקה"), () => toast("ההעתקה נכשלה"));
  else toast("ההעתקה לא נתמכת בדפדפן הזה");
}
