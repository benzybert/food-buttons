import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, rawData, stores as storeList, settings } from "../app.js";
import { pageHead, notice, emptyState, toast } from "../ui.js";
import { render } from "../router.js";
import { cities, cityPoint, nearestBranches } from "../lib/geo.js";

// The device position, for this visit only: it is compared with the branch list in the browser and never stored or sent.
let here = null;

const km = (n) => (n < 1 ? `${Math.round(n * 1000 / 50) * 50} מ׳` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ק״מ`);
const mapsUrl = (b) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([b.address, b.city].filter(Boolean).join(", "))}`;

function locate() {
  if (!navigator.geolocation) return toast("הדפדפן לא תומך באיתור מיקום. בחרו עיר.");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      render(true);
    },
    () => toast("לא קיבלתי מיקום. אפשר לבחור עיר מהרשימה."),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

export function branchesView() {
  const c = catalog();
  const raw = rawData();
  const all = raw.branches;
  const city = settings().homeCity;
  const located = all.filter((b) => Number.isFinite(b.lat));
  const st = storeList();
  const point = here || (city ? cityPoint(located, city) : null);

  let body;
  if (!located.length) {
    body = emptyState("📍", "אין עדיין רשימת סניפים", "הרשימה נבנית מקובצי הסניפים שהרשתות מפרסמות, בעדכון הלילי. נסו שוב מחר.");
  } else if (!point) {
    body = h("p.muted", { style: { "margin-top": "1rem" } }, "בחרו עיר או השתמשו במיקום שלכם כדי לראות את הסניפים הקרובים.");
  } else {
    const near = nearestBranches(located, point, { stores: st.map((s) => s.id), perStore: 3, maxKm: 40 });
    body = near.length
      ? h(
          "div.grid.two",
          { style: { "margin-top": "1rem", "align-items": "start" } },
          near.map(({ store: sid, branches }) =>
            h(
              "section.card",
              { "aria-labelledby": `br-${sid}` },
              h("h2", { id: `br-${sid}`, style: { "font-size": "1.1rem" } }, c.storeById.get(sid)?.name || sid),
              h(
                "ul.list-plain",
                branches.map((b) =>
                  h(
                    "li.shop-item.wrap",
                    h("div.info", h("span.what", b.name || "סניף"), h("span.qty", [b.address, b.city].filter(Boolean).join(", ") || "אין כתובת")),
                    h("bdi.small", { title: b.approx === "city" ? "לפי מרכז העיר, בקירוב" : "" }, `${b.approx === "city" ? "~" : ""}${km(b.km)}`),
                    b.address || b.city ? h("a.btn.btn-ghost.btn-sm", { href: mapsUrl(b), target: "_blank", rel: "noopener noreferrer", "aria-label": `ניווט ל${b.name || "סניף"}` }, "ניווט") : null,
                  ),
                ),
              ),
            ),
          ),
        )
      : notice("info", "לא מצאתי סניף של הרשתות שבחרתם במרחק 40 ק״מ.");
  }

  const cityList = cities(located);
  const select = h(
    "select.input",
    {
      "aria-label": "עיר",
      onchange: (e) => {
        here = null;
        store.update((s) => void (s.settings.homeCity = e.target.value));
      },
    },
    h("option", { value: "" }, "בחרו עיר"),
    cityList.map((x) => h("option", { value: x, selected: x === city }, x)),
  );

  const el = h(
    "div.page.wide",
    pageHead("סניפים קרובים", "הסניפים הקרובים של הרשתות שבחרתם, לפי הכתובות שהרשתות מפרסמות"),
    located.length
      ? h(
          "div.row",
          { style: { gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } },
          h("button.btn", { type: "button", onclick: locate }, icon("search", { size: 18 }), "לפי המיקום שלי"),
          select,
          here ? h("span.small.muted", "לפי המיקום שלכם (לא נשמר ולא נשלח)") : null,
        )
      : null,
    body,
    located.length
      ? h(
          "p.small.muted",
          { style: { "margin-top": "1rem" } },
          `${located.length} סניפים עם מיקום מתוך ${all.length}. המרחק בקו אוויר; ~ = לפי מרכז העיר. המחירים באתר הם חציון של כמה סניפים בכל רשת, לא של סניף מסוים. מיקומים: © OpenStreetMap contributors.`,
        )
      : null,
  );
  return { el, title: "סניפים קרובים" };
}
