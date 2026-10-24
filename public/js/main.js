import { h, $, clear, append } from "./dom.js";
import { icon } from "./icons.js";
import { store } from "./store.js";
import { loadData, catalog, report } from "./app.js";
import { route, start, render, onRouteRender, parseHash } from "./router.js";
import { money, recipesWord } from "./fmt.js";
import { moneyEl, toast } from "./ui.js";
import { homeView } from "./views/home.js";
import { browseView } from "./views/browse.js";
import { dishView } from "./views/dish.js";

const NAV = [
  { href: "#/", label: "בית", icon: "home", match: (p) => p === "/" },
  { href: "#/cook", label: "מתכונים", icon: "book", match: (p) => p === "/cook" || p.startsWith("/dish") || p.startsWith("/import") },
  { href: "#/compare", label: "השוואה", icon: "scale", match: (p) => p === "/compare", badge: true },
  { href: "#/list", label: "קניות", icon: "list", match: (p) => p === "/list" },
  { href: "#/more", label: "עוד", icon: "more", match: (p) => ["/more", "/order", "/plan", "/pantry", "/prices", "/settings", "/about", "/surprise"].includes(p) },
];
const TOP = [
  ["#/cook", "מתכונים"],
  ["#/order", "שרון"],
  ["#/compare", "השוואת מחירים"],
  ["#/list", "רשימת קניות"],
  ["#/plan", "תכנון שבועי"],
  ["#/pantry", "מזווה"],
  ["#/prices", "מחירים"],
  ["#/settings", "הגדרות"],
];

let ownsTheme = false; // true once we set data-theme ourselves; never remove one the host page set

function applySettings() {
  const s = store.get().settings;
  const root = document.documentElement;
  if (s.theme !== "auto") {
    root.setAttribute("data-theme", s.theme);
    ownsTheme = true;
  } else if (ownsTheme) {
    root.removeAttribute("data-theme");
    ownsTheme = false;
  }
  root.setAttribute("data-text", String(s.textSize));
}

function buildChrome() {
  const tabbar = $("#tabbar");
  clear(tabbar).append(
    ...NAV.map((n) => h("a", { href: n.href, "data-nav": n.href }, icon(n.icon, { size: 24 }), h("span", n.label), n.badge ? h("span.badge", { id: "tab-badge", hidden: true }) : null)),
  );
  clear($("#nav-top")).append(...TOP.map(([href, label]) => h("a", { href, "data-nav": href }, label)));
}

function updateChrome(path) {
  const home = path === "/";
  const cooking = /^\/cook\/[\w-]+$/.test(path);
  document.body.classList.toggle("cooking", cooking);
  $("#site-header").hidden = home;
  $("#tabbar").hidden = home;

  for (const a of document.querySelectorAll("[data-nav]")) {
    const href = a.getAttribute("data-nav");
    const n = NAV.find((x) => x.href === href);
    const active = n ? n.match(path) : path === href.slice(1);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const count = store.get().basket.length;
  const badge = $("#tab-badge");
  if (badge) {
    badge.hidden = !count;
    badge.textContent = String(count);
    badge.setAttribute("aria-label", `${recipesWord(count)} בסל`);
  }
  const pill = $("#basket-pill");
  if (count) {
    let total = null;
    try {
      total = report().cookTotal;
    } catch {
      /* data not ready */
    }
    pill.hidden = false;
    append(clear(pill), [icon("cart", { size: 18 }), recipesWord(count), total != null ? [" · ", moneyEl(total)] : null]);
    pill.setAttribute("aria-label", `סל: ${recipesWord(count)}${total != null ? `, ${money(total)}` : ""}`);
  } else pill.hidden = true;
}

function mount(result, { keep }) {
  const main = $("#main");
  main.className = "";
  clear(main).append(result.el);
  document.title = result.title ? `${result.title} · הזמנת אוכל` : "הזמנת אוכל";
  updateChrome(parseHash().path);
  if (!keep) {
    main.focus({ preventScroll: true });
  }
}

async function boot() {
  store.init();
  applySettings();
  buildChrome();

  try {
    await loadData();
  } catch (err) {
    clear($("#main")).append(
      h("div.page", h("div.notice.bad", icon("alert"), h("div", h("p", "טעינת הנתונים נכשלה."), h("p.small", String(err.message))), h("button.btn", { onclick: () => location.reload() }, "נסו שוב"))),
    );
    return;
  }
  catalog();

  route(/^\/$/, homeView);
  route(/^\/cook$/, browseView);
  route(/^\/dish\/([\w-]+)$/, dishView);
  const lazy = (file, name) => async (ctx) => (await import(`./views/${file}.js`))[name](ctx);
  route(/^\/cook\/([\w-]+)$/, lazy("cook", "cookView"));
  route(/^\/order$/, lazy("order", "orderView"));
  route(/^\/compare$/, lazy("compare", "compareView"));
  route(/^\/list$/, lazy("list", "listView"));
  route(/^\/plan$/, lazy("plan", "planView"));
  route(/^\/pantry$/, lazy("pantry", "pantryView"));
  route(/^\/prices$/, lazy("prices", "pricesView"));
  route(/^\/branches$/, lazy("branches", "branchesView"));
  route(/^\/import(?:\/([\w-]+))?$/, lazy("import", "importView"));
  route(/^\/settings$/, lazy("settings", "settingsView"));
  route(/^\/about$/, lazy("about", "aboutView"));
  route(/^\/more$/, lazy("more", "moreView"));
  route(/^\/surprise$/, lazy("surprise", "surpriseView"));
  route(/.*/, lazy("more", "notFoundView"), { fallback: true });

  onRouteRender(mount, (err) => ({
    title: "שגיאה",
    el: h(
      "div.page",
      h("div.notice.bad", icon("alert"), h("div", h("h1", { style: { "font-size": "1.4rem" } }, "משהו השתבש במסך הזה"), h("p.small", String(err?.message || err)), h("p", "אפשר לחזור לדף הבית. אם הבעיה חוזרת, ייתכן שנתונים שמורים פגומים: אפשר לאפס אותם בהגדרות."), h("div.row", h("a.btn", { href: "#/" }, "לדף הבית"), h("a.btn.btn-ghost", { href: "#/settings" }, "להגדרות"), h("button.btn.btn-ghost", { type: "button", onclick: () => confirm("למחוק את כל הנתונים השמורים?") && (store.reset(), location.hash = "#/", location.reload()) }, "איפוס נתונים")))),
    ),
  }));

  let queued = false;
  store.subscribe(() => {
    applySettings();
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      render(true);
    });
  });

  await start();
  try {
    if ("serviceWorker" in navigator && location.protocol !== "file:" && !globalThis.__FB_DATA__) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register("sw.js").catch(() => {});
      // A new version took over while the app is open: offer a reload (not on the very first install).
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) toast("יצאה גרסה חדשה של האפליקציה", { label: "רענון", onClick: () => location.reload() });
      });
    }
  } catch {
    /* service workers are unavailable (sandboxed frame, private mode): the app works without them */
  }
}

boot();
