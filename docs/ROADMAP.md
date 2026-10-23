# Ideas not built (yet)

Roughly by value / effort. Everything here is optional.

**Real data**
- Nightly job (server or GitHub Action) that downloads the chains' price files, runs `tools/ingest-prices.js`, and commits `prices.json`. Needs a verified list of download URLs/credentials per chain.
- Match more products with per-ingredient rules in `tools/price-rules.json` (the tool reads it; no rules shipped yet).
- Price history per ingredient (needs the nightly job) -> "cheaper than usual" hints.

**Cooking**
- Cook several dishes at once with one merged timeline.
- Notifications when a timer ends while the tab is in the background (Notification API / Web Push).
- Ingredient substitutions ("no cooking cream? milk + cornstarch") as curated data.
- Macros (protein/carbs/fat), not only kcal.
- Verified Thermomix settings per model (TM5/TM6/TM7) and a "my model" setting.

**Shopping**
- Deep links to the chains' online carts (needs each chain's SKU mapping).
- Barcode scanner to record a real price in the store (BarcodeDetector API).
- "Shop mode" per store with aisle order for that store.

**Sharing / sync**
- Optional account + sync across devices (the only feature that needs a backend).
- Shared household list with live ticking.

**Product**
- Seasonal produce hints; holiday menus (Rosh Hashanah, Pesach).
- Weekly summary: spent, saved, calories.
- English UI.
