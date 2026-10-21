# Deploy

The app is static. Pick one; all three configs are in the repo and the tests check that the security headers match `server.js`.

## Before going public

- [ ] Replace sample prices (or keep the banner on: it is automatic while `prices.json` has `meta.kind: "sample"`).
- [ ] Fill in the accessibility contact in `public/js/views/about.js` ("פרטי קשר לפניות נגישות"). The statement text was drafted automatically; have an accessibility specialist review it if this becomes a public business service.
- [ ] Decide what "שרון" is (a person, a restaurant, a service?) and set realistic menu prices/availability in `#/order` -> edit mode, or change `data-src/recipes/*.txt` `order:` values.
- [ ] `npm run check` and `npm run e2e` are green.

## Railway (Node server)

`railway.json` sets `npm start` and the `/healthz` health check. `prestart` regenerates `public/sw.js` so the cache version always matches the files. Port comes from `PORT`.

```sh
railway up        # or connect the GitHub repo in the dashboard
```

## Vercel (static)

`vercel.json`: build command `npm run build`, output `public`, security headers, no-cache on code and data, immutable caching on fonts.

## Netlify (static)

`netlify.toml`: same.

## Notes

- Service worker: `public/sw.js` is generated (cache name = content hash). Static hosts run `npm run build`, which regenerates it; when deploying `public/` by hand, run `npm run build:sw` first.
- Hash routing (`#/dish/...`) means no rewrite rules are needed on any host.
- Custom domain + HTTPS are required for the service worker outside localhost (all three hosts provide HTTPS).
