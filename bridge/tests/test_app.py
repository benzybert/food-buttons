import asyncio
import unittest
from types import SimpleNamespace

from aiohttp.test_utils import TestClient, TestServer

from cookidoo_api.exceptions import CookidooAuthException, CookidooRequestException
from cookidoo_api.types import CookidooSearchRecipeHit, CookidooSearchResult

from cookidoo_bridge.app import create_app
from cookidoo_bridge.service import CookidooService, ServicePool
from cookidoo_bridge.sessions import SessionSealer
from cookidoo_bridge.settings import SettingsError, load_settings

from .test_convert import details

TOKEN = "t" * 32
ORIGIN = "https://food.example.com"
ENV = {"COOKIDOO_EMAIL": "me@example.com", "COOKIDOO_PASSWORD": "s3cret-pass", "BRIDGE_TOKEN": TOKEN, "BRIDGE_ALLOWED_ORIGINS": ORIGIN}
SECRET = "k" * 40
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


def make_pool(client=None, settings=None, per_account=None):
    """A ServicePool whose services use fake Cookidoo clients. per_account: {email: client}; default: one shared client."""
    client = client or FakeClient()
    settings = settings or load_settings(ENV)
    created = []

    def factory(email, password):
        async def login():
            created.append(email)
            if (per_account or {}).get(email, client) is None:
                raise CookidooAuthException("bad credentials")
            return (per_account or {}).get(email, client)

        return CookidooService(settings, email, password, client_factory=login)

    return ServicePool(settings, factory), client, created


def make_service(client=None, settings=None):
    pool, client, created = make_pool(client, settings)
    return pool, client, created


