// Tiny static file server, no dependencies. Railway/Vercel/Netlify can also serve `public/` directly.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".webmanifest", ".svg", ".txt"]);

// Everything is same-origin; no inline scripts or styles, so a strict CSP is possible.
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/**
 * The one extra origin pages may call: the optional cookidoo-bridge service (docs/COOKIDOO.md).
 * Accepts only a bare https origin (or http on localhost); anything else is ignored rather than put into the CSP.
 */
export function bridgeOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "";
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function securityHeaders(env = process.env) {
  const origin = bridgeOrigin(env.BRIDGE_ORIGIN);
  if (!origin) return SECURITY_HEADERS;
  return { ...SECURITY_HEADERS, "Content-Security-Policy": SECURITY_HEADERS["Content-Security-Policy"].replace("connect-src 'self';", `connect-src 'self' ${origin};`) };
}

// path -> { mtimeMs, etag, raw, gzip }
const cache = new Map();

function load(file, stat, ext) {
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const entry = {
    mtimeMs: stat.mtimeMs,
    etag: `"${crypto.createHash("sha1").update(raw).digest("base64url").slice(0, 20)}"`,
    raw,
    gzip: COMPRESSIBLE.has(ext) && raw.length > 512 ? zlib.gzipSync(raw, { level: 9 }) : null,
  };
  cache.set(file, entry);
  return entry;
}

export function createServer({ env = process.env } = {}) {
  const baseHeaders = securityHeaders(env);
  const send = (res, status, headers, body) => {
    res.writeHead(status, { ...baseHeaders, ...headers });
    res.end(body);
  };
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { Allow: "GET, HEAD" });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      send(res, 400, {});
      return;
    }
    if (pathname === "/healthz") {
      send(res, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "ok");
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";

    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT + path.sep)) {
      send(res, 403, {});
      return;
    }

    let stat;
    try {
      stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, req.method === "HEAD" ? undefined : "לא נמצא");
      return;
    }

    const ext = path.extname(file);
    const entry = load(file, stat, ext);
    const immutable = ext === ".woff2";
    const headers = {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      // Fonts never change under the same name. Everything else is revalidated (cheap 304s via ETag).
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: entry.etag,
      Vary: "Accept-Encoding",
    };
    if (pathname === "/sw.js") headers["Service-Worker-Allowed"] = "/";

    if (req.headers["if-none-match"] === entry.etag) {
      send(res, 304, headers);
      return;
    }
    const useGzip = entry.gzip && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    const body = useGzip ? entry.gzip : entry.raw;
    if (useGzip) headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = body.length;
    send(res, 200, headers, req.method === "HEAD" ? undefined : body);
  });
}

// Only listen when run directly (tests import createServer).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, "0.0.0.0", () => console.log(`listening on ${PORT}`));
}
