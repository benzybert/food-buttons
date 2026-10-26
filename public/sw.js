// Service worker (generated into public/sw.js by tools/build-sw.js - edit this template, not the output).
// Strategy: precache the app shell + data on install; serve everything same-origin from cache first
// and refresh it in the background (stale-while-revalidate). Navigations fall back to the cached shell offline.
// The shop (shared cart, real prices) and /api are live data: the worker never touches them, so the cart
// can never be served stale or stored in a cache.
const VERSION = "501fd03a59";
const CACHE = `food-buttons-${VERSION}`;
const PRECACHE = [
  "./",
  "app.css",
  "data/branches.json",
  "data/ingredients.json",
  "data/price-history.json",
  "data/prices.json",
  "data/recipes.json",
  "data/sources.json",
  "data/stores.json",
  "favicon.svg",
  "fonts/alef-he-400.woff2",
  "fonts/alef-he-700.woff2",
  "fonts/alef-latin-400.woff2",
  "fonts/alef-latin-700.woff2",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon-maskable.svg",
  "icons/icon.svg",
  "index.html",
  "js/app.js",
  "js/dom.js",
  "js/fmt.js",
  "js/icons.js",
  "js/lib/calc.js",
  "js/lib/catalog.js",
  "js/lib/cookidoo.js",
  "js/lib/derive.js",
  "js/lib/geo.js",
  "js/lib/history.js",
  "js/lib/ics.js",
  "js/lib/parse.js",
  "js/lib/plan.js",
  "js/lib/text.js",
  "js/lib/units.js",
  "js/main.js",
  "js/router.js",
  "js/store.js",
  "js/ui.js",
  "js/views/about.js",
  "js/views/branches.js",
  "js/views/browse.js",
  "js/views/compare.js",
  "js/views/cook.js",
  "js/views/dish.js",
  "js/views/home.js",
  "js/views/import.js",
  "js/views/list.js",
  "js/views/more.js",
  "js/views/order.js",
  "js/views/pantry.js",
  "js/views/plan.js",
  "js/views/prices.js",
  "js/views/settings.js",
  "js/views/surprise.js",
  "manifest.webmanifest",
  "style.css"
];
const NETWORK_ONLY = ["/api/","/cart.html","/cart.css","/cart.js","/to-cart.js","/app.js","/shop.css","/menu.json","/groceries/","/sharon/","/thermomix/"]; // "dir/" = prefix, anything else = exact path
const isNetworkOnly = (pathname) => NETWORK_ONLY.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("food-buttons-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isNetworkOnly(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === "navigate") return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
      return Response.error();
    }),
  );
});
