// Everything under /api: the shared cart (needs ACCESS_KEY), the Instinct feed, and
// /api/compare + /api/health proxied to the grocery API (grocery-api/, see lib/grocery.js)
// when GROCERY_API_URL is set. server.js loads this on the first /api request, so the
// static app and its tests never touch the cart state or print a temporary key.
const crypto = require("node:crypto");

const cart = require("./cart");
const instinct = require("./instinct");
const agentDocs = require("./agent-docs");
const grocery = require("./grocery");
const { state } = require("./state");
const { fail } = require("./util");

const MAX_BODY = 64 * 1024;
const PROXY_MAX_BODY = 32 * 1024;

// method + path -> path on the grocery API. These stay public, as before the cart existed.
const PROXY_ROUTES = {
  "POST /api/compare": "/compare",
  "GET /api/health": "/health",
};

// The cart and the Instinct feed are private, so every /api call needs this key.
const ACCESS_KEY = process.env.ACCESS_KEY || crypto.randomBytes(9).toString("base64url");
if (!process.env.ACCESS_KEY) {
  console.warn(`ACCESS_KEY is not set, using a temporary key for this run: ${ACCESS_KEY}`);
}

// Instinct gets its own key that can only read, so the main key never has to
// leave the family. Derived from ACCESS_KEY unless INSTINCT_READ_KEY is set.
const READ_KEY =
  process.env.INSTINCT_READ_KEY || crypto.createHmac("sha256", ACCESS_KEY).update("instinct-read").digest("base64url");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest();
const same = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

function roleOf(req) {
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (same(given, ACCESS_KEY)) return "full";
  if (same(given, READ_KEY)) return "read";
  return null;
}

function originOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${req.headers.host}`;
}

function actorOf(req) {
  try {
    return decodeURIComponent(req.headers["x-actor"] || "").trim().slice(0, 40) || "מישהו";
  } catch {
    return "מישהו";
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (done) return;
      if (size > max) {
        done = true;
        reject(fail(413, "הבקשה גדולה מדי"));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => !done && resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, MAX_BODY);
  if (!raw.length) return {};
  try {
    const body = JSON.parse(raw.toString("utf8"));
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw fail(400, "JSON לא תקין");
  }
}

// [method, path pattern, handler({ params, body, query, actor, origin }), { read }];
// returning nothing sends 204, a string is sent as markdown. `read` routes are
// also open to the read-only key.
const routes = [
  ["GET", "/api/cart", () => cart.view(), { read: true }],
  ["POST", "/api/cart/items", ({ body, actor }) => cart.addItem(body, actor)],
  ["PATCH", "/api/cart/items/:id", ({ params, body, actor }) => cart.updateItem(params.id, body, actor)],
  ["DELETE", "/api/cart/items/:id", ({ params, actor }) => void cart.removeItem(params.id, actor)],
  ["DELETE", "/api/cart/ordered", ({ actor }) => ({ removed: cart.clearOrdered(actor) })],
  ["POST", "/api/cart/import", ({ body, actor }) => cart.importRecipe(body, actor)],
  ["POST", "/api/thermomix/import", ({ body, actor }) => cart.importRecipe(body, actor)],
  ["POST", "/api/cart/fill-prices", ({ actor }) => cart.fillPrices(actor)],
  ["POST", "/api/orders", ({ body, actor }) => cart.placeOrder(body.provider, actor)],
  ["GET", "/api/events", ({ query }) => listEvents(query), { read: true }],
  ["GET", "/api/instinct", () => instinct.getStatus(), { read: true }],
  ["GET", "/api/instinct/spec", ({ origin }) => agentDocs.spec(origin), { read: true }],
  ["GET", "/api/instinct/invite", ({ origin }) => agentDocs.invite(origin, READ_KEY)],
  ["POST", "/api/instinct/sync", ({ actor }) => cart.syncInstinct(actor)],
].map(([method, pattern, handler, { read = false } = {}]) => ({
  method,
  handler,
  read,
  re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
}));

// Newest first for the UI; with `after`, everything newer than that event id,
// oldest first, so an agent can poll without missing or repeating anything.
function listEvents(query) {
  const limit = Math.min(Number(query.get("limit")) || 50, 200);
  const after = query.get("after");
  if (after === null) return state.events.slice(-limit).reverse();
  const at = state.events.findIndex((e) => e.id === after);
  return state.events.slice(at + 1, at + 1 + limit);
}

function send(res, status, data) {
  if (data === undefined) {
    res.writeHead(status === 200 ? 204 : status).end();
    return;
  }
  if (typeof data === "string") {
    res.writeHead(status, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(status === 413 && { Connection: "close" }),
  });
  res.end(JSON.stringify(data));
}

async function proxyApi(req, res, target) {
  if (!grocery.enabled) {
    send(res, 503, { error: "שירות המצרכים עוד לא מחובר לאתר" });
    return;
  }

  let body;
  if (req.method === "POST") {
    try {
      body = await readBody(req, PROXY_MAX_BODY);
    } catch {
      send(res, 413, { error: "הרשימה ארוכה מדי" });
      return;
    }
  }

  try {
    const upstream = await grocery.request(req.method, target, body);
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("grocery api:", err.name, err.message);
    send(res, 502, { error: "שירות המצרכים לא זמין כרגע, נסו שוב עוד רגע" });
  }
}

async function handleApi(req, res, url) {
  try {
    const role = roleOf(req);
    if (!role) throw fail(401, "קוד גישה שגוי");
    const matches = routes.filter((r) => r.re.test(url.pathname));
    if (!matches.length) throw fail(404, "לא נמצא");
    const route = matches.find((r) => r.method === req.method);
    if (!route) throw fail(405, "שיטה לא נתמכת");
    if (role === "read" && !route.read) throw fail(403, "המפתח הזה לקריאה בלבד");

    const hasBody = req.method === "POST" || req.method === "PATCH";
    const result = await route.handler({
      params: url.pathname.match(route.re).groups ?? {},
      query: url.searchParams,
      body: hasBody ? await readJson(req) : {},
      actor: actorOf(req),
      origin: originOf(req),
    });
    send(res, req.method === "POST" && result !== undefined ? 201 : 200, result);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : "שגיאת שרת" });
  }
}

/**
 * Handles one /api request. `url` is { pathname (already decoded), searchParams }.
 * The grocery proxy routes are matched first, exactly as before the app and the cart were merged.
 */
function handle(req, res, url) {
  const proxied = PROXY_ROUTES[`${req.method} ${url.pathname}`];
  return proxied ? proxyApi(req, res, proxied) : handleApi(req, res, url);
}

module.exports = { handle, probe: () => grocery.probe() };
