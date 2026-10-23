# Cookidoo link (optional)

The web app can search your own Cookidoo account and import a recipe into the normal editable importer (cost, shopping list, cook mode, price comparison all work on it). It does this through a small service you run yourself, `bridge/`. Nothing is wired in unless you set it up in the app's settings.

```
browser (food-buttons)  --token + session-->  bridge/ (Python, aiohttp)  --your login-->  Cookidoo
 knows: bridge URL, token,                    knows: the key (BRIDGE_SECRET); sees the      (unofficial API)
 and a sealed login session                   password only while logging in; caches
 (never the password)                         recipes in memory for 1 h only
```

## Two ways to give the bridge your account

| | **App login** (default, what the app's Settings uses) | **Fixed account** |
|---|---|---|
| Set on the bridge | `BRIDGE_TOKEN`, `BRIDGE_SECRET` | `BRIDGE_TOKEN`, `COOKIDOO_EMAIL`, `COOKIDOO_PASSWORD` |
| You type the password | once, in the app (Settings -> Cookidoo -> התחברות) | once, in the hosting dashboard |
| What the browser keeps | a sealed session, valid `BRIDGE_SESSION_DAYS` (30) | only the token |
| What the server keeps | nothing on disk. The password is in memory while the account is in use | the password, as a variable |
| Works for several accounts | yes | no |

How the app login works: you type the email and password in Settings; they go to `POST /api/login` over HTTPS **once**; the bridge logs in to Cookidoo to check them (so a typo is caught right away) and answers with a *session*: the email and password encrypted and authenticated (Fernet) under a key derived from `BRIDGE_SECRET`, with a timestamp. The app stores only that string and sends it as `X-Cookidoo-Session` with each request. The bridge opens it per request, so sessions survive restarts and nothing is saved on the server. Changing `BRIDGE_SECRET` signs everyone out. Logging out in the app forgets the session on that device (it cannot be revoked server-side before it expires, except by changing the secret). Browser password managers may offer to save the password you type; that is your choice.

Wrong passwords: after 5 in 15 minutes the login route refuses everything for the rest of the window, so a typo loop cannot get your Cookidoo account locked.

Why a service and not the browser: Cookidoo has no public API and its login is an OAuth flow meant for its own mobile app. [`cookidoo-api`](https://github.com/miaucl/cookidoo-api) (unofficial, reverse-engineered from the Android app) implements it in Python, so the login lives server-side and the browser only talks to the bridge.

## Is it allowed?

Read this before using it with an account you care about.

- The API is unofficial and undocumented. We have not checked Cookidoo's terms of service, and they may forbid automated access. You are using your own account for your own recipes; that is your call and your risk (the worst realistic outcome is the account being blocked).
- Recipes are copyrighted. The bridge keeps them in memory for an hour and never writes them to disk; the app saves a recipe only when you press save, in your browser. Do not commit imported recipes to the repo or publish them.
- The bridge limits itself to 60 requests per minute (`BRIDGE_RATE_LIMIT_PER_MINUTE`) so a bug or a loop cannot hammer Cookidoo.
- This project is not affiliated with Vorwerk, Thermomix or Cookidoo.

## Security model

- Every `/api/*` route needs `Authorization: Bearer <BRIDGE_TOKEN>`, including login: without it the bridge would be an open relay for trying passwords against Cookidoo. The server refuses to start without a token of at least 24 characters, or without either a fixed account or a `BRIDGE_SECRET` of at least 32.
- CORS only allows the origins in `BRIDGE_ALLOWED_ORIGINS` (never `*`). A wrong token also counts against the rate limit.
- The web app's CSP stays `connect-src 'self'` unless the server is started with `BRIDGE_ORIGIN=<bridge origin>`; then exactly that one origin is added. Anything that is not a bare https origin (or http on localhost) is ignored.
- The token and the login session live in the browser's local storage and are **left out of the backup file**. The Cookidoo password is not stored in the browser at all.
- Errors returned to the browser say what kind of failure it was, never what the exception contained.
- Anyone who has the token and a valid session can read recipes through your account, so treat both like passwords. To rotate the token, change `BRIDGE_TOKEN` and paste the new one in the app; to sign every session out, change `BRIDGE_SECRET`.

## Run it locally

```sh
cd bridge
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

export BRIDGE_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
export BRIDGE_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
export BRIDGE_ALLOWED_ORIGINS=http://localhost:3000   # where the app is served from
# defaults, change only if needed:
# export COOKIDOO_COUNTRY=il COOKIDOO_LANGUAGE=en
# fixed-account mode instead of app login: set COOKIDOO_EMAIL and COOKIDOO_PASSWORD (and BRIDGE_SECRET is then optional)
python -m cookidoo_bridge           # http://127.0.0.1:8081
```

In another terminal, from the repo root: `BRIDGE_ORIGIN=http://localhost:8081 npm start` (the app is on `PORT`, default 3000). Open **Settings -> Cookidoo**, paste `http://localhost:8081` and the token, press "בדיקת חיבור" (test connection), log in with your Cookidoo email and password, then go to **Import a recipe** and search (in English).

## Deploy on Railway

The web app is one Railway service; the bridge is a second service in the same project.

1. New service from this repo, branch as for the web app, **Root Directory: `/bridge`** (Railpack picks Python from `requirements.txt` and `.python-version`). Set the start command to `python -m cookidoo_bridge` in the service's Settings (the repo-root `railway.json` already provides the `/healthz` health check; `bridge/railway.json` is only used if you point the service's config file path at `/bridge/railway.json`).
2. Variables on the bridge service: `BRIDGE_TOKEN`, `BRIDGE_SECRET` (both random, different from each other), `COOKIDOO_COUNTRY=il`, `COOKIDOO_LANGUAGE=en`, `BRIDGE_ALLOWED_ORIGINS=https://<your web app domain>`. With app login there is no Cookidoo password on the server at all.
3. Generate a domain for the bridge service.
4. On the **web app** service add `BRIDGE_ORIGIN=https://<bridge domain>` and redeploy (it changes the CSP).
5. In the app: Settings -> Cookidoo -> address + token -> test -> email + password -> התחברות.

## First real run: what to check

The bridge was written and tested without access to Cookidoo (no account, and the network of the development sandbox blocks it), against the library's own data types. The parts that depend on what Cookidoo really sends are the most likely to need a small adjustment:

- Login with `il` / `en`. If the app says Cookidoo did not accept the email and password and you are sure they are right, the library's login flow may have been changed by Cookidoo (the message covers both). Try another country/language pair from the library's list, and check the bridge's logs.
- How step text looks. Run with `BRIDGE_DEBUG=1` and call `/api/recipe/<id>?raw=1` (with the token) to see the raw object next to the converted recipe. Check that machine settings come out as `5 min/100°C/speed 2`, that "reverse" and Varoma survive, and that nothing is glued together.
- How ingredient lines look (`200 g onions, peeled`). Unknown ingredients stay as free text and are listed as unmatched; the import screen lets you map them by hand.

If something is off, send the raw output of one recipe and the parser/converter can be fixed with a test.

## Language

For country `il` the library lists these Cookidoo languages: en, fr, el, hu, id, pt-BR, ro, zh-Hans, es, vi. There is no Hebrew, so imported recipes arrive in English (the app handles English quantities, units, ingredient names and Thermomix settings: `5 min/100°C/speed 2`, Varoma, reverse, turbo, dough mode). Ingredients that are not in the catalog are kept as free text without a price.

## What the MCP server (alexandrepa/mcp-cookidoo) is for

[`mcp-cookidoo`](https://github.com/alexandrepa/mcp-cookidoo) wraps the same library as MCP tools for an AI assistant (search, recipe details, and creating/updating *custom* recipes with Thermomix settings on your account). It talks stdio or MCP-over-HTTP, not a REST API a web page can call, which is why the bridge exists. They can run side by side with the same account. Its upload tools would be the natural base for a future "send this recipe to my Cookidoo" feature.

## Tests

- Node: `npm test` (client, parsing of English recipes, CSP, backups without the token) and `npm run e2e` (a stub bridge, no account needed).
- Python: `cd bridge && pip install -r requirements.txt && python -m unittest discover -s . -t . -p 'test_*.py'` (conversion with the library's real data classes, login and sealed sessions, auth, CORS, rate limits, relogin, error leakage). `npm run check:bridge` runs the same.
