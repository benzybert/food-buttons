// Client for the optional cookidoo-bridge service (see bridge/README.md and docs/COOKIDOO.md).
// The bridge holds the Cookidoo login. This browser only holds the bridge's address and its access token.

const TIMEOUT_MS = 20000;

export class BridgeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const MESSAGES = {
  config: "חסרות כתובת וטוקן של שירות Cookidoo בהגדרות",
  network: "לא הצלחתי להגיע לשירות. בדקו שהוא רץ ושהכתובת נכונה, ושבשרת האתר מוגדר BRIDGE_ORIGIN ובשירות BRIDGE_ALLOWED_ORIGINS עם כתובת האתר",
  timeout: "השירות לא ענה בזמן, נסו שוב",
  token: "הטוקן שגוי. העתיקו אותו מחדש מההגדרות של השירות",
  rate: "יותר מדי בקשות. נסו שוב בעוד דקה",
  cookidoo_auth: "Cookidoo דחתה את ההתחברות. בדקו את האימייל, הסיסמה והמדינה בהגדרות השירות",
  cookidoo: "Cookidoo לא ענתה כרגע, נסו שוב מאוחר יותר",
  not_found: "המתכון לא נמצא",
  bad_response: "התשובה מהשירות לא תקינה",
  http: "השירות החזיר שגיאה",
};

export const bridgeMessage = (error) => MESSAGES[error?.kind] || MESSAGES.http;

/** "https://bridge.example.com/anything" -> "https://bridge.example.com"; "" when empty; null when not acceptable. */
export function normalizeBridgeUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null; // the token travels in a header
  if (url.username || url.password) return null;
  return url.origin;
}

export const bridgeConfigured = (settings) => !!(normalizeBridgeUrl(settings.bridgeUrl) && settings.bridgeToken);

async function request(settings, path, params = {}, { auth = true, fetchImpl = globalThis.fetch } = {}) {
  const base = normalizeBridgeUrl(settings.bridgeUrl);
  if (!base || (auth && !settings.bridgeToken)) throw new BridgeError("config", MESSAGES.config);
  const url = new URL(path, base + "/");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(url, {
      headers: auth ? { Authorization: `Bearer ${settings.bridgeToken}` } : {},
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (e) {
    throw new BridgeError(e?.name === "AbortError" ? "timeout" : "network", MESSAGES[e?.name === "AbortError" ? "timeout" : "network"]);
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.ok) {
    if (body === null || typeof body !== "object") throw new BridgeError("bad_response", MESSAGES.bad_response);
    return body;
  }
  const kind = res.status === 401 ? "token" : res.status === 429 ? "rate" : res.status === 404 ? "not_found" : res.status === 502 ? (body?.error === "cookidoo_auth" ? "cookidoo_auth" : "cookidoo") : "http";
  throw new BridgeError(kind, MESSAGES[kind]);
}

/** Is the service up, does it have a Cookidoo account configured, and is our token accepted? Does not call Cookidoo. */
export async function checkBridge(settings, fetchImpl) {
  const health = await request(settings, "healthz", {}, { auth: false, fetchImpl });
  await request(settings, "api/ping", {}, { fetchImpl });
  return { configured: !!health.configured };
}

/** -> { total, page, recipes: [{ id, name, thumbnail, url }] } */
export async function searchRecipes(settings, query, { maxMinutes, page, fetchImpl } = {}) {
  const body = await request(settings, "api/search", { q: query.trim(), maxMinutes, page }, { fetchImpl });
  if (!Array.isArray(body.recipes)) throw new BridgeError("bad_response", MESSAGES.bad_response);
  return body;
}

/** -> schema.org Recipe JSON-LD (what parseJsonLd understands), plus a `cookidoo` block with the source. */
export async function fetchRecipe(settings, id, fetchImpl) {
  const body = await request(settings, `api/recipe/${encodeURIComponent(id)}`, {}, { fetchImpl });
  if (body["@type"] !== "Recipe") throw new BridgeError("bad_response", MESSAGES.bad_response);
  return body;
}
