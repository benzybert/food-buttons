# Data guide

## Files

| File | Source of truth? | Purpose |
|---|---|---|
| `data-src/ingredients.txt` | yes | Ingredient catalog: names/aliases, aisle, base unit, pack size, reference price, unit weight, density, dietary flags |
| `data-src/recipes/*.txt` | yes | Recipes (compact Hebrew format, parsed with the same parser the in-app importer uses) |
| `public/data/ingredients.json`, `recipes.json` | generated | `npm run build:data` |
| `public/data/prices.json` | **yes** (hand/ingest-managed) | Prices per ingredient per store; currently *sample* data |
| `public/data/stores.json` | yes | Stores, index (sample), delivery fee / free-over / minimum |
| `public/data/sources.json` | yes | Order sources: `sharon` (menu) and `delivery` (app, markup + fee) |

## Ingredient line (`ingredients.txt`)

```
id | name | aliases | aisle | base | pack | ref price | unit weight (g) | density (g/ml) | flags
onion | בצל | בצלים,בצל יבש | produce | g | kg | 6 | 150 | 1 |
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
order: 32                 # typical price of ONE serving when ordered (shekel)
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

- The price is **per pack** (or per kg for loose items). `null` means "this store does not carry it" (the app then estimates and flags it).
- `meta.kind: "sample"` makes every price screen show the "sample data" banner. Set it to anything else (e.g. `"real"`) once the data is real.
- Regenerate sample data with `npm run prices:sample` (deterministic). **That overwrites `prices.json`.**
- Users can override any price in the app (`#/prices`); overrides live in their browser and win over the file.

### Getting real prices

Israeli supermarket chains are required to publish price files (XML/GZ, the "price transparency" files). `tools/ingest-prices.js` turns a folder of such files into `prices.json`; see its header for usage. It matches products to the catalog by name and uses the **median unit price** of the matches to avoid brand outliers. Always run it with `--report` first and read the matches: product names in these files are messy, and the tool was written against the documented file format and fixtures, not against live files.

### Order prices

Each recipe has `order:` (typical price per serving). Sharon's price = `order` x `sources.sharon.markup` (0); the delivery app = `order` x (1 + markup) plus a flat fee per order. Both can be edited per dish in the app (`#/order` -> "עריכת מחירון").
