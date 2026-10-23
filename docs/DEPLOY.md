# Deploy

The app itself is static, but the site also has a shop (shared cart, real supermarket prices, Instinct feed) that needs the Node server. **Use Railway for the full site.** Vercel and Netlify serve only the static app: no `/api`, so the cart pages and real prices do not work there. All three configs are in the repo and the tests check that the security headers match `server.js`.

## Before going public

- [ ] Prices: the site ships with none. Decide how real ones arrive: people type them in ("מחירים"), or import real price files (`tools/ingest-prices.js`, see `docs/DATA.md`). Until then the cost screens say "no prices yet".
- [ ] Fill in the accessibility contact in `public/js/views/about.js` ("פרטי קשר לפניות נגישות"). The statement text was drafted automatically; have an accessibility specialist review it if this becomes a public business service.
- [ ] Decide what "שרון" is (a person, a restaurant, a service?) and set realistic menu prices/availability in `#/order` -> edit mode, or change `data-src/recipes/*.txt` `order:` values.
- [ ] `npm run check` and `npm run e2e` are green.

## Railway (Node server)

`railway.json` sets the `/healthz` health check and the restart policy; the start command is Railpack's default for Node (`npm run start`, which also runs `prestart`). It deliberately sets no `startCommand`: Railway reads this one file for every service of the repo (the config file path does not follow a service's Root Directory), so a start command here would also be forced onto the Python bridge service. `prestart` regenerates `public/sw.js` so the cache version always matches the files. Port comes from `PORT`.

```sh
railway up        # or connect the GitHub repo in the dashboard
```

The shop needs these variables on the web service (full table in the README): `ACCESS_KEY`, `DATA_DIR` (mount a volume there, e.g. `/data`, otherwise the cart is wiped on each deploy), `GROCERY_API_URL` and `GROCERY_API_TOKEN` (the price service). Without a volume or without `ACCESS_KEY` the site still starts; the cart just loses its data or uses a temporary key.

### Second service: grocery API

`grocery-api/` is a Python service (Root Directory `/grocery-api`, its own `railway.json`). Nothing in the web service's start command depends on it.

### Optional second service: Cookidoo bridge

`bridge/` is a separate Python service (Root Directory `/bridge`) and the web service needs `BRIDGE_ORIGIN=<its https origin>` to be allowed to call it. Steps, variables and security notes: [COOKIDOO.md](COOKIDOO.md). Do not set it up before you have decided you are comfortable using the unofficial Cookidoo API with your account.

## Vercel (static)

`vercel.json`: build command `npm run build`, output `public`, security headers, no-cache on code and data, immutable caching on fonts.

## Netlify (static)

`netlify.toml`: same.

## Notes

- Service worker: `public/sw.js` is generated (cache name = content hash). Static hosts run `npm run build`, which regenerates it; when deploying `public/` by hand, run `npm run build:sw` first.
- Hash routing (`#/dish/...`) means no rewrite rules are needed on any host.
- Custom domain + HTTPS are required for the service worker outside localhost (all three hosts provide HTTPS).
