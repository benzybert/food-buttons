import json

import pytest
from starlette.testclient import TestClient

import service
from models import StoreProduct


class FakeStore:
    def __init__(self, store_id, catalog):
        self.store_id, self.store_name = store_id, store_id.title()
        self.catalog, self.calls = catalog, []

    async def raw_search(self, query):
        return {"store": self.store_id, "status": 403, "sample": "Access Denied"}

    async def search(self, query, max_results=8):
        self.calls.append(query)
        return [p.model_copy() for key, p in self.catalog.items() if key in query]


def product(store_id, name, price, **kw):
    return StoreProduct(store_id=store_id, product_id=name, name=name, price=price, **kw)


@pytest.fixture
def stores():
    shufersal = FakeStore("shufersal", {
        "קמח": product("shufersal", "קמח לבן שופרסל 1 ק״ג", 6.9,
                       product_url="https://www.shufersal.co.il/online/he/p/1"),
        "חלב": product("shufersal", "חלב תנובה 3% 1 ליטר", 7.5, is_on_sale=True, sale_price=6.0),
        "עגבניות": product("shufersal", "עגבניות", 9.9, is_weighable=True),
        "שום": product("shufersal", "שום ארוז", 5.0, product_url="javascript:alert(1)"),
    })
    tivtaam = FakeStore("tivtaam", {
        "קמח": product("tivtaam", "קמח חיטה לבן 1 ק״ג", 5.5),
        "חלב": product("tivtaam", "חלב טרה 3% 1 ליטר", 7.0),
        "עגבניות": product("tivtaam", "עגבניות", 12.0, is_weighable=True),
    })
    return [service.CachedStore(shufersal), service.CachedStore(tivtaam)], shufersal, tivtaam


async def test_compare_prices_totals_and_split(stores):
    cached, _, _ = stores
    result = await service.compare("2 כוסות קמח\n1 ליטר חלב\n500 גרם עגבניות", "שקשוקה", stores=cached)

    by_name = {r["name"]: r for r in result["ingredients"]}
    assert by_name["קמח"]["best_store"] == "tivtaam"
    assert by_name["חלב"]["best_store"] == "shufersal"        # sale price 6.0 beats 7.0
    assert by_name["חלב"]["offers"]["shufersal"]["regular_price"] == 7.5
    assert by_name["עגבניות"]["best_store"] == "shufersal"
    assert by_name["עגבניות"]["offers"]["shufersal"]["line_cost"] == 4.95  # 500 g * 9.9

    totals = result["stores"]
    assert totals["shufersal"]["total"] == round(6.9 + 6.0 + 4.95, 2)
    assert totals["tivtaam"]["total"] == round(5.5 + 7.0 + 6.0, 2)
    assert result["best_store"] == "shufersal"              # 17.85 vs 18.50
    assert result["best_reason"] == "cheapest"
    assert result["split_total"] == round(5.5 + 6.0 + 4.95, 2)
    assert result["split_saving"] == round(6.9 - 5.5, 2)   # only flour is cheaper elsewhere


@pytest.mark.parametrize("line, kg", [
    ("500 גרם עגבניות", 0.5),
    ("1.5 ק\"ג עגבניות", 1.5),
    ("3 עגבניות", 0.45),           # ~150 g each
    ("2 שיני שום", 0.3),
    ("1 כוס עגבניות", 0.5),        # volume of produce: no good guess, half a kilo
    ("50 גרם עגבניות", 0.1),       # never less than 100 g
])
async def test_weighable_amounts(stores, line, kg):
    cached, _, _ = stores
    cached[0]._inner.catalog["שום"] = product("shufersal", "שום", 10.0, is_weighable=True)
    result = await service.compare(line, stores=cached)
    offer = result["ingredients"][0]["offers"]["shufersal"]
    price = 10.0 if "שום" in line else 9.9
    assert offer["line_cost"] == pytest.approx(price * kg, abs=0.01)
    assert offer["amount_basis"].startswith("כ-")


async def test_package_units_count_whole_packages(stores):
    cached, shufersal, _ = stores
    shufersal.catalog["עגבניות מרוסקות"] = product("shufersal", "עגבניות מרוסקות", 4.0)
    result = await service.compare("2 קופסאות עגבניות מרוסקות", stores=cached)
    assert result["ingredients"][0]["offers"]["shufersal"]["line_cost"] == 8.0


async def test_unsafe_product_urls_are_dropped(stores):
    cached, _, _ = stores
    result = await service.compare("שום\n2 כוסות קמח", stores=cached)
    by_name = {r["name"]: r for r in result["ingredients"]}
    assert by_name["שום"]["offers"]["shufersal"]["url"] == ""
    assert by_name["קמח"]["offers"]["shufersal"]["url"] == "https://www.shufersal.co.il/online/he/p/1"


async def test_pantry_items_skipped_unless_requested(stores):
    cached, _, _ = stores
    result = await service.compare("2 כוסות קמח\nקורט מלח", stores=cached)
    salt = next(r for r in result["ingredients"] if r["name"] == "קורט מלח")
    assert salt["skipped"] and salt["skip_reason"]
    assert result["stores"]["tivtaam"]["missing"] == 0

    included = await service.compare("2 כוסות קמח\nקורט מלח", include_pantry=True, stores=cached)
    assert not next(r for r in included["ingredients"] if r["name"] == "קורט מלח")["skipped"]


