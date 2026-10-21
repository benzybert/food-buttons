// The order side ("שרון" and any other place you can order from). A priced menu, a cart, and a message to send.
// Menu prices are editable (and a dish can be switched off) because the bundled prices are samples.
// Extra order sources (a restaurant, a delivery app) can be added and are compared everywhere.

import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store, uid } from "../store.js";
import { catalog, settings, actions, stores as storeList } from "../app.js";
import { render, replaceQuery } from "../router.js";
import { pageHead, moneyEl, stepper, emptyState, notice, toast, dishInfo, openDialog } from "../ui.js";
import { money, percent, plainMoney } from "../fmt.js";
import { CATEGORY_LABELS } from "../lib/catalog.js";
import { dishCostByStore, round2 } from "../lib/calc.js";
import { norm } from "../lib/text.js";

const SHARON = "sharon";
let editing = false;
let searchText = "";

export function orderView({ query }) {
  const c = catalog();
  const s = store.get();
  const srcId = c.sourceById.has(query.get("src")) ? query.get("src") : SHARON;
  const src = c.sourceById.get(srcId);
  const off = new Set(s.orderOff[srcId] || []);
  const cart = s.orderCart;

  const unit = (id) => c.orderPrice(id, srcId);
  const setCart = (id, n) =>
    store.update((x) => {
      if (n > 0) x.orderCart[id] = Math.min(30, n);
      else delete x.orderCart[id];
    });

  const list = c.recipes.filter((r) => (editing || !off.has(r.id)) && (!searchText || norm(r.name + " " + (r.tags || []).join(" ")).includes(norm(searchText))));
  const byCat = new Map();
  for (const r of list) (byCat.get(r.category) || byCat.set(r.category, []).get(r.category)).push(r);

  const row = (rec) => {
    const price = unit(rec.id);
    const info = dishInfo(rec.id);
    const qty = cart[rec.id] || 0;
    const isOff = off.has(rec.id);
    const custom = s.orderPrices[rec.id]?.[srcId] != null;
    if (editing) {
      const input = h("input.input.num-in", { type: "number", min: "0", step: "1", inputmode: "decimal", value: price != null ? String(price) : "", placeholder: price == null ? "מחיר" : undefined, "aria-label": `מחיר למנה: ${rec.name}`, "data-fk": `price-${rec.id}`, onchange: (e) => actions.setOrderPrice(rec.id, srcId, Number(e.target.value)) });
      return h(
        "li.shop-item.wrap",
        h("span", { "aria-hidden": "true", style: { "font-size": "1.5rem" } }, rec.emoji),
        h("div.info", h("span.what", rec.name), h("span.qty", custom ? "מחיר מותאם" : price != null ? "מחיר לדוגמה" : "אין מחיר")),
        input,
        h("label.check", h("input", { type: "checkbox", checked: !isOff, "aria-label": `${rec.name} מוצע ב${src.name}`, onchange: (e) => actions.setOrderOff(srcId, rec.id, !e.target.checked) }), h("span.small", "מוצע")),
        custom ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => actions.setOrderPrice(rec.id, srcId, 0) }, "איפוס") : null,
      );
    }
    return h(
      "li.shop-item.wrap",
      h("span", { "aria-hidden": "true", style: { "font-size": "1.6rem" } }, rec.emoji),
      h(
        "div.info",
        h("a.what", { href: `#/dish/${rec.id}`, style: { "text-decoration": "none" } }, rec.name),
        h("span.qty", info.savePct != null && info.savePct > 0.03 ? `בישול ביתי ${money(info.perServing)} למנה (חיסכון ${percent(info.savePct)})` : `בישול ביתי ${money(info.perServing)} למנה`),
      ),
      price != null ? h("span.price", moneyEl(price)) : h("span.muted", "-"),
      stepper({ value: qty, min: 0, max: 30, label: `מנות של ${rec.name}`, size: "sm", onChange: (n) => setCart(rec.id, n) }),
    );
  };

  const groups = [...byCat.entries()]
    .sort((a, b) => Object.keys(CATEGORY_LABELS).indexOf(a[0]) - Object.keys(CATEGORY_LABELS).indexOf(b[0]))
    .map(([cat, recs]) => h("section.card", { style: { "margin-top": "1rem" } }, h("h2", { style: { "font-size": "1.15rem", "margin-block-end": "0.25rem" } }, CATEGORY_LABELS[cat]), h("ul.list-plain", recs.map(row))));

  const entries = Object.entries(cart).filter(([id]) => c.recById.has(id) && !off.has(id) && unit(id) != null);
  const total = round2(entries.reduce((a, [id, n]) => a + unit(id) * n, 0));
  const count = entries.reduce((a, [, n]) => a + n, 0);
  const summary = entries.length ? orderSummary(entries, total, count, c, src) : null;

  const search = h("input.input", { type: "search", dir: "auto", placeholder: "חיפוש בתפריט", "aria-label": "חיפוש בתפריט", value: searchText, "data-fk": "order-q", oninput: debounce((e) => ((searchText = e.target.value.trim()), render(true)), 150) });

  const sourceChips = h(
    "div.scroll-x",
    { role: "group", "aria-label": "מקור ההזמנה" },
    ...c.sources.map((x) => h("button.chip", { type: "button", "aria-pressed": String(x.id === srcId), onclick: () => (replaceQuery({ src: x.id === SHARON ? "" : x.id }), render(true)) }, x.name)),
    h("button.chip", { type: "button", onclick: () => sourceDialog() }, icon("plus", { size: 14 }), "הוספת מקור"),
  );

  const feeNote = src.fee || src.markup ? h("p.small.muted", { style: { margin: "0.25rem 0 0" } }, [src.markup ? `תוספת של ${Math.round(src.markup * 100)}% על מחיר התפריט` : null, src.fee ? `דמי משלוח ${money(src.fee)} להזמנה` : null].filter(Boolean).join(" · ")) : null;

  const el = h(
    "div.page",
    pageHead(`הזמנה דרך ${src.name}`, "בוחרים מנות, רואים כמה זה עולה מול בישול בבית, ושולחים", h("button.btn.btn-ghost.btn-sm", { type: "button", "aria-pressed": String(editing), onclick: () => ((editing = !editing), render(true)) }, icon("pencil", { size: 16 }), editing ? "סיום עריכה" : "עריכת מחירון"), src.kind === "custom" ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => sourceDialog(src) }, "הגדרות המקור") : null),
    sourceChips,
    feeNote,
    notice("warn", "מחירי התפריט הם הערכות לדוגמה. אפשר לעדכן כל מחיר ב״עריכת מחירון״ כדי שההשוואות יהיו מדויקות.", "alert"),
    h("div.search", { style: { margin: "1rem 0" } }, icon("search", { size: 22 }), search),
    editing ? notice("info", "מצב עריכה: שנו מחיר למנה, או בטלו מנה שלא מוצעת. השינויים נשמרים בדפדפן הזה.") : null,
    list.length ? groups : emptyState("🔍", "לא נמצאו מנות", "נסו חיפוש אחר."),
    summary,
  );
  return { el, title: src.name };
}

