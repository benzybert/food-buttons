"""HTTP API for the food-buttons site. The Node server proxies /api/* here.

    POST /compare   {"text": "<one ingredient per line>", "title": "...", "include_pantry": false}
    GET  /health

Set API_TOKEN to require an `x-api-key` header (the Node proxy sends GROCERY_API_TOKEN).
"""
from __future__ import annotations

import hmac
import json
import os

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

import service

MAX_BODY_BYTES = 32 * 1024
MAX_TEXT_CHARS = 6000
API_TOKEN = os.environ.get("API_TOKEN", "")


def _error(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


async def health(request: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


async def compare(request: Request) -> JSONResponse:
    if API_TOKEN and not hmac.compare_digest(request.headers.get("x-api-key", ""), API_TOKEN):
        return _error("לא מורשה", 401)

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return _error("הרשימה ארוכה מדי", 413)
    try:
        data = json.loads(body)
        text, title = data["text"], data.get("title", "")
        if not isinstance(text, str) or not isinstance(title, str):
            raise TypeError
    except (ValueError, KeyError, TypeError):
        return _error("בקשה לא תקינה", 400)
    if len(text) > MAX_TEXT_CHARS:
        return _error("הרשימה ארוכה מדי", 413)

    try:
        result = await service.compare(
            text, title[:100], include_pantry=data.get("include_pantry") is True
        )
    except ValueError as exc:
        return _error(str(exc), 400)
    return JSONResponse(result)


app = Starlette(routes=[
    Route("/health", health),
    Route("/compare", compare, methods=["POST"]),
])
