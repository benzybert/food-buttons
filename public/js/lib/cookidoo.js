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
  login_required: "צריך להתחבר לחשבון Cookidoo בהגדרות",
  login_expired: "ההתחברות ל-Cookidoo פגה. התחברו שוב בהגדרות",
  login_failed: "Cookidoo לא קיבלה את האימייל והסיסמה (או שדף ההתחברות שלה חסם את הבקשה). בדקו ונסו שוב",
  login_locked: "יותר מדי ניסיונות עם סיסמה שגויה. כדי לא לנעול את החשבון, חכו כרבע שעה",
  login_unsupported: "השירות הזה מוגדר עם חשבון קבוע, ואין צורך להתחבר",
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

/** Which error kind the bridge's answer means. The bridge says why in body.error; the status alone is not enough. */
function kindOf(status, code) {
  if (code === "login_required" || code === "login_failed" || code === "login_locked") return code;
  if (code === "session_invalid") return "login_expired";
  if (code === "sessions_disabled") return "login_unsupported";
  if (status === 401) return "token";
  if (status === 429) return "rate";
  if (status === 404) return "not_found";
  if (status === 502) return code === "cookidoo_auth" ? "cookidoo_auth" : "cookidoo";
  return "http";
}

async function request(settings, path, params = {}, { auth = true, fetchImpl = globalThis.fetch, json } = {}) {
  const base = normalizeBridgeUrl(settings.bridgeUrl);
  if (!base || (auth && !settings.bridgeToken)) throw new BridgeError("config", MESSAGES.config);
  const url = new URL(path, base + "/");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    const headers = auth ? { Authorization: `Bearer ${settings.bridgeToken}` } : {};
    if (auth && settings.bridgeSession) headers["X-Cookidoo-Session"] = settings.bridgeSession;
    if (json) headers["Content-Type"] = "application/json";
    res = await fetchImpl(url, {
      method: json ? "POST" : "GET",
      body: json ? JSON.stringify(json) : undefined,
      headers,
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
  const kind = kindOf(res.status, body?.error);
  throw new BridgeError(kind, MESSAGES[kind]);
}

/**
 * Is the service up, is our token accepted, and are we logged in to Cookidoo? Does not call Cookidoo.
 * -> { loggedIn, canLogin, fixedAccount }. A stale session surfaces as a "login_expired" error.
 */
export async function checkBridge(settings, fetchImpl) {
  await request(settings, "healthz", {}, { auth: false, fetchImpl });
  const ping = await request(settings, "api/ping", {}, { fetchImpl });
  return { loggedIn: !!ping.loggedIn, canLogin: !!ping.canLogin, fixedAccount: !!ping.fixedAccount };
}

/**
 * Log in to Cookidoo through the bridge. The password goes over once, is checked against Cookidoo, and comes back as an
 * opaque session; the caller keeps the session and drops the password. -> { session, email, days }
 */
export async function loginBridge(settings, email, password, fetchImpl) {
  const body = await request({ ...settings, bridgeSession: "" }, "api/login", {}, { fetchImpl, json: { email: String(email).trim(), password: String(password) } });
  if (typeof body.session !== "string" || !body.session) throw new BridgeError("bad_response", MESSAGES.bad_response);
  return { session: body.session, email: String(body.email || email).trim(), days: Number(body.days) || 0 };
}

/** True when the error means "go to settings and log in (again)". */
export const needsLogin = (error) => error?.kind === "login_required" || error?.kind === "login_expired";

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
