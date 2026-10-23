"""The Cookidoo side of the bridge: one logged-in client for one account, with in-memory caching only."""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable

from aiohttp import ClientSession, CookieJar

from .settings import Settings

try:  # the library is only needed when talking to Cookidoo; the tests inject a fake client
    from cookidoo_api import Cookidoo, CookidooConfig
    from cookidoo_api.exceptions import CookidooAuthException
    from cookidoo_api.helpers import get_localization_options
except ImportError:  # pragma: no cover
    Cookidoo = CookidooConfig = get_localization_options = None  # type: ignore[assignment]

    class CookidooAuthException(Exception):  # type: ignore[no-redef]
        pass


RECIPE_TTL_SECONDS = 3600
RECIPE_CACHE_SIZE = 64


class CookidooService:
    """Search recipes and load recipe details. Recipes are cached in memory for an hour and never written to disk."""

    def __init__(self, settings: Settings, client_factory: Callable[[], Awaitable[Any]] | None = None) -> None:
        self._settings = settings
        self._client_factory = client_factory or self._login
        self._client: Any = None
        self._session: ClientSession | None = None
        self._lock = asyncio.Lock()
        self._recipes: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    @property
    def configured(self) -> bool:
        return bool(self._settings.email and self._settings.password)

    async def _login(self) -> Any:
        if Cookidoo is None:
            raise RuntimeError("cookidoo-api is not installed")
        # The login redirect chain crosses domains, so the cookie jar has to accept them (see the cookidoo-api README).
        self._session = ClientSession(cookie_jar=CookieJar(unsafe=True))
        try:
            options = await get_localization_options(country=self._settings.country, language=self._settings.language)
            if not options:
                raise ValueError(f"Cookidoo has no {self._settings.country}/{self._settings.language} localization")
            config = CookidooConfig(localization=options[0], email=self._settings.email, password=self._settings.password)
            client = Cookidoo(self._session, config)
            await client.login()
            return client
        except BaseException:
            await self._session.close()
            self._session = None
            raise

    async def _get_client(self, *, fresh: bool = False) -> Any:
        async with self._lock:
            if fresh:
                if self._session is not None:
                    await self._session.close()
                    self._session = None
                self._client = None
            if self._client is None:
                self._client = await self._client_factory()
            return self._client

    async def _call(self, operation: Callable[[Any], Awaitable[Any]]) -> Any:
        client = await self._get_client()
        try:
            return await operation(client)
        except CookidooAuthException:
            # An expired or revoked session: log in once more and retry once.
            client = await self._get_client(fresh=True)
            return await operation(client)

    async def search(self, query: str, *, ingredients: list[str] | None = None, max_minutes: int | None = None, page: int = 0, page_size: int = 12) -> Any:
        return await self._call(
            lambda client: client.search_recipes(
                query or None,
                ingredients=ingredients or None,
                total_time=max_minutes * 60 if max_minutes else None,
                page=page,
                page_size=page_size,
            )
        )

    async def recipe(self, recipe_id: str) -> Any:
        cached = self._recipes.get(recipe_id)
        if cached and time.monotonic() - cached[0] < RECIPE_TTL_SECONDS:
            self._recipes.move_to_end(recipe_id)
            return cached[1]
        details = await self._call(lambda client: client.get_recipe_details(recipe_id))
        self._recipes[recipe_id] = (time.monotonic(), details)
        while len(self._recipes) > RECIPE_CACHE_SIZE:
            self._recipes.popitem(last=False)
        return details

    async def close(self, *_: Any) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None
        self._client = None
        self._recipes.clear()
