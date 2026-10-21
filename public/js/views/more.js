import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { pageHead } from "../ui.js";

export function moreView() {
  const s = store.get();
  const links = [
    ["#/order", "store", "שרון", "תפריט, מחירון והזמנה בוואטסאפ"],
    ["#/plan", "calendar", "תכנון שבועי", "מה אוכלים כל יום, כולל תכנון אוטומטי"],
    ["#/pantry", "bag", "מזווה", `מה יש בבית${s.pantry ? ` (${s.pantry.length} מצרכים)` : ""} ומה אפשר לבשל ממנו`],
    ["#/prices", "tag", "מחירים", "עדכון מחירי מצרכים לפי חנות"],
    ["#/import", "download", "ייבוא מתכון", "הדביקו מתכון מ-Cookidoo או מכל אתר"],
    ["#/surprise", "shuffle", "מה לאכול הערב?", "הצעה אקראית לפי ההעדפות והמזווה"],
    ["#/settings", "sliders", "הגדרות", "משק בית, חנויות, כשרות, תצוגה וגיבוי"],
    ["#/about", "info", "אודות ונגישות", "מקורות נתונים, פרטיות והצהרת נגישות"],
  ];
  const el = h("div.page", pageHead("עוד"), h("nav.link-list", { "aria-label": "עוד" }, links.map(([href, ico, title, sub]) => h("a", { href }, icon(ico, { size: 24 }), h("span", title, h("small", sub))))));
  return { el, title: "עוד" };
}

export function notFoundView() {
  return { title: "לא נמצא", el: h("div.page", h("h1", "הדף לא נמצא"), h("p", "הקישור שגוי או שהדף הוסר."), h("a.btn", { href: "#/" }, "לדף הבית")) };
}
