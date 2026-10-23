// Small server, no dependencies: static files from public/ plus the JSON API
// under /api. Railway sets PORT.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const cart = require("./lib/cart");
const instinct = require("./lib/instinct");
const { state } = require("./lib/state");
const { fail } = require("./lib/util");

const ROOT = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 64 * 1024;

// The cart and the Instinct feed are private, so every /api call needs this key.
const ACCESS_KEY = process.env.ACCESS_KEY || crypto.randomBytes(9).toString("base64url");
if (!process.env.ACCESS_KEY) {
  console.warn(`ACCESS_KEY is not set, using a temporary key for this run: ${ACCESS_KEY}`);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest();

function authorized(req) {
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return crypto.timingSafeEqual(sha256(given), sha256(ACCESS_KEY));
}

function actorOf(req) {
  try {
    return decodeURIComponent(req.headers["x-actor"] || "").trim().slice(0, 40) || "מישהו";
  } catch {
    return "מישהו";
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (done) return;
      if (size > MAX_BODY) {
        done = true;
        reject(fail(413, "הבקשה גדולה מדי"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (done) return;
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch {
        reject(fail(400, "JSON לא תקין"));
      }
    });
    req.on("error", reject);
  });
}

// [method, path pattern, handler({ params, body, query, actor })]; returning
// nothing sends 204.
const routes = [
  ["GET", "/api/cart", () => cart.view()],
  ["POST", "/api/cart/items", ({ body, actor }) => cart.addItem(body, actor)],
  ["PATCH", "/api/cart/items/:id", ({ params, body, actor }) => cart.updateItem(params.id, body, actor)],
  ["DELETE", "/api/cart/items/:id", ({ params, actor }) => void cart.removeItem(params.id, actor)],
  ["DELETE", "/api/cart/ordered", ({ actor }) => ({ removed: cart.clearOrdered(actor) })],
  ["POST", "/api/thermomix/import", ({ body, actor }) => cart.importRecipe(body, actor)],
  ["POST", "/api/orders", ({ body, actor }) => cart.placeOrder(body.provider, actor)],
  ["GET", "/api/events", ({ query }) => state.events.slice(-Math.min(Number(query.get("limit")) || 50, 200)).reverse()],
  ["GET", "/api/instinct", () => instinct.getStatus()],
  ["POST", "/api/instinct/sync", ({ actor }) => cart.syncInstinct(actor)],
].map(([method, pattern, handler]) => ({
  method,
  handler,
  re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
}));

function send(res, status, data) {
  if (data === undefined) {
    res.writeHead(status === 200 ? 204 : status).end();
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(status === 413 && { Connection: "close" }),
  });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  try {
    if (!authorized(req)) throw fail(401, "קוד גישה שגוי");
    const matches = routes.filter((r) => r.re.test(url.pathname));
    if (!matches.length) throw fail(404, "לא נמצא");
    const route = matches.find((r) => r.method === req.method);
    if (!route) throw fail(405, "שיטה לא נתמכת");

    const hasBody = req.method === "POST" || req.method === "PATCH";
    const result = await route.handler({
      params: url.pathname.match(route.re).groups ?? {},
      query: url.searchParams,
      body: hasBody ? await readJson(req) : {},
      actor: actorOf(req),
    });
    send(res, req.method === "POST" && result !== undefined ? 201 : 200, result);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : "שגיאת שרת" });
  }
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
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

function createServer() {
  return http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://x");
      url.pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname.startsWith("/api/")) handleApi(req, res, url);
    else serveStatic(req, res, url.pathname);
  });
}

if (require.main === module) {
  createServer().listen(PORT, "0.0.0.0", () => console.log(`listening on ${PORT}`));
}

module.exports = { createServer };
