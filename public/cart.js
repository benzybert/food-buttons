const $ = (id) => document.getElementById(id);

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // private mode: the gate just asks again next time
    }
  },
};

let key = store.get("fb.key");
let actor = store.get("fb.actor");
let cart = null;
let rev = -1;
let pending = -1;
let inviteLoaded = false;
const openItems = new Set();

const money = (n) => `${n.toLocaleString("he-IL", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} ₪`;
const count = (n) => (n === 1 ? "פריט אחד" : `${n} פריטים`);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

let toastTimer;
function toast(message, bad = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = bad ? "toast bad" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

class AuthError extends Error {}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Actor": encodeURIComponent(actor || ""),
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError();
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "משהו השתבש");
  return data;
}

// Wraps a user action: shows errors, sends the user back to the gate on a bad key.
async function act(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AuthError) showGate("הקוד לא התקבל, נסו שוב");
    else toast(err.message, true);
  }
}

function showGate(error) {
  $("content").hidden = true;
  $("gate").hidden = false;
  $("who").hidden = true;
  $("gate-name").value = actor || "";
  $("gate-error").hidden = !error;
  $("gate-error").textContent = error || "";
  (actor ? $("gate-key") : $("gate-name")).focus();
}

function showApp() {
  $("gate").hidden = true;
  $("content").hidden = false;
  $("who").hidden = false;
  $("who").textContent = actor;
}

$("gate").addEventListener("submit", (e) => {
  e.preventDefault();
  actor = $("gate-name").value.trim();
  key = $("gate-key").value;
  store.set("fb.actor", actor);
  store.set("fb.key", key);
  inviteLoaded = false;
  $("gate-key").value = "";
  showApp();
  rev = -1;
  refresh();
});
$("who").addEventListener("click", () => showGate());

function renderItems() {
  const items = cart.items.filter((i) => !i.orderId);
  $("items-count").textContent = items.length ? `· ${count(items.length)}` : "";
  $("items-empty").hidden = items.length > 0;

  $("items").replaceChildren(
    ...items.map((item) => {
      const patch = (body) =>
        act(async () => {
          try {
            await api("PATCH", `/api/cart/items/${item.id}`, body);
          } finally {
            rev = -1; // also redraws after a rejected value, so the field shows what is saved
            await refresh();
          }
        });
      const qty = el("input", {
        "data-key": `qty:${item.id}`,
        type: "number",
        inputmode: "decimal",
        min: "0",
        step: "any",
        value: item.qty,
        "aria-label": `כמות של ${item.name}`,
        onchange: (e) => patch({ qty: Number(e.target.value) }),
      });
      const step = (d) => () => patch({ qty: Math.max(0.001, item.qty + d) });

      const prices = cart.providers.map((p) =>
        el(
          "label",
          { class: "cart-field" },
          p.name,
          el("input", {
            "data-key": `price:${item.id}:${p.id}`,
            type: "number",
            inputmode: "decimal",
            min: "0",
            step: "0.01",
            placeholder: "₪",
            value: item.prices[p.id] ?? "",
            "aria-label": `מחיר ${item.name} ב${p.name}`,
            onchange: (e) => patch({ prices: { [p.id]: e.target.value === "" ? null : Number(e.target.value) } }),
          }),
        ),
      );
      const priced = Object.keys(item.prices).length;

      return el(
        "li",
        { class: "cart-item" },
        el(
          "div",
          { class: "item-main" },
          el(
            "div",
            { class: "item-name" },
            item.name,
            item.unit && el("span", { class: "hint" }, ` · ${item.unit}`),
            el(
              "div",
              { class: "badges" },
              item.sources.map((s) => el("span", { class: `badge src-${s}` }, cart.sources[s])),
            ),
          ),
          el(
            "div",
            { class: "qty" },
            el("button", { type: "button", class: "btn ghost", "aria-label": "פחות", onclick: step(-1), disabled: item.qty <= 1 }, "−"),
            qty,
            el("button", { type: "button", class: "btn ghost", "aria-label": "עוד", onclick: step(1) }, "+"),
          ),
          el(
            "button",
            {
              type: "button",
              class: "btn ghost small",
              "aria-label": `הסר ${item.name}`,
              onclick: () => act(() => api("DELETE", `/api/cart/items/${item.id}`).then(refresh)),
            },
            "הסר",
          ),
        ),
        el(
          "details",
          {
            open: openItems.has(item.id),
            ontoggle: (e) => (e.target.open ? openItems.add(item.id) : openItems.delete(item.id)),
          },
          el("summary", {}, priced ? `מחירים (${priced}/${cart.providers.length})` : "מחירים"),
          el("div", { class: "prices" }, prices),
        ),
      );
    }),
  );
}

