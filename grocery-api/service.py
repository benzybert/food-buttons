"""Price comparison for a pasted ingredient list, built on the vendored israelgrocery code."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

VENDOR = Path(__file__).parent / "vendor" / "israelgrocery"
sys.path.insert(0, str(VENDOR))

# The vendored config writes session/debug folders relative to the working directory by default.
_STATE_ROOT = Path(tempfile.gettempdir()) / "israelgrocery"
for _var, _sub in (
    ("ISRAELGROCERY_STATE_DIR", "state"),
    ("ISRAELGROCERY_DEBUG_DIR", "debug"),
    ("ISRAELGROCERY_BROWSER_DIR", "browser"),
):
    os.environ.setdefault(_var, str(_STATE_ROOT / _sub))

from auth.session_store import MultiStoreSessionStore  # noqa: E402
from config import AppSettings  # noqa: E402
from matching.product_search import search_ingredient_across_stores  # noqa: E402
from models import IngredientIntent, IngredientMatch, StoreProduct, UserPreferences  # noqa: E402
from stores import build_registry  # noqa: E402

from hebrew import PACKAGE_UNITS, PIECE_UNITS, WEIGHT_UNITS, parse_ingredient_lines  # noqa: E402

log = logging.getLogger("grocery-api")

MAX_INGREDIENTS = 30
PER_INGREDIENT_TIMEOUT = 25.0
CONCURRENT_INGREDIENTS = 6
CACHE_TTL_SECONDS = 15 * 60
CACHE_MAX_ENTRIES = 500

STORE_NAMES = {"shufersal": "שופרסל", "tivtaam": "טיב טעם"}
STORE_SITES = {
    "shufersal": "https://www.shufersal.co.il",
    "tivtaam": "https://www.tivtaam.co.il",
}
ESTIMATE_NOTE = "ההערכה היא יחידה אחת מכל מוצר. ירקות במשקל מחושבים לפי הכמות במתכון (בערך 150 גרם ליחידה)."
GRAMS_PER_PIECE = 0.15  # kg, a rough tomato/onion/lemon
MIN_WEIGHABLE_KG = 0.1  # the smallest amount worth buying (a clove of garlic still means 100 g)


class CachedStore:
    """Remembers non-empty search results for a while so repeat lists don't hammer the stores."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.store_id: str = inner.store_id
        self.store_name: str = inner.store_name
        self._cache: dict[tuple[str, int], tuple[float, list[StoreProduct]]] = {}

    async def search(self, query: str, max_results: int = 8) -> list[StoreProduct]:
        key = (query.strip().lower(), max_results)
        hit = self._cache.get(key)
        now = time.monotonic()
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
        products = await self._inner.search(query, max_results=max_results)
        if products:  # an empty list may be a failed request, so don't remember it
            if len(self._cache) >= CACHE_MAX_ENTRIES:
                self._cache.pop(min(self._cache, key=lambda k: self._cache[k][0]))
            self._cache[key] = (now, products)
        return products


    async def probe(self, query: str) -> dict:
        """One live search with the status code and a body snippet, for the deploy log."""
        try:
            return await self._inner.raw_search(query)
        except Exception as exc:  # the probe must never take the service down
            return {"store": self.store_id, "error": repr(exc)}


_stores: Optional[list[CachedStore]] = None
_slots: Optional[asyncio.Semaphore] = None


def get_stores() -> list[CachedStore]:
    global _stores
    if _stores is None:
        settings = AppSettings()
        registry = build_registry(settings, MultiStoreSessionStore(settings.state_dir))
        _stores = [CachedStore(store) for store in registry.all()]
    return _stores


def estimate_amount(ingredient: IngredientIntent, product: StoreProduct) -> tuple[float, str]:
    """How much of the product to price: (multiplier of the listed price, Hebrew label)."""
    if product.is_weighable:
        if ingredient.unit in WEIGHT_UNITS:
            kg = ingredient.quantity * WEIGHT_UNITS[ingredient.unit]
        elif ingredient.unit in PIECE_UNITS:
            kg = ingredient.quantity * GRAMS_PER_PIECE
        else:
            kg = 0.5
        kg = max(kg, MIN_WEIGHABLE_KG)
        return kg, f"כ-{round(kg, 2):g} ק״ג"
    if ingredient.unit in PACKAGE_UNITS:
        count = max(1, math.ceil(ingredient.quantity))
        return float(count), f"{count} יח׳"
    return 1.0, "יח׳ אחת"


def _safe_url(url: str, store_id: str) -> str:
    site = STORE_SITES.get(store_id, "")
    return url if site and url.startswith(site + "/") else ""