class Api(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.service, self.fake, self.logins = make_pool()
        self.client = TestClient(TestServer(create_app(load_settings(ENV), self.service)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_healthz_is_open(self):
        r = await self.client.get("/healthz")
        self.assertEqual(r.status, 200)
        self.assertEqual(await r.json(), {"ok": True, "configured": True, "sessions": False})

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
        self.assertEqual((r.status, await r.json()), (200, {"ok": True, "loggedIn": True, "canLogin": False, "fixedAccount": True}))
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

        pool, _, _ = make_pool(Boom())
        async with TestClient(TestServer(create_app(load_settings(ENV), pool))) as client:
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
        pool, fake, logins = make_pool(client)
        async with TestClient(TestServer(create_app(load_settings(ENV), pool))) as c:
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
    def test_refuses_to_start_without_a_way_to_reach_cookidoo(self):
        with self.assertRaises(SettingsError) as ctx:
            load_settings({"BRIDGE_TOKEN": TOKEN})
        self.assertIn("BRIDGE_SECRET", str(ctx.exception))
        with self.assertRaises(SettingsError):
            load_settings({k: v for k, v in ENV.items() if k != "BRIDGE_TOKEN"})
        for half in ("COOKIDOO_EMAIL", "COOKIDOO_PASSWORD"):
            with self.assertRaises(SettingsError, msg=half):
                load_settings({"BRIDGE_TOKEN": TOKEN, half: "x"})

    def test_secret_rules(self):
        s = load_settings({"BRIDGE_TOKEN": TOKEN, "BRIDGE_SECRET": SECRET})
        self.assertTrue(s.sessions_enabled and not s.owner_mode)
        for bad in ("short", TOKEN):
            with self.assertRaises(SettingsError, msg=bad):
                load_settings({"BRIDGE_TOKEN": TOKEN, "BRIDGE_SECRET": bad})

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
        text = repr(load_settings({**ENV, "BRIDGE_SECRET": SECRET}))
        for secret in (TOKEN, "s3cret-pass", "me@example.com", SECRET):
            self.assertNotIn(secret, text)


SESSION_ENV = {"BRIDGE_TOKEN": TOKEN, "BRIDGE_SECRET": SECRET, "BRIDGE_ALLOWED_ORIGINS": ORIGIN}
GOOD = {"email": "me@example.com", "password": "pässword-1"}


class SessionLogin(unittest.IsolatedAsyncioTestCase):
    """The app logs in once; the bridge answers with a sealed session and never keeps or returns the password."""

    async def asyncSetUp(self):
        self.good = FakeClient()
        self.settings = load_settings(SESSION_ENV)
        self.pool, _, self.logins = make_pool(settings=self.settings, per_account={"me@example.com": self.good, "wrong@example.com": None})
        self.client = TestClient(TestServer(create_app(self.settings, self.pool)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def login(self, body=None, headers=AUTH):
        return await self.client.post("/api/login", json=body if body is not None else GOOD, headers=headers)

    async def test_healthz_and_ping_say_login_is_needed(self):
        self.assertEqual(await (await self.client.get("/healthz")).json(), {"ok": True, "configured": False, "sessions": True})
        self.assertEqual(await (await self.client.get("/api/ping", headers=AUTH)).json(), {"ok": True, "loggedIn": False, "canLogin": True, "fixedAccount": False})

    async def test_nothing_works_before_login(self):
        for path in ("/api/search?q=soup", "/api/recipe/r1"):
            r = await self.client.get(path, headers=AUTH)
            self.assertEqual((r.status, (await r.json())["error"]), (401, "login_required"), path)
        self.assertEqual(self.logins, [])

    async def test_login_then_search_and_recipe_with_the_session(self):
        r = await self.login()
        self.assertEqual(r.status, 200)
        body = await r.json()
        self.assertEqual((body["email"], body["days"]), ("me@example.com", 30))
        self.assertNotIn("pässword-1", str(body), "the password is never echoed")
        self.assertNotIn("pässword-1", body["session"])
        headers = {**AUTH, "X-Cookidoo-Session": body["session"]}

        self.assertEqual((await self.client.get("/api/ping", headers=headers)).status, 200)
        self.assertTrue((await (await self.client.get("/api/ping", headers=headers)).json())["loggedIn"])
        r = await self.client.get("/api/search?q=soup", headers=headers)
        self.assertEqual(r.status, 200)
        r = await self.client.get("/api/recipe/r12345", headers=headers)
        self.assertEqual((r.status, (await r.json())["name"]), (200, "Tomato soup"))
        self.assertEqual(self.logins, ["me@example.com"], "one Cookidoo login serves the login check and every later call")

    async def test_wrong_password_is_a_clear_401_and_nothing_is_kept(self):
        r = await self.login({"email": "wrong@example.com", "password": "nope"})
        self.assertEqual((r.status, (await r.json())["error"]), (401, "login_failed"))
        self.assertEqual(len(self.pool._entries), 0)

    async def test_login_is_locked_after_repeated_wrong_passwords(self):
        statuses = [(await self.login({"email": "wrong@example.com", "password": f"p{i}"})).status for i in range(7)]
        self.assertEqual(statuses, [401] * 5 + [429, 429])
        r = await self.login()
        self.assertEqual(r.status, 429, "even the right password waits: Cookidoo may lock the account")
        self.assertIn("Retry-After", r.headers)

    async def test_login_needs_the_bridge_token_and_valid_input(self):
        self.assertEqual((await self.login(headers={})).status, 401)
        for bad in ({}, {"email": "x"}, {"email": "no-at-sign", "password": "p"}, {"email": "a@b.c", "password": ""}, {"email": 5, "password": "p"}, {"email": "a@b.c", "password": "p" * 300}, []):
            r = await self.login(bad)
            self.assertEqual(r.status, 400, bad)
        r = await self.client.post("/api/login", data="not json", headers=AUTH)
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/login", data=b"x" * 10000, headers=AUTH)
        self.assertEqual(r.status, 413)
        self.assertEqual(self.logins, [])

    async def test_bad_sessions_are_rejected(self):
        sealer = SessionSealer(SECRET, 30)
        good = sealer.seal("me@example.com", "pw")
        other = SessionSealer("z" * 40, 30).seal("me@example.com", "pw")
        for bad in ("", "garbage", good[:-4] + "AAAA", other):
            headers = {**AUTH, "X-Cookidoo-Session": bad}
            r = await self.client.get("/api/search?q=a", headers=headers)
            # an empty header counts as no session at all
            self.assertEqual((r.status, (await r.json())["error"]), (401, "login_required" if bad == "" else "session_invalid"), bad)

    async def test_a_session_needs_the_token_too(self):
        session = (await (await self.login()).json())["session"]
        r = await self.client.get("/api/search?q=a", headers={"X-Cookidoo-Session": session})
        self.assertEqual(r.status, 401)
        self.assertEqual((await r.json())["error"], "unauthorized")

    async def test_cookidoo_rejecting_a_stored_login_asks_to_log_in_again(self):
        session = (await (await self.login()).json())["session"]
        self.good.fail_auth_times = 5  # e.g. the password was changed on Cookidoo
        r = await self.client.get("/api/search?q=a", headers={**AUTH, "X-Cookidoo-Session": session})
        self.assertEqual((r.status, (await r.json())["error"]), (401, "session_invalid"))

    async def test_login_is_not_available_on_a_fixed_account_bridge(self):
        pool, _, _ = make_pool()
        async with TestClient(TestServer(create_app(load_settings(ENV), pool))) as client:
            r = await client.post("/api/login", json=GOOD, headers=AUTH)
            self.assertEqual((r.status, (await r.json())["error"]), (404, "sessions_disabled"))

    async def test_cors_allows_the_session_header_and_post(self):
        r = await self.client.options("/api/login", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.status, 204)
        self.assertIn("X-Cookidoo-Session", r.headers["Access-Control-Allow-Headers"])
        self.assertIn("POST", r.headers["Access-Control-Allow-Methods"])


class Sealer(unittest.TestCase):
    def test_roundtrip_and_expiry(self):
        sealer = SessionSealer(SECRET, 30)
        token = sealer.seal("a@b.c", "pässword")
        self.assertEqual(sealer.open(token), ("a@b.c", "pässword"))
        self.assertNotIn("pässword", token)
        self.assertIsNone(SessionSealer(SECRET, 30).open("x" + token), "damaged")
        import time as _time
        from unittest import mock

        with mock.patch("cryptography.fernet.time.time", return_value=_time.time() + 31 * 86400):
            self.assertIsNone(sealer.open(token), "expired after BRIDGE_SESSION_DAYS")

    def test_tokens_differ_each_time_and_secrets_do_not_cross(self):
        a = SessionSealer(SECRET, 30)
        self.assertNotEqual(a.seal("a@b.c", "p"), a.seal("a@b.c", "p"))
        self.assertIsNone(SessionSealer("y" * 40, 30).open(a.seal("a@b.c", "p")))


class Pool(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_services_and_evicts_the_oldest(self):
        pool, _, _ = make_pool()
        first = await pool.get("a@b.c", "p")
        self.assertIs(first, await pool.get("a@b.c", "p"))
        self.assertIsNot(first, await pool.get("a@b.c", "other"))
        for i in range(10):
            await pool.get(f"u{i}@b.c", "p")
        self.assertLessEqual(len(pool._entries), 8)
        await pool.close()
        self.assertEqual(len(pool._entries), 0)


if __name__ == "__main__":
    unittest.main()
