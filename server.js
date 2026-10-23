// Tiny static file server, no dependencies. Railway sets PORT.
// /api/* is proxied to the grocery API (grocery-api/) when GROCERY_API_URL is set.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;
const API_URL = (process.env.GROCERY_API_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.GROCERY_API_TOKEN || "";
const API_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 32 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// method + path -> path on the grocery API
const API_ROUTES = {
  "POST /api/compare": "/compare",
  "GET /api/health": "/health",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RangeError("body too large"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyApi(req, res, pathname) {
  const target = API_ROUTES[`${req.method} ${pathname}`];
  if (!target) {
    sendJson(res, 404, { error: "לא נמצא" });
    return;
  }
  if (!API_URL) {
    sendJson(res, 503, { error: "שירות המצרכים עוד לא מחובר לאתר" });
    return;
  }

  let body;
  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch {
      // answer first, then drop the connection so the rest of the oversized body isn't read
      res.setHeader("Connection", "close");
      res.on("finish", () => req.destroy());
      sendJson(res, 413, { error: "הרשימה ארוכה מדי" });
      return;
    }
  }

  try {
    const upstream = await fetch(API_URL + target, {
      method: req.method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(API_TOKEN ? { "x-api-key": API_TOKEN } : {}),
      },
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("grocery api:", err.name, err.message);
    sendJson(res, 502, { error: "שירות המצרכים לא זמין כרגע, נסו שוב עוד רגע" });
  }
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const file = path.join(ROOT, pathname.endsWith("/") ? pathname + "index.html" : pathname);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      if (err.code === "EISDIR") {
        // /sharon -> /sharon/ (single leading slash, so "//host" can't turn into a protocol-relative redirect)
        res.writeHead(301, { Location: "/" + pathname.replace(/^\/+/, "") + "/" }).end();
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("לא נמצא");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".woff2" ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  if (pathname.startsWith("/api/")) {
    proxyApi(req, res, pathname);
  } else {
    serveStatic(req, res, pathname);
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`listening on ${PORT}`));
