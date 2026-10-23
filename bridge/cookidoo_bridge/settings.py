"""Configuration from environment variables. Missing secrets stop the server instead of leaving it open.

Two ways to give the bridge a Cookidoo account (either, or both):
  * fixed account: COOKIDOO_EMAIL + COOKIDOO_PASSWORD are set on the server; whoever holds BRIDGE_TOKEN uses that account.
  * app login: BRIDGE_SECRET is set; each user logs in once from the app (POST /api/login). The server answers with a
    session sealed under BRIDGE_SECRET, and the app keeps only that session, never the password.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

MIN_TOKEN_LENGTH = 24
MIN_SECRET_LENGTH = 32


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    token: str
    email: str = ""
    password: str = ""
    secret: str = ""
    session_days: int = 30
    country: str = "il"
    language: str = "en"
    allowed_origins: tuple[str, ...] = ()
    rate_limit_per_minute: int = 60
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8081

    @property
    def owner_mode(self) -> bool:
        return bool(self.email and self.password)

    @property
    def sessions_enabled(self) -> bool:
        return bool(self.secret)

    def __repr__(self) -> str:  # never print secrets, even by accident in a traceback or a log line
        modes = [m for m, on in (("fixed account", self.owner_mode), ("app login", self.sessions_enabled)) if on]
        return f"Settings(modes={modes!r}, country={self.country!r}, language={self.language!r}, origins={list(self.allowed_origins)!r}, debug={self.debug})"


def _origin(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value.startswith(("http://", "https://")) or value.count("/") > 2:
        raise SettingsError(f"BRIDGE_ALLOWED_ORIGINS entries must look like https://example.com, got {value!r}")
    return value


def _int(env: Mapping[str, str], name: str, default: int, low: int) -> int:
    try:
        value = int(env.get(name, str(default)))
    except ValueError as error:
        raise SettingsError(f"{name} must be a number") from error
    if value < low:
        raise SettingsError(f"{name} must be at least {low}")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    token = env.get("BRIDGE_TOKEN", "")
    if not token:
        raise SettingsError("missing environment variables: BRIDGE_TOKEN")
    if len(token) < MIN_TOKEN_LENGTH:
        raise SettingsError(f"BRIDGE_TOKEN must be at least {MIN_TOKEN_LENGTH} characters (try: python -c \"import secrets; print(secrets.token_urlsafe(32))\")")

    email, password, secret = env.get("COOKIDOO_EMAIL", ""), env.get("COOKIDOO_PASSWORD", ""), env.get("BRIDGE_SECRET", "")
    if bool(email) != bool(password):
        raise SettingsError("set both COOKIDOO_EMAIL and COOKIDOO_PASSWORD, or neither")
    if not (email or secret):
        raise SettingsError("give the bridge a way to reach Cookidoo: COOKIDOO_EMAIL + COOKIDOO_PASSWORD (fixed account), or BRIDGE_SECRET (users log in from the app)")
    if secret and len(secret) < MIN_SECRET_LENGTH:
        raise SettingsError(f"BRIDGE_SECRET must be at least {MIN_SECRET_LENGTH} characters (try: python -c \"import secrets; print(secrets.token_urlsafe(48))\")")
    if secret and secret == token:
        raise SettingsError("BRIDGE_SECRET and BRIDGE_TOKEN must be different values")

    origins = tuple(_origin(o) for o in env.get("BRIDGE_ALLOWED_ORIGINS", "").split(",") if o.strip())
    return Settings(
        token=token,
        email=email,
        password=password,
        secret=secret,
        session_days=_int(env, "BRIDGE_SESSION_DAYS", 30, 1),
        country=env.get("COOKIDOO_COUNTRY", "il").lower(),
        language=env.get("COOKIDOO_LANGUAGE", "en"),
        allowed_origins=origins,
        rate_limit_per_minute=_int(env, "BRIDGE_RATE_LIMIT_PER_MINUTE", 60, 1),
        debug=env.get("BRIDGE_DEBUG") == "1",
        # Listen on all interfaces only where a platform tells us to (PORT is set); locally stay on loopback.
        host=env.get("HOST") or ("0.0.0.0" if "PORT" in env else "127.0.0.1"),
        port=_int(env, "PORT", 8081, 1),
    )
