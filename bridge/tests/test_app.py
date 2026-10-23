import asyncio
import unittest
from types import SimpleNamespace

from aiohttp.test_utils import TestClient, TestServer

from cookidoo_api.exceptions import CookidooAuthException, CookidooRequestException
from cookidoo_api.types import CookidooSearchRecipeHit, CookidooSearchResult

from cookidoo_bridge.app import create_app
from cookidoo_bridge.service import CookidooService
from cookidoo_bridge.settings import SettingsError, load_settings

from .test_convert import details

TOKEN = "t" * 32
ORIGIN = "https://food.example.com"
ENV = {"COOKIDOO_EMAIL": "me@example.com", "COOKIDOO_PASSWORD": "s3cret-pass", "BRIDGE_TOKEN": TOKEN, "BRIDGE_ALLOWED_ORIGINS": ORIGIN}
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class FakeClient:
    def __init__(self, fail_auth_times=0, fail_with=None):
        self.calls = []
        self.fail_auth_times = fail_auth_times
        self.fail_with = fail_with

    async def search_recipes(self, query, **kwargs):
        self.calls.append(("search", query, kwargs))
        if self.fail_with:
            raise self.fail_with
        if self.fail_auth_times:
            self.fail_auth_times -= 1
            raise CookidooAuthException("token expired: secret-token-123")
        return CookidooSearchResult(recipes=[CookidooSearchRecipeHit(id="r1", name="Soup", thumbnail="t", image=None, url="u")], total=1)

    async def get_recipe_details(self, recipe_id):
        self.calls.append(("recipe", recipe_id))
        if self.fail_with:
            raise self.fail_with
        return details(id=recipe_id)


def make_service(client=None, settings=None):
    client = client or FakeClient()
    created = []

    async def factory():
        created.append(1)
        return client

    return CookidooService(settings or load_settings(ENV), client_factory=factory), client, created


