// Service worker (generated into public/sw.js by tools/build-sw.js - edit this template, not the output).
// Strategy: precache the app shell + data on install; serve everything same-origin from cache first
// and refresh it in the background (stale-while-revalidate). Navigations fall back to the cached shell offline.
const VERSION = "548dc6a9a2";
const CACHE = `food-buttons-${VERSION}`;
const PRECACHE = [
  "./",
  "app.css",
  "data/ingredients.json",
  "data/prices.json",
  "data/recipes.json",
  "data/sources.json",
  "data/stores.json",
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
  "js/lib/derive.js",
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
