// Pushes every recorded event to Instinct (the AI assistant) over a webhook.
// Undelivered events keep `pending: true` in the state file, so a restart or an
// Instinct outage loses nothing; they are retried with backoff, oldest first.
const { state, save } = require("./state");

const TOKEN = process.env.INSTINCT_TOKEN || "";
const target = parseTarget(process.env.INSTINCT_WEBHOOK_URL);
const enabled = Boolean(target);

const status = { lastSentAt: null, lastError: null };
let failures = 0;
let timer = null;
let flushing = null;

function parseTarget(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url;
  } catch {
    // fall through to the warning
  }
  console.warn("instinct: INSTINCT_WEBHOOK_URL ignored, it must be an https URL");
  return null;
}

async function deliver(event) {
  const { id, type, at, actor, summary, data } = event;
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": id,
        ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
      },
      body: JSON.stringify({ source: "food-buttons", event: { id, type, at, actor, summary, data } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "ok";
    status.lastError = `HTTP ${res.status}`;
    // A request Instinct rejects will be rejected again; don't let it block the queue.
    return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 ? "drop" : "retry";
  } catch (err) {
    status.lastError = err.name === "TimeoutError" ? "timeout" : err.message;
    return "retry";
  }
}

async function run() {
  clearTimeout(timer);
  for (let event; (event = state.events.find((e) => e.pending)); ) {
    const result = await deliver(event);
    if (result === "retry") {
      failures++;
      timer = setTimeout(flush, Math.min(300_000, 2 ** Math.min(failures, 8) * 1000));
      timer.unref();
      return;
    }
    delete event.pending;
    if (result === "ok") {
      event.deliveredAt = new Date().toISOString();
      status.lastSentAt = event.deliveredAt;
      status.lastError = null;
    } else {
      event.rejected = true;
    }
    save();
  }
  failures = 0;
}

function flush() {
  if (!enabled) return Promise.resolve();
  flushing ??= run().finally(() => {
    flushing = null;
  });
  return flushing;
}

function getStatus() {
  return {
    enabled,
    host: target ? target.host : null,
    pending: state.events.filter((e) => e.pending).length,
    ...status,
  };
}

if (enabled) flush();

module.exports = { enabled, flush, getStatus };
