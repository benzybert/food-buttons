// Client for the grocery API (grocery-api/): price lookups at Shufersal and Tiv Taam.
// Shared by the /api/compare proxy and by the cart, so the URL and token live here once.
const { fail } = require("./util");

const API_URL = (process.env.GROCERY_API_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.GROCERY_API_TOKEN || "";
const TIMEOUT_MS = 60_000;
const enabled = Boolean(API_URL);

function request(method, target, body) {
  return fetch(API_URL + target, {
    method,
    headers: {
      ...(body && { "Content-Type": "application/json" }),
      ...(API_TOKEN && { "x-api-key": API_TOKEN }),
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function compare(text, { title = "", includePantry = false } = {}) {
  if (!enabled) throw fail(503, "שירות המצרכים עוד לא מחובר לאתר");
  let res;
  try {
    res = await request("POST", "/compare", JSON.stringify({ text, title, include_pantry: includePantry }));
  } catch (err) {
    console.error("grocery api:", err.name, err.message);
    throw fail(502, "שירות המצרכים לא זמין כרגע, נסו שוב עוד רגע");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 means our token is wrong, which is our problem and not the caller's
    throw fail(res.status === 401 ? 502 : res.status, data.error || "שירות המצרכים לא זמין כרגע");
  }
  return data;
}

// Logged at startup so a bad GROCERY_API_URL or token shows up in the deploy log
// instead of on the first person who presses "compare".
async function probe(attempts = 4) {
  if (!enabled) {
    console.log("grocery api: GROCERY_API_URL not set, price comparison is off");
    return;
  }
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await request("GET", "/health");
      if (res.ok) return console.log(`grocery api: reachable at ${new URL(API_URL).host} (health ${res.status})`);
      console.warn(`grocery api: health returned ${res.status} (attempt ${i}/${attempts})`);
    } catch (err) {
      console.warn(`grocery api: not reachable yet, ${err.cause?.code || err.name} (attempt ${i}/${attempts})`);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 5000));
  }
  console.error(`grocery api: NOT reachable at ${new URL(API_URL).host}, check GROCERY_API_URL and that the service runs`);
}

module.exports = { enabled, request, compare, probe };
