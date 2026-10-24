# Ideas not built (yet)

Roughly by value / effort. Everything here is optional.

**Real data**
- Built: the nightly job, matching rules, barcodes across chains, price history with "cheaper than usual" hints, and the branch list (see `docs/DATA.md`).
- Prices per branch (today a chain-wide median): pick "my branch" on the branches screen and price from its own file.
- Promotions (the chains' PromoFull files): "on sale this week" next to the price.
- Show the price trend on the dish and compare screens, not only on the prices screen.

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
