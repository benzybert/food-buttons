// Step-by-step cooking mode: big text, machine-setting chips, per-step timers, screen stays awake.

import { h } from "../dom.js";
import { icon } from "../icons.js";

import { catalog, actions, sourcesFor, stores as storeList } from "../app.js";
import { moneyEl, settingChips, stepText, ingredientText, openDialog, toast } from "../ui.js";
import { clock, settingParts } from "../fmt.js";
import { compareDish } from "../lib/calc.js";

// Survives re-renders triggered by state changes; reset when another dish is opened.
let session = null;

export function cookView({ match, query }) {
  const c = catalog();
  const rec = c.recById.get(match[1]);
  if (!rec) return { title: "מתכון לא נמצא", el: h("div.page", h("h1", "המתכון לא נמצא"), h("a.btn", { href: "#/cook" }, "חזרה למתכונים")) };
  const servings = Math.min(99, Math.max(1, Number(query.get("s")) || rec.servings));
  const factor = servings / rec.servings;

  if (!session || session.dishId !== rec.id || session.servings !== servings) session = { dishId: rec.id, servings, idx: 0, timers: new Map(), gathered: new Set(), logged: false };

  const pages = ["overview", ...rec.steps.map((_, i) => i), "done"];
  const last = pages.length - 1;
  const stepArea = h("div.cook-step", { "aria-live": "off" });
  const progress = h("span");
  const prevBtn = h("button.btn.btn-ghost", { type: "button", onclick: () => go(session.idx - 1) }, icon("arrow", { size: 22 }), "הקודם");
  const nextBtn = h("button.btn.btn-green", { type: "button", onclick: () => go(session.idx + 1) });
  const timerBar = h("div.row", { role: "group", "aria-label": "טיימרים פעילים" });

  let tick = null;
  let wake = null;

  const ingredientRows = () =>
    rec.ingredients.map((line) => {
      const ing = line.id ? c.ingById.get(line.id) : null;
      const { q, n } = ingredientText(line, ing ? ing.name : line.custom, factor);
      return { key: line.id || line.custom, q, n, note: line.note };
    });

  function ingredientList(withChecks) {
    return h(
      "ul.ing-list",
      ingredientRows().map((r) =>
        h(
          "li",
          { class: withChecks && session.gathered.has(r.key) ? "have" : "" },
          withChecks ? h("input", { type: "checkbox", checked: session.gathered.has(r.key), "aria-label": `${r.n} מוכן`, onchange: (e) => (e.target.checked ? session.gathered.add(r.key) : session.gathered.delete(r.key), e.target.closest("li").classList.toggle("have", e.target.checked)) }) : null,
          h("span.q", r.q),
          h("span.n", r.n, r.note ? h("span.muted", ` · ${r.note}`) : null),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ timers
  const tkey = (step, i) => `${step}:${i}`;
  function timerFor(step, i, secs) {
    const key = tkey(step, i);
    if (!session.timers.has(key)) session.timers.set(key, { total: secs, left: secs, endAt: null, done: false });
    return session.timers.get(key);
  }
  function startTimer(t) {
    t.endAt = Date.now() + t.left * 1000;
    t.done = false;
    unlockAudio();
    paintTimers();
  }
  function pauseTimer(t) {
    t.left = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
    t.endAt = null;
    paintTimers();
  }
  function resetTimer(t) {
    t.endAt = null;
    t.left = t.total;
    t.done = false;
    paintTimers();
  }
  function remaining(t) {
    return t.endAt ? Math.max(0, Math.round((t.endAt - Date.now()) / 1000)) : t.left;
  }

  function timerCard(step, i, secs, label) {
    const t = timerFor(step, i, secs);
    const key = tkey(step, i);
    const running = !!t.endAt;
    return h(
      "div.cook-timer",
      { class: t.done ? "done" : "", dataset: { timer: key } },
      icon("timer", { size: 30 }),
      h("span.time", { role: "timer", "aria-label": `נותרו ${clock(remaining(t))}` }, clock(remaining(t))),
      h("span.muted", label),
      h("span.grow"),
      t.done ? h("strong", "הסתיים!") : null,
      h("button.btn.btn-sm", { type: "button", onclick: () => (running ? pauseTimer(t) : startTimer(t)) }, icon(running ? "pause" : "play", { size: 18 }), running ? "השהיה" : t.left < t.total ? "המשך" : "התחלה"),
      h("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", "aria-label": "איפוס טיימר", onclick: () => resetTimer(t) }, icon("reset", { size: 18 })),
    );
  }

  function paintTimers() {
    // re-render only timer cards and the running-timers bar
    for (const el of document.querySelectorAll("[data-timer]")) {
      const [s, i] = el.dataset.timer.split(":").map(Number);
      const settingsOfStep = rec.steps[s]?.settings || [];
      const secs = settingsOfStep[i]?.time || 0;
      el.replaceWith(timerCard(s, i, secs, settingParts(settingsOfStep[i]).join(" / ")));
    }
    paintBar();
  }

  function paintBar() {
    const running = [...session.timers.entries()].filter(([, t]) => t.endAt || t.done);
    const cur = pages[session.idx];
    timerBar.replaceChildren(
      ...running
        .filter(([k]) => Number(k.split(":")[0]) !== cur)
        .map(([k, t]) => {
          const s = Number(k.split(":")[0]);
          return h("button.chip", { type: "button", class: t.done ? "good" : "", onclick: () => go(pages.indexOf(s)) }, icon("timer", { size: 14 }), `שלב ${s + 1}: `, h("bdi", t.done ? "הסתיים" : clock(remaining(t))));
        }),
    );
  }

  function onTick() {
    let changed = false;
    for (const t of session.timers.values()) {
      if (t.endAt && Date.now() >= t.endAt) {
        t.endAt = null;
        t.left = 0;
        t.done = true;
        changed = true;
        alarm();
      }
    }
    if (changed) paintTimers();
    else {
      for (const el of document.querySelectorAll("[data-timer] .time")) {
        const t = session.timers.get(el.closest("[data-timer]").dataset.timer);
        if (t) el.textContent = clock(remaining(t));
      }
      paintBar();
    }
  }

  // ------------------------------------------------------------ audio / wake lock
  let audio = null;
  function unlockAudio() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch {
      /* no audio */
    }
  }
  function alarm() {
    navigator.vibrate?.([300, 150, 300, 150, 600]);
    toast("טיימר הסתיים ⏰");
    if (!audio) return;
    for (let n = 0; n < 3; n++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(audio.destination);
      const t0 = audio.currentTime + n * 0.45;
      o.start(t0);
      o.stop(t0 + 0.25);
    }
  }
  async function keepAwake() {
    try {
      wake = await navigator.wakeLock?.request("screen");
    } catch {
      wake = null;
    }
  }
  const onVisible = () => document.visibilityState === "visible" && keepAwake();

  // ------------------------------------------------------------ pages
  function stepPage(i) {
    const step = rec.steps[i];
    const timers = (step.settings || []).map((s, j) => (s.time && s.time >= 30 ? timerCard(i, j, s.time, settingParts(s).join(" / ")) : null));
    return [
      h("p.count", `שלב ${i + 1} מתוך ${rec.steps.length}`),
      h("p.text", stepText(step.text)),
      step.settings?.length ? h("div.cook-settings", settingChips(step.settings)) : null,
      ...timers,
      h("button.btn.btn-ghost.btn-sm", { type: "button", style: { "align-self": "flex-start" }, onclick: () => openDialog("מצרכים", ingredientList(false)) }, icon("list", { size: 18 }), "מצרכים"),
    ];
  }

  function overviewPage() {
    return [
      h("p.count", "לפני שמתחילים"),
      h("h1", { style: { "font-size": "clamp(1.8rem, 6vw, 2.8rem)" } }, `${rec.emoji} ${rec.name}`),
      h("p.muted", `${servings} מנות · סמנו מה כבר הוצאתם`),
      h("div.card.cook-ings", ingredientList(true)),
    ];
  }

  function donePage() {
    const cmp = compareDish(rec, servings, c, { sources: sourcesFor(rec.id), orderPrice: (d, s) => c.orderPrice(d, s), hourly: 0, stores: storeList() });
    const saved = cmp.order ? cmp.saving : null;
    return [
      h("p.count", "סיימתם!"),
      h("h1", { style: { "font-size": "clamp(2rem, 7vw, 3.2rem)" } }, "בתיאבון 🍽"),
      saved != null ? h("p.text", saved > 0 ? ["בישלתם ב-", moneyEl(cmp.cook.total), " במקום ", moneyEl(cmp.order.total), ": חסכתם ", moneyEl(saved)] : ["עלות המנה: ", moneyEl(cmp.cook.total)]) : h("p.text", ["עלות המנה: ", moneyEl(cmp.cook.total)]),
      h(
        "div.row",
        session.logged
          ? h("span.chip.good", "נרשם ביומן הבישולים")
          : h("button.btn.btn-green", { type: "button", onclick: () => ((session.logged = true), actions.logCooked(rec.id, servings, saved ?? 0), toast("נרשם! החיסכון נספר במסך הבית")) }, icon("check", { size: 20 }), "רשמו שבישלתי"),
        h("a.btn.btn-ghost", { href: `#/dish/${rec.id}?s=${servings}` }, "חזרה למתכון"),
      ),
    ];
  }

  function go(i) {
    session.idx = Math.max(0, Math.min(last, i));
    const page = pages[session.idx];
    stepArea.replaceChildren(...(page === "overview" ? overviewPage() : page === "done" ? donePage() : stepPage(page)).filter(Boolean));
    progress.style.setProperty("--p", String((session.idx / last) * 100));
    prevBtn.disabled = session.idx === 0;
    nextBtn.replaceChildren(session.idx === 0 ? "מתחילים" : session.idx === last ? "סיום" : "הבא", icon("arrow", { size: 22, cls: "flip" }));
    nextBtn.disabled = session.idx === last;
    paintBar();
    stepArea.scrollTo?.(0, 0);
  }

  // keyboard + swipe (RTL: left = forward)
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select, dialog")) return;
    if (e.key === "ArrowLeft") go(session.idx + 1);
    else if (e.key === "ArrowRight") go(session.idx - 1);
    else if (e.key === "Escape") location.hash = `#/dish/${rec.id}?s=${servings}`;
  };
  let sx = null;
  const onTouchStart = (e) => void (sx = e.touches[0].clientX);
  const onTouchEnd = (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 70) go(session.idx + (dx < 0 ? 1 : -1));
  };

  const el = h(
    "div.cookmode",
    { role: "region", "aria-label": `מצב בישול: ${rec.name}` },
    h("div.cook-top", h("a.btn.btn-ghost.btn-sm.btn-icon", { href: `#/dish/${rec.id}?s=${servings}`, "aria-label": "יציאה ממצב בישול" }, icon("x", { size: 20 })), h("span.title", rec.name), h("span.muted.small", "המסך נשאר דלוק")),
    h("div.cook-progress", { role: "progressbar", "aria-label": "התקדמות במתכון", "aria-valuemin": "0", "aria-valuemax": String(last), "aria-valuenow": String(session.idx) }, progress),
    timerBar,
    stepArea,
    h("div.cook-nav", prevBtn, nextBtn),
  );

  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchend", onTouchEnd, { passive: true });
  tick = setInterval(onTick, 250);
  keepAwake();
  go(session.idx);

  return {
    el,
    title: `בישול: ${rec.name}`,
    cleanup() {
      clearInterval(tick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      wake?.release?.().catch(() => {});
      audio?.close?.().catch(() => {});
    },
  };
}
