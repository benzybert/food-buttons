"""The HTTP API. Every /api route needs the bearer token; CORS is limited to the origins you list."""

from __future__ import annotations

import hmac
import json
import logging
import re
import time
from collections import deque
from typing import Any

from aiohttp import web

from .convert import recipe_to_jsonld, search_hit
from .service import CookidooService
from .settings import Settings

try:
    from cookidoo_api.exceptions import CookidooAuthException, CookidooException
except ImportError:  # pragma: no cover
    class CookidooException(Exception):  # type: ignore[no-redef]
        pass

    class CookidooAuthException(CookidooException):  # type: ignore[no-redef]
        pass

log = logging.getLogger("cookidoo_bridge")

RECIPE_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
MAX_QUERY = 100
MAX_INGREDIENTS = 8

SETTINGS = web.AppKey("settings", Settings)
SERVICE = web.AppKey("service", CookidooService)
HITS = web.AppKey("hits", deque)


def _json(data: Any, status: int = 200, headers: dict[str, str] | None = None) -> web.Response:
    return web.json_response(data, status=status, headers=headers, dumps=lambda d: json.dumps(d, ensure_ascii=False))


def _error(status: int, code: str, message: str, headers: dict[str, str] | None = None) -> web.Response:
    return _json({"error": code, "message": message}, status, headers)


@web.middleware
async def security(request: web.Request, handler):
    settings: Settings = request.app[SETTINGS]
    origin = request.headers.get("Origin")
    cors: dict[str, str] = {"Vary": "Origin"}
    if origin and origin in settings.allowed_origins:
        cors.update(
            {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Max-Age": "600",
            }
        )

    if request.method == "OPTIONS":
        response: web.StreamResponse = web.Response(status=204)
    else:
        try:
            response = await handler(request)
        except web.HTTPException as error:
            response = _error(error.status, "http_error", error.reason or "error")
        except Exception:  # noqa: BLE001 - never let a traceback (which may quote URLs or tokens) reach the browser
            log.exception("unhandled error on %s", request.path)
            response = _error(500, "internal_error", "internal error")
    response.headers.update(cors)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _authorized(request: web.Request) -> bool:
    supplied = request.headers.get("Authorization", "")
    expected = "Bearer " + request.app[SETTINGS].token
    return hmac.compare_digest(supplied.encode(), expected.encode())


def _rate_limited(request: web.Request) -> int:
    """Returns the seconds to wait when over the limit, else 0. One shared window: this serves one account."""
    hits: deque = request.app[HITS]
    now = time.monotonic()
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= request.app[SETTINGS].rate_limit_per_minute:
        return max(1, int(60 - (now - hits[0])))
    hits.append(now)
    return 0


@web.middleware
async def api_guard(request: web.Request, handler):
    if request.path.startswith("/api/") and request.method != "OPTIONS":
        # Count failed logins too: a guessing attempt must not be free.
        wait = _rate_limited(request)
        if wait:
            return _error(429, "rate_limited", "too many requests", {"Retry-After": str(wait)})
        if not _authorized(request):
            return _error(401, "unauthorized", "missing or wrong access token", {"WWW-Authenticate": "Bearer"})
    return await handler(request)


async def healthz(request: web.Request) -> web.Response:
    return _json({"ok": True, "configured": request.app[SERVICE].configured})


def _int(request: web.Request, name: str, default: int, low: int, high: int) -> int:
    raw = request.query.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise web.HTTPBadRequest(reason=f"{name} must be a number") from None
    return min(high, max(low, value))


async def ping(request: web.Request) -> web.Response:
    """Tells the web app its token works, without touching Cookidoo."""
    return _json({"ok": True})


async def search(request: web.Request) -> web.Response:
    query = request.query.get("q", "").strip()[:MAX_QUERY]
    ingredients = [i.strip()[:MAX_QUERY] for i in request.query.get("ingredients", "").split(",") if i.strip()][:MAX_INGREDIENTS]
    if not query and not ingredients:
        return _error(400, "bad_request", "give a search word (q) or ingredients")
    max_minutes = _int(request, "maxMinutes", 0, 0, 24 * 60) or None
    page = _int(request, "page", 0, 0, 100)
    page_size = _int(request, "pageSize", 12, 1, 30)
    try:
        result = await request.app[SERVICE].search(query, ingredients=ingredients, max_minutes=max_minutes, page=page, page_size=page_size)
    except CookidooException as error:
        return _upstream(error)
    return _json({"total": getattr(result, "total", 0), "page": page, "recipes": [search_hit(h) for h in getattr(result, "recipes", [])]})


async def recipe(request: web.Request) -> web.Response:
    recipe_id = request.match_info["id"]
    if not RECIPE_ID.match(recipe_id):
        return _error(400, "bad_request", "bad recipe id")
    try:
        details = await request.app[SERVICE].recipe(recipe_id)
    except CookidooException as error:
        return _upstream(error)
    body = recipe_to_jsonld(details)
    if request.app[SETTINGS].debug and request.query.get("raw") == "1":
        body["raw"] = repr(details)  # only for working out what Cookidoo really sends; off unless BRIDGE_DEBUG=1
    return _json(body)


def _upstream(error: Exception) -> web.Response:
    # Say what kind of failure it was, never what the exception contains: it may quote a URL or a token.
    if isinstance(error, CookidooAuthException):
        return _error(502, "cookidoo_auth", "Cookidoo refused the login: check COOKIDOO_EMAIL / COOKIDOO_PASSWORD / country")
    return _error(502, "cookidoo_unavailable", f"Cookidoo request failed ({type(error).__name__})")


def create_app(settings: Settings, service: CookidooService | None = None) -> web.Application:
    app = web.Application(middlewares=[security, api_guard], client_max_size=1024)
    service = service or CookidooService(settings)
    app[SETTINGS] = settings
    app[SERVICE] = service
    app[HITS] = deque()
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/api/ping", ping)
    app.router.add_get("/api/search", search)
    app.router.add_get("/api/recipe/{id}", recipe)
    app.on_cleanup.append(service.close)
    return app
