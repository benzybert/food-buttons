import sys

from aiohttp import web

from .app import create_app
from .settings import SettingsError, load_settings

try:
    settings = load_settings()
except SettingsError as error:
    sys.exit(f"cookidoo-bridge: {error}")

print(f"cookidoo-bridge: {settings} listening on {settings.host}:{settings.port}", flush=True)
web.run_app(create_app(settings), host=settings.host, port=settings.port, print=None)
