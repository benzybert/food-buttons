# Data guide

## Files

| File | Source of truth? | Purpose |
|---|---|---|
| `data-src/ingredients.txt` | yes | Ingredient catalog: names/aliases, aisle, base unit, pack size, unit weight, density, dietary flags (no prices) |
| `data-src/recipes/*.txt` | yes | Recipes (compact Hebrew format, parsed with the same parser the in-app importer uses) |
| `public/data/ingredients.json`, `recipes.json` | generated | `npm run build:data` |
| `public/data/prices.json` | **yes** (hand/ingest-managed) | Prices per ingredient per store; **empty**, there is no sample data (see Prices below) |
| `public/data/price-history.json` | generated nightly | One price per ingredient, store and day (last 120 days), for "cheaper than usual" hints |
| `public/data/branches.json` | generated nightly | Branches from the chains' Stores files: id, name, address, city, and a position when one was found |
| `data-src/settlements.json` | yes (rebuilt by `tools/build-settlements.js`) | Settlement code -> [name, lat, lon], for the city codes in the chains' Stores files (MIT, `settlements.LICENSE`) |
| `data-src/geocache.json` | generated nightly | Address -> position cache for the branches (OpenStreetMap Nominatim), so each address is looked up once |
| `tools/price-rules.json` | yes | Per-ingredient matching rules for the price import (no prices) |
| `public/data/stores.json` | yes | Stores: id and name only. Delivery fee / free-over / minimum may be added later, from a real source |
| `public/data/sources.json` | yes | Order sources: `sharon` (menu) and `delivery` (app, markup + fee) |

## Ingredient line (`ingredients.txt`)

```
id | name | aliases | aisle | base | pack | unit weight (g) | density (g/ml) | flags
onion | בצל | בצלים,בצל יבש | produce | g | kg | 150 | 1 |
```

- `base`: `g`, `ml` or `u` (units, e.g. eggs). Everything is converted to this.
- `pack`: `kg` = sold loose by weight, price per kg, you buy in steps of 100 g; `unit` = sold per piece; `P500` = a sealed pack of 500 base units.
- `unit weight` lets "2 onions" and "300 g onion" mean the same thing; `density` lets "1 cup flour" become grams.
- Flags: `m` meat/poultry, `f` fish, `d` dairy, `e` egg, `h` honey, `a` animal-derived (parve), `g` gluten, `n` tree nuts, `p` peanuts, `s` sesame, `o` soy, `home` (assumed in the pantry), `free` (water).
  Kosher type (meat/dairy/parve), vegan/vegetarian/gluten-free tags and allergens are *derived* from these flags, never typed by hand.

## Recipe (`data-src/recipes/*.txt`)

```
@ chicken-soup
name: מרק עוף של שישי
emoji: 🍲
category: soup            # soup main side salad dip sauce breakfast bread dessert drink
servings: 6
prep: 15                  # active minutes
cook: 40                  # passive minutes
level: 1                  # 1-3
order: 32                 # optional: price of ONE ordered serving. Only from a real source; none ship with the app
tags: שישי, קלאסי
desc: One sentence.
ingredients:
- 700 גרם שוקי עוף        # free text; the parser resolves it to a catalog ingredient
steps:
1. הכניסו לקערה ... וקצצו 5 שנ'/מהירות 5.   # "5 שנ'/מהירות 5" style groups become setting chips and timers
```

Machine settings are written as `time/temperature/speed` groups: `5 דק'/100°C/מהירות 2`, `↺` for reverse, `Varoma`, `מהירות כף`, `תפקיד לישה`.

## Prices

`prices.json`: `{ meta: { kind, updated, note }, table: { ingredientId: { storeId: price | null } } }`

- The price is **per pack** (or per kg for loose items). `null` means "this store does not carry it" (the app treats it as unpriced: it never estimates).
- `meta.kind` is `"none"` while the file has no prices and `"real"` once it holds real ones (written by the ingest tool, with `meta.sources`: per chain the date, `scraper` or `kaggle`, and how many branches and products).
- **No invented prices, anywhere.** An unknown price is `null` and it spreads: a store total, a dish cost or a basket verdict that needs one is `null` too, never a partial sum and never an estimate. A test (`test/data.test.js`) fails if prices, reference prices, order prices, store fees or markups ship with `kind` other than `"real"`.
- Users can override any price in the app (`#/prices`); overrides live in their browser and win over the file.

### Getting real prices

Israeli supermarket chains are required to publish price files (XML/GZ, the "price transparency" files). Every night `.github/workflows/prices.yml` fetches them and commits the result:

