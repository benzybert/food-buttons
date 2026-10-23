# cookidoo-bridge

A small HTTP service between the food-buttons web app and one Cookidoo account. Full guide, security notes and the Railway recipe: [`../docs/COOKIDOO.md`](../docs/COOKIDOO.md).

```
GET /healthz                  open; { ok, configured }
GET /api/ping                 token check, does not call Cookidoo
GET /api/search?q=&ingredients=a,b&maxMinutes=45&page=0&pageSize=12
GET /api/recipe/<id>          schema.org Recipe JSON-LD (what the app's importer reads)
```

All `/api` routes need `Authorization: Bearer $BRIDGE_TOKEN`.

| Variable | Required | Default | |
|---|---|---|---|
| `COOKIDOO_EMAIL`, `COOKIDOO_PASSWORD` | yes | | the account |
| `BRIDGE_TOKEN` | yes | | at least 24 characters |
| `BRIDGE_ALLOWED_ORIGINS` | for browsers | none | comma-separated, e.g. `https://food.example.com` |
| `COOKIDOO_COUNTRY`, `COOKIDOO_LANGUAGE` | no | `il`, `en` | |
| `BRIDGE_RATE_LIMIT_PER_MINUTE` | no | `60` | |
| `BRIDGE_DEBUG` | no | off | `1` enables `?raw=1` on the recipe route |
| `PORT`, `HOST` | no | 8081 on 127.0.0.1 (0.0.0.0 when `PORT` is set) | |

```sh
pip install -r requirements.txt
python -m cookidoo_bridge
python -m unittest discover -s . -t . -p 'test_*.py'
```

Unofficial: it uses [`cookidoo-api`](https://github.com/miaucl/cookidoo-api), which is not endorsed by Cookidoo or Vorwerk.