def _offer(ingredient: IngredientIntent, product: StoreProduct, confidence: float) -> Optional[dict]:
    price = product.effective_price
    if price is None or not product.in_stock:
        return None
    amount, basis = estimate_amount(ingredient, product)
    size = product.size_text or (
        f"{product.weight:g} {product.weight_unit}".strip() if product.weight else ""
    )
    return {
        "name": product.name,
        "brand": product.brand,
        "size": size,
        "price": round(price, 2),
        "regular_price": round(product.price, 2) if product.is_on_sale and product.price else None,
        "on_sale": product.is_on_sale,
        "per_kg": product.is_weighable,
        "amount_basis": basis,
        "line_cost": round(price * amount, 2),
        "confidence": round(confidence, 2),
        "uncertain": confidence < 0.5,
        "url": _safe_url(product.product_url, product.store_id),
    }


def _ingredient_row(match: IngredientMatch, store_ids: list[str]) -> dict:
    ing = match.ingredient
    row: dict[str, Any] = {
        "raw": ing.raw,
        "name": ing.name,
        "quantity": ing.quantity,
        "unit": ing.unit,
        "skipped": match.skipped,
        "skip_reason": "מצרך יסוד" if match.skipped else "",
        "offers": {sid: None for sid in store_ids},
        "best_store": None,
    }
    for sid in store_ids:
        product = match.best_by_store.get(sid)
        if product is not None:
            row["offers"][sid] = _offer(ing, product, match.confidence_by_store.get(sid, 0.0))
    costs = {sid: o["line_cost"] for sid, o in row["offers"].items() if o}
    if costs:
        row["best_store"] = min(costs, key=costs.__getitem__)
    return row


def _summarise(rows: list[dict], stores: list[CachedStore]) -> dict:
    store_ids = [s.store_id for s in stores]
    shopping = [r for r in rows if not r["skipped"]]
    totals: dict[str, dict] = {}
    for sid in store_ids:
        priced = [r["offers"][sid]["line_cost"] for r in shopping if r["offers"][sid]]
        totals[sid] = {
            "name": STORE_NAMES.get(sid, sid),
            "site": STORE_SITES.get(sid, ""),
            "total": round(sum(priced), 2),
            "matched": len(priced),
            "missing": len(shopping) - len(priced),
            # Zero hits across a whole list means the store was unreachable, not out of stock.
            "available": bool(priced) or not shopping,
        }

    # A store that couldn't find an item looks cheap, so the one with more matches wins first.
    ranked = sorted((sid for sid in store_ids if totals[sid]["matched"]),
                    key=lambda sid: (-totals[sid]["matched"], totals[sid]["total"]))
    best = ranked[0] if ranked else None
    best_reason = ""
    if best:
        lowest = min(totals[sid]["total"] for sid in ranked)
        best_reason = "cheapest" if totals[best]["total"] <= lowest else "most_items"

    split_total = round(sum(
        min(o["line_cost"] for o in r["offers"].values() if o)
        for r in shopping if r["best_store"]
    ), 2)
    saving = 0.0
    if best:
        for r in shopping:
            if r["offers"][best]:
                cheapest_offer = min(o["line_cost"] for o in r["offers"].values() if o)
                saving += r["offers"][best]["line_cost"] - cheapest_offer
    return {
        "stores": totals,
        "best_store": best,
        "best_reason": best_reason,  # "cheapest" | "most_items"
        "split_total": split_total,
        "split_saving": round(saving, 2),
    }


async def probe_stores(query: str = "חלב") -> None:
    """Search each store once and log what came back, so a blocked store shows in the logs."""
    for store in get_stores():
        result = await store.probe(query)
        log.warning("store probe %s", json.dumps(result, ensure_ascii=False, default=str)[:700])


async def _match(ingredient: IngredientIntent, stores: list[CachedStore],
                 prefs: UserPreferences) -> IngredientMatch:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(CONCURRENT_INGREDIENTS)
    async with _slots:
        try:
            return await asyncio.wait_for(
                search_ingredient_across_stores(ingredient, stores, prefs),  # type: ignore[arg-type]
                PER_INGREDIENT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            return IngredientMatch(ingredient=ingredient, best_by_store={s.store_id: None for s in stores})


async def compare(text: str, title: str = "", include_pantry: bool = False,
                  stores: Optional[list[CachedStore]] = None) -> dict:
    ingredients = parse_ingredient_lines(text)
    if not ingredients:
        raise ValueError("לא זיהיתי מצרכים. כתבו מצרך בכל שורה, למשל: 2 כוסות קמח")
    if len(ingredients) > MAX_INGREDIENTS:
        raise ValueError(f"יותר מדי מצרכים ({len(ingredients)}). המקסימום הוא {MAX_INGREDIENTS}")

    stores = stores if stores is not None else get_stores()
    prefs = UserPreferences(shopping_strategy="cheapest", skip_pantry=not include_pantry)
    matches = await asyncio.gather(*(_match(i, stores, prefs) for i in ingredients))

    rows = [_ingredient_row(m, [s.store_id for s in stores]) for m in matches]
    summary = _summarise(rows, stores)
    for sid, totals in summary["stores"].items():
        if not totals["available"]:
            log.warning("store %s found nothing for %d ingredients", sid, len(rows))
    return {
        "title": title.strip(),
        "ingredients": rows,
        "note": ESTIMATE_NOTE,
        **summary,
    }