class Api(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.service, self.fake, self.logins = make_service()
        self.client = TestClient(TestServer(create_app(load_settings(ENV), self.service)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_healthz_is_open(self):
        r = await self.client.get("/healthz")
        self.assertEqual(r.status, 200)
        self.assertEqual(await r.json(), {"ok": True, "configured": True})

    async def test_api_needs_the_token(self):
        for headers in ({}, {"Authorization": "Bearer nope"}, {"Authorization": TOKEN}, {"Authorization": f"bearer {TOKEN}"}):
            r = await self.client.get("/api/search?q=soup", headers=headers)
            self.assertEqual(r.status, 401, headers)
        self.assertEqual(self.logins, [], "no Cookidoo login happens for unauthorized callers")
        r = await self.client.get("/api/recipe/r1")
        self.assertEqual(r.status, 401)

    async def test_ping_checks_the_token_without_calling_cookidoo(self):
        self.assertEqual((await self.client.get("/api/ping")).status, 401)
        r = await self.client.get("/api/ping", headers=AUTH)
        self.assertEqual((r.status, await r.json()), (200, {"ok": True}))
        self.assertEqual(self.logins, [])

    async def test_search(self):
        r = await self.client.get("/api/search?q=soup&ingredients=onion,%20carrot&maxMinutes=45&pageSize=5", headers=AUTH)
        self.assertEqual(r.status, 200)
        self.assertEqual(await r.json(), {"total": 1, "page": 0, "recipes": [{"id": "r1", "name": "Soup", "thumbnail": "t", "url": "u"}]})
        _, query, kwargs = self.fake.calls[0]
        self.assertEqual(query, "soup")
        self.assertEqual(kwargs["ingredients"], ["onion", "carrot"])
        self.assertEqual(kwargs["total_time"], 45 * 60)
        self.assertEqual(kwargs["page_size"], 5)

    async def test_search_validation(self):
        self.assertEqual((await self.client.get("/api/search", headers=AUTH)).status, 400)
        self.assertEqual((await self.client.get("/api/search?q=a&page=x", headers=AUTH)).status, 400)
        r = await self.client.get("/api/search?q=a&pageSize=9999", headers=AUTH)
        self.assertEqual(r.status, 200)
        self.assertEqual(self.fake.calls[-1][2]["page_size"], 30, "page size is capped")

    async def test_recipe(self):
        r = await self.client.get("/api/recipe/r12345", headers=AUTH)
        self.assertEqual(r.status, 200)
        body = await r.json()
        self.assertEqual(body["@type"], "Recipe")
        self.assertEqual(body["name"], "Tomato soup")
        self.assertNotIn("raw", body)

    async def test_recipe_id_is_validated_and_cached(self):
        for bad in ("..%2F..%2Fetc", "a%20b", "x" * 41):
            r = await self.client.get(f"/api/recipe/{bad}", headers=AUTH)
            self.assertIn(r.status, (400, 404), bad)
        await self.client.get("/api/recipe/r1", headers=AUTH)
        await self.client.get("/api/recipe/r1", headers=AUTH)
        self.assertEqual([c for c in self.fake.calls if c[0] == "recipe"], [("recipe", "r1")], "second request is served from memory")

    async def test_cors_only_for_listed_origins(self):
        ok = await self.client.options("/api/search", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "GET"})
        self.assertEqual(ok.status, 204)
        self.assertEqual(ok.headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertIn("Authorization", ok.headers["Access-Control-Allow-Headers"])
        bad = await self.client.options("/api/search", headers={"Origin": "https://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", bad.headers)
        err = await self.client.get("/api/search?q=a", headers={"Origin": ORIGIN})
        self.assertEqual(err.status, 401)
        self.assertEqual(err.headers["Access-Control-Allow-Origin"], ORIGIN, "the browser can read the 401")
        self.assertEqual(err.headers["Cache-Control"], "no-store")

    async def test_rate_limit(self):
        app = create_app(load_settings({**ENV, "BRIDGE_RATE_LIMIT_PER_MINUTE": "3"}), self.service)
        async with TestClient(TestServer(app)) as client:
            statuses = [(await client.get("/api/search?q=a", headers=AUTH)).status for _ in range(5)]
            self.assertEqual(statuses, [200, 200, 200, 429, 429])
            r = await client.get("/api/search?q=a", headers=AUTH)
            self.assertIn("Retry-After", r.headers)
            self.assertEqual((await client.get("/healthz")).status, 200, "health checks are not limited")

    async def test_wrong_tokens_use_up_the_limit_too(self):
        app = create_app(load_settings({**ENV, "BRIDGE_RATE_LIMIT_PER_MINUTE": "2"}), self.service)
        async with TestClient(TestServer(app)) as client:
            statuses = [(await client.get("/api/search?q=a", headers={"Authorization": "Bearer x"})).status for _ in range(3)]
            self.assertEqual(statuses, [401, 401, 429])

    async def test_unexpected_errors_do_not_leak(self):
        class Boom(FakeClient):
            async def search_recipes(self, query, **kwargs):
                raise RuntimeError("secret-token-123 in https://x/?token=abc")

        service, _, _ = make_service(Boom())
        async with TestClient(TestServer(create_app(load_settings(ENV), service))) as client:
            with self.assertLogs("cookidoo_bridge", level="ERROR"):
                r = await client.get("/api/search?q=a", headers={**AUTH, "Origin": ORIGIN})
            body = await r.text()
        self.assertEqual(r.status, 500)
        self.assertNotIn("secret-token-123", body)
        self.assertEqual(r.headers["Access-Control-Allow-Origin"], ORIGIN)

    async def test_unknown_route_is_json(self):
        r = await self.client.get("/nope")
        self.assertEqual(r.status, 404)
        self.assertEqual((await r.json())["error"], "http_error")


class UpstreamErrors(unittest.IsolatedAsyncioTestCase):
    async def run_with(self, client):
        service, fake, logins = make_service(client)
        async with TestClient(TestServer(create_app(load_settings(ENV), service))) as c:
            r = await c.get("/api/search?q=soup", headers=AUTH)
            return r.status, await r.json(), fake, logins

    async def test_expired_session_logs_in_again_once(self):
        status, _, fake, logins = await self.run_with(FakeClient(fail_auth_times=1))
        self.assertEqual(status, 200)
        self.assertEqual(len(logins), 2)
        self.assertEqual(len(fake.calls), 2)

    async def test_persistent_auth_failure_is_a_clear_502_without_leaking_details(self):
        status, body, _, logins = await self.run_with(FakeClient(fail_auth_times=5))
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "cookidoo_auth")
        self.assertNotIn("secret-token-123", str(body))
        self.assertEqual(len(logins), 2, "it does not loop")

    async def test_other_failures_are_502(self):
        status, body, _, _ = await self.run_with(FakeClient(fail_with=CookidooRequestException("GET https://x/?token=abc failed")))
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "cookidoo_unavailable")
        self.assertNotIn("token=abc", str(body))


class Settings(unittest.TestCase):
    def test_refuses_to_start_without_secrets(self):
        for missing in ("COOKIDOO_EMAIL", "COOKIDOO_PASSWORD", "BRIDGE_TOKEN"):
            env = {k: v for k, v in ENV.items() if k != missing}
            with self.assertRaises(SettingsError) as ctx:
                load_settings(env)
            self.assertIn(missing, str(ctx.exception))

    def test_short_token_is_refused(self):
        with self.assertRaises(SettingsError):
            load_settings({**ENV, "BRIDGE_TOKEN": "short"})

    def test_origins_are_validated(self):
        for bad in ("*", "food.example.com", "https://a.example/path"):
            with self.assertRaises(SettingsError, msg=bad):
                load_settings({**ENV, "BRIDGE_ALLOWED_ORIGINS": bad})
        s = load_settings({**ENV, "BRIDGE_ALLOWED_ORIGINS": "https://a.example/, http://localhost:3000"})
        self.assertEqual(s.allowed_origins, ("https://a.example", "http://localhost:3000"))

    def test_binds_to_loopback_unless_a_platform_sets_port(self):
        self.assertEqual(load_settings(ENV).host, "127.0.0.1")
        s = load_settings({**ENV, "PORT": "9000"})
        self.assertEqual((s.host, s.port), ("0.0.0.0", 9000))

    def test_secrets_are_not_in_repr(self):
        text = repr(load_settings(ENV))
        for secret in (TOKEN, "s3cret-pass", "me@example.com"):
            self.assertNotIn(secret, text)


if __name__ == "__main__":
    unittest.main()