function renderCompare() {
  const active = cart.items.filter((i) => !i.orderId);
  $("copy").disabled = !active.length;
  $("compare").replaceChildren(
    ...cart.compare.map((row) => {
      const provider = cart.providers.find((p) => p.id === row.id);
      const status = !active.length
        ? null
        : row.complete
          ? el("span", { class: row.cheapest ? "tag-ok" : "" }, row.cheapest ? "הכי זול" : "מחירים מלאים")
          : el("span", { class: "tag-warn" }, `חסר מחיר ל-${row.missing} מתוך ${active.length}`);
      return el(
        "div",
        { class: `prov${row.cheapest ? " is-best" : ""}` },
        el("strong", {}, row.name),
        el("span", { class: "total" }, active.length && row.missing < active.length ? `${row.complete ? "" : "עד כה "}${money(row.total)}` : "—"),
        el(
          "div",
          { class: "meta" },
          status,
          provider.url && el("a", { href: provider.url, target: "_blank", rel: "noopener", class: "btn ghost small" }, "פתח את האתר"),
          el(
            "button",
            {
              type: "button",
              class: "btn small",
              disabled: !active.length,
              onclick: () => {
                if (!confirm(`לסמן את כל ${count(active.length)} כהוזמנו ב${row.name}?`)) return;
                act(async () => {
                  await api("POST", "/api/orders", { provider: row.id });
                  toast(`סומן כהוזמן ב${row.name}`);
                  await refresh();
                });
              },
            },
            "הזמנתי כאן",
          ),
        ),
      );
    }),
  );

  const ordered = cart.items.filter((i) => i.orderId);
  $("ordered-wrap").hidden = !ordered.length;
  $("ordered-count").textContent = ordered.length ? `· ${ordered.length}` : "";
  $("ordered").replaceChildren(
    ...ordered.map((i) => {
      const order = cart.orders.find((o) => o.id === i.orderId);
      const where = order && cart.providers.find((p) => p.id === order.provider)?.name;
      return el("li", {}, el("span", {}, `${i.name} · ${i.qty}${i.unit ? ` ${i.unit}` : ""}`), el("time", {}, where || ""));
    }),
  );
}

// The invite carries the read-only key, so it is fetched with the main key and
// only lives in this page's link.
async function loadInvite() {
  if (inviteLoaded) return;
  const { whatsappUrl } = await api("GET", "/api/instinct/invite");
  $("instinct-whatsapp").href = whatsappUrl;
  $("instinct-whatsapp").hidden = false;
  $("instinct-whatsapp-note").hidden = false;
  inviteLoaded = true;
}

function renderInstinct(s) {
  $("instinct-sync").disabled = !s.enabled;
  $("instinct-status").textContent = !s.enabled
    ? "עוד לא מחובר. הכפתור למטה פותח ווטסאפ עם הודעה מוכנה ל-Instinct. כשתהיה לו כתובת webhook, מגדירים אותה בשרת (INSTINCT_WEBHOOK_URL)."
    : [
        `מחובר ל-${s.host}.`,
        s.pending ? `${s.pending} עדכונים ממתינים לשליחה${s.lastError ? ` (${s.lastError})` : ""}.` : "כל העדכונים נשלחו.",
        s.lastSentAt && `נשלח לאחרונה בשעה ${new Date(s.lastSentAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}.`,
      ]
        .filter(Boolean)
        .join(" ");
}

async function renderLog() {
  const events = await api("GET", "/api/events?limit=30");
  $("log").replaceChildren(
    ...events.map((e) =>
      el(
        "li",
        {},
        el("span", {}, e.summary, e.pending && " ⏳"),
        el("time", { datetime: e.at, dir: "ltr" }, new Date(e.at).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })),
      ),
    ),
  );
}

// Redraws only when something changed. Focus and what is being typed survive
// the redraw, so tabbing through price fields is not interrupted.
async function refresh() {
  if (!$("gate").hidden) return;
  if (!key) return showGate();
  await act(async () => {
    const [next, instinct] = await Promise.all([api("GET", "/api/cart"), api("GET", "/api/instinct")]);
    renderInstinct(instinct);
    if (next.rev === rev && instinct.pending === pending) return;
    rev = next.rev;
    pending = instinct.pending;
    cart = next;

    const focused = document.activeElement?.dataset?.key;
    const typed = focused && document.activeElement.value;
    showApp();
    renderItems();
    renderCompare();
    // Restore right away: anything typed while the awaits below run must not be overwritten.
    const again = focused && document.querySelector(`[data-key="${CSS.escape(focused)}"]`);
    if (again) {
      again.value = typed;
      again.focus();
    }
    await Promise.all([renderLog(), loadInvite()]);
  });
}

$("add").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  act(async () => {
    await api("POST", "/api/cart/items", {
      name: form.get("name"),
      qty: Number(form.get("qty")) || 1,
      unit: form.get("unit"),
      source: form.get("source"),
    });
    e.target.name.value = "";
    e.target.qty.value = 1;
    e.target.unit.value = "";
    e.target.name.focus();
    await refresh();
  });
});

$("import-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  act(async () => {
    const added = await api("POST", "/api/thermomix/import", { recipe: form.get("recipe"), lines: form.get("lines") });
    toast(`נוספו ${count(added.length)} לעגלה`);
    e.target.reset();
    $("import").open = false;
    await refresh();
  });
});

$("copy").addEventListener("click", async () => {
  const lines = cart.items.filter((i) => !i.orderId).map((i) => `${i.name} ${i.qty}${i.unit ? ` ${i.unit}` : ""}`);
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast("הרשימה הועתקה");
  } catch {
    prompt("העתיקו את הרשימה:", lines.join("\n"));
  }
});

$("clear-ordered").addEventListener("click", () => act(() => api("DELETE", "/api/cart/ordered").then(refresh)));

$("instinct-sync").addEventListener("click", () =>
  act(async () => {
    const s = await api("POST", "/api/instinct/sync");
    toast(s.pending ? "Instinct לא זמין כרגע, ננסה שוב" : "נשלח ל-Instinct", Boolean(s.pending));
    rev = -1;
    await refresh();
  }),
);

// Opened from the Sharon / Thermomix buttons with ?source=...
const wanted = new URLSearchParams(location.search).get("source");
const radio = document.querySelector(`input[name="source"][value="${CSS.escape(wanted || "")}"]`);
if (radio) radio.checked = true;

if (key && actor) refresh();
else showGate();
setInterval(() => !document.hidden && refresh(), 10_000);
document.addEventListener("visibilitychange", () => !document.hidden && refresh());