1. `tools/fetch-prices.py` downloads, per chain in `stores.json`, up to 6 `PriceFull` files (one per branch) and the `Stores` file with [il-supermarket-scraper](https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers). Some chains block requests from outside Israel (GitHub's runners are in the US; Victory is one of them), so a chain that gives no price file falls back to the parsed CSVs of the daily [Kaggle dataset](https://www.kaggle.com/datasets/erlichsefi/israeli-supermarkets-2024), if the repo has the `KAGGLE_API_TOKEN` (or `KAGGLE_USERNAME` + `KAGGLE_KEY`) secret. Yeinot Bitan now publishes as Carrefour, so `yeinotbitan` gets no prices of its own.
2. `tools/ingest-prices.js --keep-missing` turns the files into `prices.json` (see its header for every option). A chain that failed tonight keeps its previous prices; `meta.sources` says per chain when and from where (`scraper` / `kaggle`) its prices were last refreshed, and the prices screen shows it.
3. The same run appends tonight's prices to `price-history.json` and writes `branches.json`; `tools/geocode-branches.js` then adds positions (at most 300 new lookups a night).
4. `npm run check`, then the commit. A push that changes this tooling runs the same steps without committing, so changes are tried on the real sites first. Each run uploads `match-report.txt` (what matched what) as an artifact.

How the matching works (and why: names in these files are messy, and a careless match prices "onion" from onion soup):

- **By name:** every word of an ingredient's name or alias, in order and next to each other, near the start of the product name (up to two brand words may come first, as in "לייף וולנס שמן זית"). Words are compared whole, after the plural stemmer, so "סוכר" does not match "סוכריות". What follows "עם", "ללא", "בטעם" and the like is a side component ("חמאה ללא מלח" is not salt). English aliases are skipped (they are for imported recipes).
- **Exclusions:** processed foods ("מרק", "סוכריות", "חטיף") and things that are not food ("שמן רחצה", "שמפו") are dropped, unless the word is part of the ingredient itself ("רוטב סויה").
- **Produce, meat and fish** (`kg` packs) are priced only from items sold by weight; a pack that names them ("טבעות בצל 500 גר") is another product. `packaged: true` in the rules allows packs for herbs and mushrooms.
- **By barcode:** a manufacturer barcode that matched by name in one chain stands for the same ingredient in every chain, so a chain that abbreviates the name ("ש.ז.") is still found. In-store codes (starting with 2) and short chain-internal codes never carry over, and a barcode claimed by two ingredients is ignored. `barcodes` in the rules adds known ones.
- **Price:** per gram / ml / unit, outliers more than 4x from the group's median dropped, then the median across products and branches, times the pack size. Fewer than 3 matches in a chain: no price there.

`tools/price-rules.json` holds per-ingredient `only`, `include`, `exclude`, `barcodes` and `packaged`; read `match-report.txt` and add a rule when a match is wrong. The tests run on cut-down real files from three chains (`test/fixtures/`).

You can still run the import by hand on files you downloaded: `node tools/ingest-prices.js --store shufersal=./downloads/shufersal --report`.

### Price history

`price-history.json`: `{ days: [...], table: { ingId: { storeId: [price | null, ...] } } }`, every array aligned with `days`. `null` = no price that day; nothing is filled in. The prices screen marks an imported price ↓ when it is at least 10% under its usual level (the median of the previous 30 days at that chain, from at least 7 days of data) and ↑ when 10% over, and lists the current drops. Prices the person typed in have no history and get no mark. Logic: `public/js/lib/history.js`.

### Branches

`branches.json`: `{ meta, branches: [{ store, id, name, address, city, cityCode?, zip, lat?, lon?, approx? }] }`. The chains publish a branch's city as a Central Bureau of Statistics settlement code (`<City>5000</City>`); `data-src/settlements.json` (1,264 settlements: code -> name, lat, lon; from the MIT-licensed npm package `israel-geolocation`, rebuilt with `tools/build-settlements.js`) turns it into the city name and a city-centre position (`approx: "city"`) without any request. OpenStreetMap's Nominatim is then asked only for the street address, cached in `data-src/geocache.json`; misses are retried after 60 days. The "סניפים קרובים" screen (`#/branches`) shows the nearest three branches of each enabled chain, by city or by the device's location; the location stays in the browser. Prices are chain-wide medians, not per branch.

### Credits and license

The scraper and the Kaggle dataset are by Sefi Erlich / [OpenIsraeliSupermarkets](https://github.com/OpenIsraeliSupermarkets), under a custom license that allows **non-commercial use only** and requires credit with a link and a note of changes. This project installs and calls them (nothing of theirs is copied into the repo), uses them non-commercially, and credits them on the About screen. Commercial use would need their written permission. Branch positions: © OpenStreetMap contributors (ODbL); settlement codes and centres: `israel-geolocation` (MIT).

### Order prices

Order prices are entered per dish and source in the app (`#/order` -> "עריכת מחירון") and live in the browser only. A recipe may carry an optional `order:` (price per serving) and a source an optional `markup` and `fee`, but only from a real source: none ship with the app, and without a price the dish simply has no order price (ordering from Sharon still works, with quantities only). Sources: `public/data/sources.json`.
