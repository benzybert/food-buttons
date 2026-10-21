// "שרון": the order side. A priced menu, a cart, and a WhatsApp message to send.
// Menu prices are editable (and a dish can be switched off) because the bundled prices are samples.

import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings, actions, stores as storeList } from "../app.js";
import { render } from "../router.js";
import { pageHead, moneyEl, stepper, emptyState, notice, toast, dishInfo } from "../ui.js";
import { money, percent } from "../fmt.js";
import { CATEGORY_LABELS } from "../lib/catalog.js";
import { dishCostByStore, round2 } from "../lib/calc.js";
import { norm } from "../lib/text.js";

const SHARON = "sharon";
let editing = false;
let searchText = "";

export function orderView() {
  const c = catalog();
  const s = store.get();
  const sharon = c.sourceById.get(SHARON);
  const delivery = c.sources.find((x) => x.id !== SHARON);
  const off = new Set(s.orderOff[SHARON] || []);
  const cart = s.orderCart;

  const unit = (id) => c.orderPrice(id, SHARON);
  const setCart = (id, n) =>
    store.update((x) => {
      if (n > 0) x.orderCart[id] = Math.min(30, n);
      else delete x.orderCart[id];
    });

  // dishes grouped by category
  const list = c.recipes.filter((r) => (editing || !off.has(r.id)) && (!searchText || norm(r.name + " " + (r.tags || []).join(" ")).includes(norm(searchText))));
  const byCat = new Map();
  for (const r of list) (byCat.get(r.category) || byCat.set(r.category, []).get(r.category)).push(r);

  const row = (rec) => {
    const price = unit(rec.id);
    const info = dishInfo(rec.id);
    const qty = cart[rec.id] || 0;
    const isOff = off.has(rec.id);
    if (editing) {
      const input = h("input.input.num-in", { type: "number", min: "0", step: "1", inputmode: "decimal", value: price != null ? String(price) : "", "aria-label": `מחיר למנה: ${rec.name}`, "data-fk": `price-${rec.id}`, onchange: (e) => actions.setOrderPrice(rec.id, SHARON, Number(e.target.value)) });
      return h(
        "li.shop-item",
        h("span", { "aria-hidden": "true", style: { "font-size": "1.5rem" } }, rec.emoji),
        h("div.info", h("span.what", rec.name), h("span.qty", s.orderPrices[rec.id]?.[SHARON] != null ? "מחיר מותאם" : "מחיר לדוגמה")),
        input,
        h("label.check", h("input", { type: "checkbox", checked: !isOff, "aria-label": `${rec.name} מוצע אצל שרון`, onchange: (e) => actions.setOrderOff(SHARON, rec.id, !e.target.checked) }), h("span.small", "מוצע")),
        s.orderPrices[rec.id]?.[SHARON] != null ? h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => actions.setOrderPrice(rec.id, SHARON, 0) }, "איפוס") : null,
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

  // cart summary
  const entries = Object.entries(cart).filter(([id]) => c.recById.has(id) && !off.has(id));
  const total = round2(entries.reduce((a, [id, n]) => a + (unit(id) || 0) * n, 0));
  const count = entries.reduce((a, [, n]) => a + n, 0);

  const summary = entries.length ? orderSummary(entries, total, count, c, sharon, delivery) : null;

  const search = h("input.input", { type: "search", dir: "auto", placeholder: "חיפוש בתפריט", "aria-label": "חיפוש בתפריט", value: searchText, "data-fk": "order-q", oninput: debounce((e) => ((searchText = e.target.value.trim()), render(true)), 150) });

  const el = h(
    "div.page",
    pageHead("הזמנה דרך שרון", "בוחרים מנות, רואים כמה זה עולה מול בישול בבית, ושולחים", h("button.btn.btn-ghost.btn-sm", { type: "button", "aria-pressed": String(editing), onclick: () => ((editing = !editing), render(true)) }, icon("pencil", { size: 16 }), editing ? "סיום עריכה" : "עריכת מחירון")),
    notice("warn", "מחירי התפריט הם הערכות לדוגמה. אפשר לעדכן כל מחיר ב״עריכת מחירון״ כדי שההשוואות יהיו מדויקות.", "alert"),
    h("div.search", { style: { margin: "1rem 0" } }, icon("search", { size: 22 }), search),
    editing ? notice("info", "מצב עריכה: שנו מחיר למנה, או בטלו מנה שלא מוצעת. השינויים נשמרים בדפדפן הזה.") : null,
    list.length ? groups : emptyState("🔍", "לא נמצאו מנות", "נסו חיפוש אחר."),
    summary,
  );
  return { el, title: "שרון" };
}

function orderSummary(entries, total, count, c, sharon, delivery) {
  const set = settings();
  // what the same dishes cost to cook
  let cook = 0;
  const st = storeList();
  for (const [id, n] of entries) cook += dishCostByStore(c.recById.get(id), n, c, st)[0].total;
  cook = round2(cook);
  const saving = round2(total - cook);

  const text = orderText(entries, total, c, sharon);
  const phone = normalizePhone(set.sharonPhone);

  const phoneInput = h("input.input", { type: "tel", inputmode: "tel", dir: "ltr", placeholder: "050-1234567", value: set.sharonPhone || "", "aria-label": "מספר וואטסאפ של שרון", "data-fk": "sharon-phone", style: { "max-inline-size": "14rem" }, onchange: (e) => store.update((x) => void (x.settings.sharonPhone = e.target.value.trim())) });

  const deliveryTotal = delivery ? round2(entries.reduce((a, [id, n]) => a + (c.orderPrice(id, delivery.id) || 0) * n, 0) + (delivery.fee || 0)) : null;

  return h(
    "section.card",
    { style: { "margin-top": "1.25rem", position: "sticky", "inset-block-end": "4.5rem", "box-shadow": "0 0.5rem 2rem rgb(0 0 0 / 0.25)" }, "aria-labelledby": "cart-h" },
    h("div.spread", h("h2", { id: "cart-h" }, `ההזמנה שלכם: ${count} מנות`), h("span.strong", { style: { "font-size": "1.5rem" } }, moneyEl(total))),
    h(
      "p.small.muted",
      { style: { margin: "0.25rem 0 0.5rem" } },
      saving > 0 ? ["בישול אותן מנות בבית יעלה ", moneyEl(cook), " ", h("span.chip.good", "חיסכון ", moneyEl(saving))] : ["בישול אותן מנות בבית יעלה ", moneyEl(cook), " (ההזמנה זולה יותר)"],
      deliveryTotal != null ? [" · באפליקציית משלוחים: ", moneyEl(deliveryTotal)] : null,
    ),
    h(
      "div.row",
      h("a.btn.btn-green", { href: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, icon("whatsapp", { size: 20 }), phone ? "שליחה לשרון בוואטסאפ" : "שליחה בוואטסאפ"),
      h("button.btn.btn-ghost", { type: "button", onclick: () => (navigator.clipboard?.writeText(text).then(() => toast("ההזמנה הועתקה"), () => toast("ההעתקה נכשלה"))) }, icon("copy", { size: 20 }), "העתקה"),
      h("button.btn.btn-ghost", { type: "button", onclick: () => (entries.forEach(([id, n]) => actions.addToBasket(id, n)), toast("המנות נוספו לסל הבישול", { label: "להשוואה", href: "#/compare" })) }, icon("cart", { size: 20 }), "לבשל במקום"),
      h("button.btn-link", { type: "button", onclick: () => store.update((x) => void (x.orderCart = {})) }, "ניקוי"),
    ),
    !phone ? h("div.row", { style: { "margin-top": "0.6rem" } }, h("label", { for: "sharon-phone" }, "מספר של שרון (לשליחה ישירה):"), Object.assign(phoneInput, { id: "sharon-phone" })) : h("p.small.muted", { style: { margin: "0.5rem 0 0" } }, "נשלח אל ", h("bdi.ltr", set.sharonPhone), " · ", h("button.btn-link", { type: "button", onclick: () => store.update((x) => void (x.settings.sharonPhone = "")) }, "שינוי מספר")),
  );
}

export function orderText(entries, total, c, sharon) {
  const lines = entries.map(([id, n]) => `${n} × ${c.recById.get(id).name}`);
  return [`שלום${sharon ? " " + sharon.name : ""}, אשמח להזמין:`, ...lines, `סה״כ לפי המחירון: ${money(total)}`, "תודה!"].join("\n");
}

/** Israeli mobile numbers to wa.me format: 050-1234567 -> 972501234567 */
export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  return d.length >= 9 ? "972" + d : "";
}
