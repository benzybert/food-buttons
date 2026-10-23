import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { pageHead, moneyEl } from "../ui.js";
import { settings } from "../app.js";
import { percent } from "../fmt.js";
import { catalog } from "../app.js";
import { hebrewShort } from "../fmt.js";

let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
});

export function moreView() {
  const s = store.get();
  const links = [
    ["#/order", "store", "שרון", "תפריט, מחירון והזמנה בוואטסאפ"],
    ["/cart.html", "cart", "עגלה משותפת", "המצרכים של כל המשפחה, עם מחירים אמיתיים משופרסל וטיב טעם"],
    ["/groceries/", "tag", "מחירים אמיתיים במרכולים", "הדביקו רשימה או מתכון והשוו בין שופרסל לטיב טעם"],
    ["#/plan", "calendar", "תכנון שבועי", "מה אוכלים כל יום, כולל תכנון אוטומטי"],
    ["#/pantry", "bag", "מזווה", `מה יש בבית${s.pantry ? ` (${s.pantry.length} מצרכים)` : ""} ומה אפשר לבשל ממנו`],
    ["#/prices", "tag", "מחירים", "עדכון מחירי מצרכים לפי חנות"],
    ["#/import", "download", "ייבוא מתכון", "הדביקו מתכון מ-Cookidoo או מכל אתר"],
    ["#/surprise", "shuffle", "מה לאכול הערב?", "הצעה אקראית לפי ההעדפות והמזווה"],
    ["#/settings", "sliders", "הגדרות", "משק בית, חנויות, כשרות, תצוגה וגיבוי"],
    ["#/about", "info", "אודות ונגישות", "מקורות נתונים, פרטיות והצהרת נגישות"],
  ];
  const c = catalog();
  const cooked = [...s.cooked].reverse();
  const totalSaved = s.cooked.reduce((a, x) => a + Math.max(0, x.saved), 0);
  const journal = cooked.length
    ? h(
        "section.card",
        { style: { "margin-top": "1rem" }, "aria-labelledby": "journal-h" },
        h("div.spread", h("h2", { id: "journal-h" }, "יומן בישולים"), h("span.chip.good", "חסכתם ", moneyEl(totalSaved))),
        h("p.small.muted", `${cooked.length} בישולים. החיסכון הוא ההפרש מול ההזמנה הזולה ביותר, על המצרכים בלבד.`),
        settings().deviceCost > 0
          ? h("div", { style: { margin: "0.5rem 0" } }, h("div.spread", h("span.small.strong", "החזר השקעה במכשיר"), h("span.small", `${percent(Math.min(1, totalSaved / settings().deviceCost))} מתוך `, moneyEl(settings().deviceCost))), h("div.progress-track", { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(Math.min(100, (totalSaved / settings().deviceCost) * 100))), "aria-label": "החזר השקעה" }, h("span", { style: { "--w": String(Math.min(100, (totalSaved / settings().deviceCost) * 100)) } })))
          : null,
        h("ul.list-plain", cooked.slice(0, 8).map((x) => { const rec = c.recById.get(x.dishId); return h("li.shop-item", h("span", { "aria-hidden": "true", style: { "font-size": "1.4rem" } }, rec?.emoji || "🍽"), h("div.info", h("span.what", rec?.name || "מתכון שנמחק"), h("span.qty", `${hebrewShort(new Date(x.at))} · ${x.servings} מנות`)), x.saved > 0 ? h("span.price", { style: { color: "var(--good)" } }, "+", moneyEl(x.saved)) : null); })),
      )
    : null;
  const install = installEvent ? h("button.btn.btn-ghost", { type: "button", style: { "margin-top": "1rem" }, onclick: async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; } }, icon("download", { size: 20 }), "התקנה כאפליקציה במכשיר") : null;
  const iosHint = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone ? h("p.small.muted", { style: { "margin-top": "1rem" } }, "להתקנה באייפון: לחצו על ״שיתוף״ בדפדפן ואז על ״הוספה למסך הבית״.") : null;
  const el = h("div.page", pageHead("עוד"), h("nav.link-list", { "aria-label": "עוד" }, links.map(([href, ico, title, sub]) => h("a", { href }, icon(ico, { size: 24 }), h("span", title, h("small", sub))))), journal, install, iosHint);
  return { el, title: "עוד" };
}

export function notFoundView() {
  return { title: "לא נמצא", el: h("div.page", h("h1", "הדף לא נמצא"), h("p", "הקישור שגוי או שהדף הוסר."), h("a.btn", { href: "#/" }, "לדף הבית")) };
}
