# vendor/israelgrocery

Copy of `src/` from https://github.com/danielJL-altius/israelgrocerymcp at commit `e9ba55a`,
without `server.py` and `israelgrocery_mcp/` (the Claude Desktop MCP wiring, which needs the `mcp` package).

The modules use top-level imports (`import models`, `import stores`), so `service.py` puts this
folder on `sys.path`. Do not edit these files here; update them by copying from upstream again.
