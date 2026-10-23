# Cookidoo link (optional)

The web app can search your own Cookidoo account and import a recipe into the normal editable importer (cost, shopping list, cook mode, price comparison all work on it). It does this through a small service you run yourself, `bridge/`. Nothing is wired in unless you set it up in the app's settings.

```
browser (food-buttons)  --token-->  bridge/ (Python, aiohttp)  --your login-->  Cookidoo
 knows: bridge URL + token           knows: Cookidoo email + password           (unofficial API)
 stores: nothing from Cookidoo       caches recipes in memory for 1 h only
 except recipes you saved
```

Why a service and not the browser: Cookidoo has no public API and its login is an OAuth flow meant for its own mobile app. [`cookidoo-api`](https://github.com/miaucl/cookidoo-api) (unofficial, reverse-engineered from the Android app) implements it in Python, so the login lives server-side and the browser only talks to the bridge.

## Is it allowed?

Read this before using it with an account you care about.

- The API is unofficial and undocumented. We have not checked Cookidoo's terms of service, and they may forbid automated access. You are using your own account for your own recipes; that is your call and your risk (the worst realistic outcome is the account being blocked).
- Recipes are copyrighted. The bridge keeps them in memory for an hour and never writes them to disk; the app saves a recipe only when you press save, in your browser. Do not commit imported recipes to the repo or publish them.
- The bridge limits itself to 60 requests per minute (`BRIDGE_RATE_LIMIT_PER_MINUTE`) so a bug or a loop cannot hammer Cookidoo.
- This project is not affiliated with Vorwerk, Thermomix or Cookidoo.

## Security model

- Every `/api/*` route needs `Authorization: Bearer <BRIDGE_TOKEN>`. The server refuses to start without a token of at least 24 characters, or without the Cookidoo credentials.
- CORS only allows the origins in `BRIDGE_ALLOWED_ORIGINS` (never `*`). A wrong token also counts against the rate limit.
- The web app's CSP stays `connect-src 'self'` unless the server is started with `BRIDGE_ORIGIN=<bridge origin>`; then exactly that one origin is added. Anything that is not a bare https origin (or http on localhost) is ignored.
- The token lives in the browser's local storage and is **left out of the backup file**. The Cookidoo password never reaches the browser.
- Errors returned to the browser say what kind of failure it was, never what the exception contained.
- Anyone who has the token can read recipes through your account, so treat it like a password. To rotate it, change `BRIDGE_TOKEN` on the service and paste the new one in the app.

## Run it locally

```sh
cd bridge
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

export COOKIDOO_EMAIL=you@example.com
export COOKIDOO_PASSWORD='...'
export COOKIDOO_COUNTRY=il          # default
export COOKIDOO_LANGUAGE=en         # default; see "Language" below
export BRIDGE_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
export BRIDGE_ALLOWED_ORIGINS=http://localhost:3000   # where the app is served from
python -m cookidoo_bridge           # http://127.0.0.1:8081
```

In another terminal, from the repo root: `BRIDGE_ORIGIN=http://localhost:8081 npm start` (the app is on `PORT`, default 3000). Open **Settings -> Cookidoo**, paste `http://localhost:8081` and the token, press "בדיקת חיבור" (test connection), then go to **Import a recipe** and search (in English).

## Deploy on Railway

The web app is one Railway service; the bridge is a second service in the same project.

1. New service from this repo, branch as for the web app, **Root Directory: `/bridge`** (Railpack picks Python from `requirements.txt` and `.python-version`; `bridge/railway.json` sets the start command and health check).
2. Variables on the bridge service: `COOKIDOO_EMAIL`, `COOKIDOO_PASSWORD`, `COOKIDOO_COUNTRY=il`, `COOKIDOO_LANGUAGE=en`, `BRIDGE_TOKEN` (generate your own), `BRIDGE_ALLOWED_ORIGINS=https://<your web app domain>`. Type the password in the Railway dashboard yourself; do not paste it into chats or commit it.
3. Generate a domain for the bridge service.
4. On the **web app** service add `BRIDGE_ORIGIN=https://<bridge domain>` and redeploy (it changes the CSP).
5. In the app: Settings -> Cookidoo -> address + token -> test.

## First real run: what to check

The bridge was written and tested without access to Cookidoo (no account, and the network of the development sandbox blocks it), against the library's own data types. The parts that depend on what Cookidoo really sends are the most likely to need a small adjustment:

- Login with `il` / `en`. If it says Cookidoo refused the login, check the email/password and try another country/language pair from the library's list.
- How step text looks. Run with `BRIDGE_DEBUG=1` and call `/api/recipe/<id>?raw=1` (with the token) to see the raw object next to the converted recipe. Check that machine settings come out as `5 min/100°C/speed 2`, that "reverse" and Varoma survive, and that nothing is glued together.
- How ingredient lines look (`200 g onions, peeled`). Unknown ingredients stay as free text and are listed as unmatched; the import screen lets you map them by hand.

If something is off, send the raw output of one recipe and the parser/converter can be fixed with a test.

## Language

For country `il` the library lists these Cookidoo languages: en, fr, el, hu, id, pt-BR, ro, zh-Hans, es, vi. There is no Hebrew, so imported recipes arrive in English (the app handles English quantities, units, ingredient names and Thermomix settings: `5 min/100°C/speed 2`, Varoma, reverse, turbo, dough mode). Ingredients that are not in the catalog are kept as free text without a price.

## What the MCP server (alexandrepa/mcp-cookidoo) is for

[`mcp-cookidoo`](https://github.com/alexandrepa/mcp-cookidoo) wraps the same library as MCP tools for an AI assistant (search, recipe details, and creating/updating *custom* recipes with Thermomix settings on your account). It talks stdio or MCP-over-HTTP, not a REST API a web page can call, which is why the bridge exists. They can run side by side with the same account. Its upload tools would be the natural base for a future "send this recipe to my Cookidoo" feature.

## Tests

- Node: `npm test` (client, parsing of English recipes, CSP, backups without the token) and `npm run e2e` (a stub bridge, no account needed).
- Python: `cd bridge && pip install -r requirements.txt && python -m unittest discover -s . -t . -p 'test_*.py'` (conversion with the library's real data classes, auth, CORS, rate limit, relogin, error leakage). `npm run check:bridge` runs the same.
