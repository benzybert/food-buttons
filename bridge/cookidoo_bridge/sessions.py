"""Sealed login sessions: the app holds an opaque string, the server holds the key.

A session is the user's Cookidoo email and password encrypted and authenticated (Fernet: AES-128-CBC + HMAC-SHA256)
under a key derived from BRIDGE_SECRET, with a timestamp. Nothing is stored on the server, so sessions survive restarts;
changing BRIDGE_SECRET revokes all of them. The password therefore travels once, over HTTPS, when logging in.
"""

from __future__ import annotations

import base64
import hashlib
import json

from cryptography.fernet import Fernet, InvalidToken


class SessionSealer:
    def __init__(self, secret: str, days: int) -> None:
        key = hashlib.sha256(b"cookidoo-bridge/session/v1\0" + secret.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(key))
        self._ttl = days * 86400

    def seal(self, email: str, password: str) -> str:
        return self._fernet.encrypt(json.dumps({"e": email, "p": password}).encode()).decode()

    def open(self, token: str) -> tuple[str, str] | None:
        """(email, password), or None for anything forged, damaged, expired or sealed under another secret."""
        try:
            data = json.loads(self._fernet.decrypt(token.encode(), ttl=self._ttl))
            email, password = data["e"], data["p"]
        except (InvalidToken, ValueError, KeyError, TypeError, UnicodeError):
            return None
        return (email, password) if isinstance(email, str) and isinstance(password, str) and email and password else None
