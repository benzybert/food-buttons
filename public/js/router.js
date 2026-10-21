// Hash router: "#/dish/chicken-soup?s=4". Works on any static host, no rewrites needed.

const routes = [];
let current = null;
let renderToken = 0;
let onRender = () => {};

export function route(pattern, view, opts = {}) {
  routes.push({ pattern, view, ...opts });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: path.replace(/\/+$/, "") || "/", query: new URLSearchParams(qs) };
}

export function href(path, query) {
  const qs = query ? new URLSearchParams(query).toString() : "";
  return `#${path}${qs ? "?" + qs : ""}`;
}

/** Update query params without adding history entries or re-rendering the page. */
export function replaceQuery(params) {
  const { path } = parseHash();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null && !(Array.isArray(v) && !v.length)) qs.set(k, Array.isArray(v) ? v.join(",") : v);
  const s = qs.toString();
  history.replaceState(null, "", `#${path}${s ? "?" + s : ""}`);
}

export function currentRoute() {
  return current;
}

export function onRouteRender(fn) {
  onRender = fn;
}

/** Render the view for the current hash. `keep` keeps scroll position and focus (state-change re-render). */
export async function render(keep = false) {
  const { path, query } = parseHash();
  let match = null;
  let found = null;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      found = r;
      match = m;
      break;
    }
  }
  if (!found) {
    found = routes.find((r) => r.fallback);
    match = [path];
  }
  const token = ++renderToken;
  const prevScroll = window.scrollY;
  const focusKey = keep ? document.activeElement?.dataset?.fk : null;
  const caret = keep && document.activeElement?.selectionStart != null ? document.activeElement.selectionStart : null;

  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch {
      /* ignore */
    }
  }
  const result = await found.view({ match, query, path });
  if (token !== renderToken) return; // a newer navigation won
  current = { ...result, path, route: found };
  onRender(current, { keep });

  if (keep) {
    window.scrollTo(0, prevScroll);
    if (focusKey) {
      const el = document.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        if (caret != null && el.setSelectionRange) {
          try {
            el.setSelectionRange(caret, caret);
          } catch {
            /* not a text input */
          }
        }
      }
    }
  } else {
    window.scrollTo(0, 0);
  }
}

export function start() {
  window.addEventListener("hashchange", () => render(false));
  return render(false);
}
