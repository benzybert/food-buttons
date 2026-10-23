# Data guide

## Files

| File | Source of truth? | Purpose |
|---|---|---|
| `data-src/ingredients.txt` | yes | Ingredient catalog: names/aliases, aisle, base unit, pack size, unit weight, density, dietary flags (no prices) |
| `data-src/recipes/*.txt` | yes | Recipes (compact Hebrew format, parsed with the same parser the in-app importer uses) |
| `public/data/ingredients.json`, `recipes.json` | generated | `npm run build:data` |
| `public/data/prices.json` | **yes** (hand/ingest-managed) | Prices per ingredient per store; **empty**, there is no sample data (see Prices below) |
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
- `meta.kind` is `"none"` while the file has no prices and `"real"` once it holds real ones (written by the ingest tool). The shipped file is `{ meta: { kind: "none" }, table: {} }`.
- **No invented prices, anywhere.** An unknown price is `null` and it spreads: a store total, a dish cost or a basket verdict that needs one is `null` too, never a partial sum and never an estimate. A test (`test/data.test.js`) fails if prices, reference prices, order prices, store fees or markups ship with `kind` other than `"real"`.
- Users can override any price in the app (`#/prices`); overrides live in their browser and win over the file.

### Getting real prices

Israeli supermarket chains are required to publish price files (XML/GZ, the "price transparency" files). `tools/ingest-prices.js` turns a folder of such files into `prices.json`; see its header for usage. It matches products to the catalog by name and uses the **median unit price** of the matches to avoid brand outliers (matches more than 4x away from the median of their own group are dropped; there is no reference price to compare against). Always run it with `--report` first and read the matches: product names in these files are messy, and the tool was written against the documented file format and fixtures, not against live files.

### Order prices

Order prices are entered per dish and source in the app (`#/order` -> "עריכת מחירון") and live in the browser only. A recipe may carry an optional `order:` (price per serving) and a source an optional `markup` and `fee`, but only from a real source: none ship with the app, and without a price the dish simply has no order price (ordering from Sharon still works, with quantities only). Sources: `public/data/sources.json`.