async def test_store_with_no_hits_is_flagged_unavailable(stores):
    cached, _, tivtaam = stores
    tivtaam.catalog.clear()
    result = await service.compare("2 כוסות קמח\n1 ליטר חלב", stores=cached)
    assert result["stores"]["tivtaam"]["available"] is False
    assert result["stores"]["shufersal"]["available"] is True
    assert result["best_store"] == "shufersal"


async def test_cheapest_prefers_the_store_with_more_matches(stores):
    cached, _, tivtaam = stores
    del tivtaam.catalog["חלב"]
    del tivtaam.catalog["עגבניות"]  # tivtaam is cheaper on flour but only has 1 of 3
    result = await service.compare("2 כוסות קמח\n1 ליטר חלב\n500 גרם עגבניות", stores=cached)
    assert result["stores"]["tivtaam"]["total"] < result["stores"]["shufersal"]["total"]
    assert result["best_store"] == "shufersal"
    assert result["best_reason"] == "most_items"


async def test_search_results_are_cached(stores):
    cached, shufersal, _ = stores
    await service.compare("2 כוסות קמח", stores=cached)
    await service.compare("3 כוסות קמח", stores=cached)
    assert shufersal.calls.count("קמח") == 1


async def test_empty_results_are_not_cached(stores):
    cached, shufersal, _ = stores
    await service.compare("מוצר לא קיים", stores=cached)
    await service.compare("מוצר לא קיים", stores=cached)
    assert shufersal.calls.count("מוצר לא קיים") == 2


async def test_rejects_empty_and_oversized_lists(stores):
    cached, _, _ = stores
    with pytest.raises(ValueError, match="לא זיהיתי"):
        await service.compare("מצרכים:\n\n", stores=cached)
    with pytest.raises(ValueError, match="יותר מדי"):
        await service.compare("\n".join(f"מצרך{chr(1488 + i % 26)}{i}" for i in range(31)), stores=cached)


@pytest.fixture
def client(stores, monkeypatch):
    cached, _, _ = stores
    monkeypatch.setattr(service, "_stores", cached)
    import app
    monkeypatch.setattr(app, "API_TOKEN", "")
    with TestClient(app.app) as c:
        yield c, app


def test_http_compare_ok(client):
    c, _ = client
    r = c.post("/compare", json={"text": "2 כוסות קמח", "title": "פנקייק"})
    assert r.status_code == 200
    assert r.json()["title"] == "פנקייק"
    assert c.get("/health").json() == {"ok": True}


@pytest.mark.parametrize("body, status", [
    (b"not json", 400),
    (json.dumps({"nope": 1}).encode(), 400),
    (json.dumps({"text": 5}).encode(), 400),
    (json.dumps({"text": "x" * 6001}).encode(), 413),
    (b"{" + b" " * 40000 + b"}", 413),
    (json.dumps({"text": "מצרכים:"}).encode(), 400),
])
def test_http_rejects_bad_requests(client, body, status):
    c, _ = client
    r = c.post("/compare", content=body)
    assert r.status_code == status
    assert r.json()["error"]


def test_http_token_required_when_configured(client, monkeypatch):
    c, app = client
    monkeypatch.setattr(app, "API_TOKEN", "s3cret")
    assert c.post("/compare", json={"text": "קמח"}).status_code == 401
    assert c.post("/compare", json={"text": "קמח"}, headers={"x-api-key": "wrong"}).status_code == 401
    assert c.post("/compare", json={"text": "קמח"}, headers={"x-api-key": "s3cret"}).status_code == 200
    assert c.get("/health").status_code == 200


async def test_probe_logs_what_each_store_returned(stores, monkeypatch, caplog):
    cached, _, _ = stores
    monkeypatch.setattr(service, "_stores", cached)
    with caplog.at_level("WARNING", logger="grocery-api"):
        await service.probe_stores()
    probes = [r.getMessage() for r in caplog.records if "store probe" in r.getMessage()]
    assert len(probes) == 2 and all('"status": 403' in p and "Access Denied" in p for p in probes)


async def test_probe_survives_a_store_that_raises(stores, monkeypatch, caplog):
    cached, shufersal, _ = stores

    async def boom(query):
        raise RuntimeError("tunnel closed")

    shufersal.raw_search = boom
    monkeypatch.setattr(service, "_stores", cached)
    with caplog.at_level("WARNING", logger="grocery-api"):
        await service.probe_stores()
    assert any("tunnel closed" in r.getMessage() for r in caplog.records)


async def test_unavailable_store_is_logged(stores, caplog):
    cached, _, tivtaam = stores
    tivtaam.catalog.clear()
    with caplog.at_level("WARNING", logger="grocery-api"):
        await service.compare("2 כוסות קמח", stores=cached)
    assert any("store tivtaam found nothing" in r.getMessage() for r in caplog.records)


def test_service_starts_even_if_probing_fails(client, monkeypatch):
    async def explode():
        raise RuntimeError("no network")

    c, app = client
    monkeypatch.setattr(service, "probe_stores", explode)
    with TestClient(app.app) as fresh:
        assert fresh.get("/health").status_code == 200
