# grocery-api

Small HTTP API behind the "קנה מצרכים" button on the site. It takes an ingredient list, searches Shufersal and
Tiv Taam, and returns the best match per store, totals per store and a split-basket recommendation.
The search, ranking and store adapters are the ones from
[israelgrocerymcp](https://github.com/danielJL-altius/israelgrocerymcp) (copied into `vendor/`, see `vendor/README.md`).

Not taken from the MCP: the recipe parser (it only understands English units, so Hebrew lines are parsed in
`hebrew.py`) and the totals (upstream multiplies the price by the recipe quantity, which makes "500 g flour"
cost 500 packages). Cart, login and Playwright are not used: the API only reads public search results.

## Endpoints

- `POST /compare` with `{"text": "2 כוסות קמח\n3 ביצים", "title": "שקשוקה", "include_pantry": false}`
- `GET /health`

The Node server proxies `/api/compare` and `/api/health` to it.

## Run locally

```bash
cd grocery-api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # no network needed, stores are faked
uvicorn app:app --port 8001
GROCERY_API_URL=http://127.0.0.1:8001 npm start   # from the repo root
```

## Deploy on Railway

A second service in the same project, next to the site:

1. New service from this repo, **Root Directory** `grocery-api` (`railway.json` sets the start command and health check).
2. Set `API_TOKEN` to a random string (optional but recommended).
3. On the site service set `GROCERY_API_URL` to the API's private address (`http://<service-name>.railway.internal:<PORT>`)
   or its public domain, and `GROCERY_API_TOKEN` to the same token as `API_TOKEN`.

Without `GROCERY_API_URL` the site still works; the groceries page shows "שירות המצרכים עוד לא מחובר לאתר".