function orderSummary(entries, total, count, c, src) {
  const set = settings();
  const st = storeList();
  let cook = 0;
  for (const [id, n] of entries) cook += dishCostByStore(c.recById.get(id), n, c, st)[0].total;
  cook = round2(cook);
  const fee = src.fee || 0;
  const grand = round2(total + fee);
  const saving = round2(grand - cook);

  const text = orderText(entries, grand, c, src);
  const phone = normalizePhone(src.id === SHARON ? set.sharonPhone : src.phone);
  const canWhatsApp = src.id === SHARON || src.kind === "custom";

  // the cheapest other way to get the same dishes
  const others = c.sources
    .filter((o) => o.id !== src.id)
    .map((o) => ({ o, total: round2(entries.reduce((a, [id, n]) => a + (c.orderPrice(id, o.id) || 0) * n, 0) + (o.fee || 0)), complete: entries.every(([id]) => c.orderPrice(id, o.id) != null) }))
    .filter((x) => x.complete)
    .sort((a, b) => a.total - b.total)[0];

  const phoneInput = h("input.input", { type: "tel", inputmode: "tel", dir: "ltr", placeholder: "050-1234567", value: "", "aria-label": `מספר וואטסאפ של ${src.name}`, "data-fk": "order-phone", style: { "max-inline-size": "14rem" }, onchange: (e) => savePhone(src, e.target.value.trim()) });

  return h(
    "section.card",
    { style: { "margin-top": "1.25rem", position: "sticky", "inset-block-end": "4.5rem", "box-shadow": "0 0.5rem 2rem rgb(0 0 0 / 0.25)" }, "aria-labelledby": "cart-h" },
    h("div.spread", h("h2", { id: "cart-h" }, `ההזמנה שלכם: ${count} מנות`), h("span.strong", { style: { "font-size": "1.5rem" } }, moneyEl(grand))),
    fee ? h("p.small.muted", { style: { margin: 0 } }, "כולל ", moneyEl(fee), " משלוח") : null,
    h(
      "p.small.muted",
      { style: { margin: "0.25rem 0 0.5rem" } },
      saving > 0 ? ["בישול אותן מנות בבית יעלה ", moneyEl(cook), " ", h("span.chip.good", "חיסכון ", moneyEl(saving))] : ["בישול אותן מנות בבית יעלה ", moneyEl(cook), " (ההזמנה זולה יותר)"],
      others ? [" · ", `ב${others.o.name}: `, moneyEl(others.total)] : null,
    ),
    h(
      "div.row",
      canWhatsApp ? h("a.btn.btn-green", { href: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, icon("whatsapp", { size: 20 }), phone ? `שליחה ל${src.name} בוואטסאפ` : "שליחה בוואטסאפ") : null,
      h("button.btn.btn-ghost", { type: "button", onclick: () => navigator.clipboard?.writeText(text).then(() => toast("ההזמנה הועתקה"), () => toast("ההעתקה נכשלה")) }, icon("copy", { size: 20 }), "העתקה"),
      h("button.btn.btn-ghost", { type: "button", onclick: () => (entries.forEach(([id, n]) => actions.addToBasket(id, n)), toast("המנות נוספו לסל הבישול", { label: "להשוואה", href: "#/compare" })) }, icon("cart", { size: 20 }), "לבשל במקום"),
      h("button.btn-link", { type: "button", onclick: () => store.update((x) => void (x.orderCart = {})) }, "ניקוי"),
    ),
    canWhatsApp && !phone ? h("div.row", { style: { "margin-top": "0.6rem" } }, h("label", { for: "order-phone" }, `מספר של ${src.name} (לשליחה ישירה):`), Object.assign(phoneInput, { id: "order-phone" })) : null,
    canWhatsApp && phone ? h("p.small.muted", { style: { margin: "0.5rem 0 0" } }, "נשלח אל ", h("bdi.ltr", src.id === SHARON ? set.sharonPhone : src.phone), " · ", h("button.btn-link", { type: "button", onclick: () => savePhone(src, "") }, "שינוי מספר")) : null,
  );
}

function savePhone(src, value) {
  if (src.id === SHARON) store.update((x) => void (x.settings.sharonPhone = value));
  else actions.saveSource({ ...store.get().customSources.find((x) => x.id === src.id), phone: value });
}

/** Dialog to add or edit a custom order source. */
function sourceDialog(existing) {
  const name = h("input.input", { id: "src-name", dir: "auto", value: existing?.name || "", placeholder: "למשל: וולט, פיצה מקומית" });
  const markup = h("input.input.num-in", { id: "src-markup", type: "number", min: "0", max: "200", step: "1", value: String(Math.round((existing?.markup || 0) * 100)) });
  const fee = h("input.input.num-in", { id: "src-fee", type: "number", min: "0", step: "1", value: String(existing?.fee || 0) });
  const phone = h("input.input", { id: "src-phone", type: "tel", dir: "ltr", value: existing?.phone || "", placeholder: "לא חובה", style: { "max-inline-size": "14rem" } });
  const dlg = openDialog(
    existing ? `הגדרות: ${existing.name}` : "הוספת מקור הזמנה",
    h(
      "form.stack",
      { onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) return name.focus();
        const src = { id: existing?.id || uid("src-"), name: name.value.trim(), markup: Math.max(0, Number(markup.value) || 0) / 100, fee: Math.max(0, Number(fee.value) || 0), min: 0, phone: phone.value.trim() };
        actions.saveSource(src);
        dlg.close();
        replaceQuery({ src: src.id });
        render(true);
      } },
      h("p.muted", "מחירי המנות יחושבו מהמחיר הטיפוסי של המנה בתוספת האחוז שתבחרו, ואפשר לערוך כל מחיר ידנית אחר כך."),
      h("div.field", h("label", { for: "src-name" }, "שם"), name),
      h("div.row", h("label", { for: "src-markup" }, "תוספת על מחיר התפריט (%):"), markup),
      h("div.row", h("label", { for: "src-fee" }, "דמי משלוח להזמנה (₪):"), fee),
      h("div.row", h("label", { for: "src-phone" }, "וואטסאפ (לא חובה):"), phone),
      h("div.row", h("button.btn.btn-green", { type: "submit" }, existing ? "שמירה" : "הוספה"), existing ? h("button.btn.btn-ghost", { type: "button", onclick: () => { if (confirm(`למחוק את ${existing.name}?`)) { actions.deleteSource(existing.id); dlg.close(); replaceQuery({}); render(true); } } }, icon("trash", { size: 18 }), "מחיקה") : null),
    ),
  );
  name.focus();
}

export function orderText(entries, total, c, src) {
  const lines = entries.map(([id, n]) => `${n} × ${c.recById.get(id).name}`);
  return [`שלום${src ? " " + src.name : ""}, אשמח להזמין:`, ...lines, `סה״כ לפי המחירון: ${plainMoney(total)}`, "תודה!"].join("\n");
}

/** Israeli mobile numbers to wa.me format: 050-1234567 -> 972501234567 */
export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  return d.length >= 9 ? "972" + d : "";
}
