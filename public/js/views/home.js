import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { report, catalog } from "../app.js";
import { moneyEl } from "../ui.js";
import { hebrewDate } from "../fmt.js";

export function homeView() {
  const s = store.get();
  const count = s.basket.length;
  let basketLine = null;
  if (count) {
    const rep = report();
    basketLine = h("span", `בסל ${count} מנות · קנייה `, moneyEl(rep.cookTotal), rep.saving > 0 ? [" · חיסכון ", moneyEl(rep.saving), " מול הזמנה"] : null);
  }
  const month = new Date().toISOString().slice(0, 7);
  const savedMonth = s.cooked.filter((c) => c.at.startsWith(month)).reduce((a, c) => a + Math.max(0, c.saved), 0);

  const weekday = new Date().getDay();
  const shabbat = weekday === 4 || weekday === 5 ? h("a", { href: "#/cook?q=%D7%A9%D7%99%D7%A9%D7%99" }, "מתכוננים לשבת? מתכונים לשישי") : null;
  const el = h(
    "div.home",
    h(
      "div.home-buttons",
      h("a.big", { id: "sharon", href: "#/order" }, h("span.kicker", "הזמנת אוכל דרך"), h("span.name", "שרון"), h("span.hint", "לראות תפריט ולהזמין")),
      h("a.big", { id: "thermomix", href: "#/cook" }, h("span.kicker", "הזמנת אוכל דרך"), h("span.name", { lang: "en", dir: "ltr" }, "Thermomix"), h("span.hint", `${catalog().recipes.length} מתכונים לבחירה`)),
    ),
    h(
      "nav.quick",
      { "aria-label": "קיצורי דרך" },
      h("a", { href: "#/compare" }, h("span.ico", icon("scale", { size: 24 })), h("span", "השוואת מחירים", h("small", basketLine ? basketLine : "לבשל או להזמין?"))),
      h("a", { href: "#/list" }, h("span.ico", icon("list", { size: 24 })), h("span", "רשימת קניות", h("small", count ? "מוכנה מהסל" : "מכל המתכונים בסל"))),
      h("a", { href: "#/plan" }, h("span.ico", icon("calendar", { size: 24 })), h("span", "תכנון שבועי", h("small", "מה אוכלים השבוע"))),
      h("a", { href: "#/surprise" }, h("span.ico", icon("shuffle", { size: 24 })), h("span", "מה לאכול הערב?", h("small", "תנו לנו להחליט"))),
    ),
    h(
      "div.home-foot",
      h("span", hebrewDate()),
      savedMonth > 0 ? h("span", "חסכתם החודש ", moneyEl(savedMonth), " בבישול ביתי") : null,
      shabbat,
      h("a", { href: "#/more" }, "עוד"),
    ),
  );
  return { el, title: "" };
}
