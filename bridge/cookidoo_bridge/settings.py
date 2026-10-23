"""Configuration from environment variables. Missing secrets stop the server instead of leaving it open."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

MIN_TOKEN_LENGTH = 24


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    email: str
    password: str
    token: str
    country: str = "il"
    language: str = "en"
    allowed_origins: tuple[str, ...] = ()
    rate_limit_per_minute: int = 60
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8081

    def __repr__(self) -> str:  # never print secrets, even by accident in a traceback or a log line
        return f"Settings(country={self.country!r}, language={self.language!r}, origins={list(self.allowed_origins)!r}, debug={self.debug})"


def _origin(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value.startswith(("http://", "https://")) or value.count("/") > 2:
        raise SettingsError(f"BRIDGE_ALLOWED_ORIGINS entries must look like https://example.com, got {value!r}")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    missing = [name for name in ("COOKIDOO_EMAIL", "COOKIDOO_PASSWORD", "BRIDGE_TOKEN") if not env.get(name)]
    if missing:
        raise SettingsError("missing environment variables: " + ", ".join(missing))
    token = env["BRIDGE_TOKEN"]
    if len(token) < MIN_TOKEN_LENGTH:
        raise SettingsError(f"BRIDGE_TOKEN must be at least {MIN_TOKEN_LENGTH} characters (try: python -c \"import secrets; print(secrets.token_urlsafe(32))\")")
    origins = tuple(_origin(o) for o in env.get("BRIDGE_ALLOWED_ORIGINS", "").split(",") if o.strip())
    try:
        rate = int(env.get("BRIDGE_RATE_LIMIT_PER_MINUTE", "60"))
        port = int(env.get("PORT", "8081"))
    except ValueError as error:
        raise SettingsError(str(error)) from error
    if rate < 1:
        raise SettingsError("BRIDGE_RATE_LIMIT_PER_MINUTE must be at least 1")
    return Settings(
        email=env["COOKIDOO_EMAIL"],
        password=env["COOKIDOO_PASSWORD"],
        token=token,
        country=env.get("COOKIDOO_COUNTRY", "il").lower(),
        language=env.get("COOKIDOO_LANGUAGE", "en"),
        allowed_origins=origins,
        rate_limit_per_minute=rate,
        debug=env.get("BRIDGE_DEBUG") == "1",
        # Listen on all interfaces only where a platform tells us to (PORT is set); locally stay on loopback.
        host=env.get("HOST") or ("0.0.0.0" if "PORT" in env else "127.0.0.1"),
        port=port,
    )
