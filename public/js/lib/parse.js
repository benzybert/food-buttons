// Parsing of free-form Hebrew recipe text: ingredient lines, Thermomix settings
// inside steps, and whole pasted recipes (plain text or schema.org JSON-LD).
// Used both at build time (data-src/*.txt -> recipes.json) and in the browser (import page).

import { norm, stem, stemTokens, stripNiqqud } from "./text.js";

// ---------------------------------------------------------------- quantities

const UNICODE_FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const WORD_FRACTIONS = { חצי: 0.5, רבע: 0.25, שליש: 1 / 3 };

const UNIT_WORDS = {
  g: ["גרם", "גרמים", "גר", "ג", "g", "gr", "gram", "grams"],
  kg: ["קג", "קילו", "קילוגרם", "kg"],
  ml: ["מל", "מיליליטר", "ml"],
  l: ["ליטר", "ליטרים", "ל", "l"],
  tsp: ["כפית", "כפיות", "tsp"],
  tbsp: ["כף", "כפות", "tbsp"],
  cup: ["כוס", "כוסות", "cup", "cups"],
  pinch: ["קורט", "צביטה"],
  u: [
    "יחידה", "יחידות", "יח", "שן", "שיני", "שינים", "קופסה", "קופסת", "קופסאות", "חבילה", "חבילת",
    "שקית", "שקיות", "צרור", "צרורות", "ענף", "ענפים", "גבעול", "גבעולי", "גבעולים", "פרוסה", "פרוסות",
    "חופן", "מקל", "מקלות",
  ],
};
const UNIT_LOOKUP = new Map();
for (const [unit, words] of Object.entries(UNIT_WORDS)) for (const w of words) UNIT_LOOKUP.set(w, unit);

const UNIT_ADJECTIVES = new Set(["גדושה", "גדושות", "שטוחה", "שטוחות", "מגוהצת", "מגוהצות", "קטנה", "גדולה", "בינונית"]);

/** Parses a leading quantity. Returns { qty, rest } or null. */
export function parseQuantity(input) {
  let s = stripNiqqud(input).trim();
  s = s.replace(/(\d+)\s*([½¼¾⅓⅔⅛])/g, (_, w, f) => String(Number(w) + UNICODE_FRACTIONS[f]));
  s = s.replace(/([½¼¾⅓⅔⅛])/g, (_, f) => String(UNICODE_FRACTIONS[f]));
  const n = (x) => Number(x.replace(",", "."));

  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*/))) return { qty: n(m[1]) + n(m[2]) / n(m[3]), rest: s.slice(m[0].length) };
  if ((m = s.match(/^(\d+)\/(\d+)\s*/))) return { qty: n(m[1]) / n(m[2]), rest: s.slice(m[0].length) };
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|–|עד)\s*(\d+(?:[.,]\d+)?)\s*/))) {
    return { qty: Math.max(n(m[1]), n(m[2])), rest: s.slice(m[0].length) };
  }
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:ו(חצי|רבע|שליש))?\s*/))) {
    return { qty: n(m[1]) + (m[2] ? WORD_FRACTIONS[m[2]] : 0), rest: s.slice(m[0].length) };
  }
  if ((m = s.match(/^(חצי|רבע|שליש)\s+/))) return { qty: WORD_FRACTIONS[m[1]], rest: s.slice(m[0].length) };
  return null;
}

// ---------------------------------------------------------------- ingredient matching

/** Index of catalog ingredients for matching: every name and alias, stemmed. */
export function buildIndex(ingredients) {
  const entries = [];
  for (const ing of ingredients) {
    const phrases = [ing.name, ...(ing.aliases || [])];
    for (const p of phrases) {
      const tokens = stemTokens(p);
      if (tokens.length) entries.push({ id: ing.id, tokens, phrase: norm(p) });
    }
  }
  entries.sort((a, b) => b.tokens.join(" ").length - a.tokens.join(" ").length);
  return entries;
}

function containsSeq(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Returns { id, score } for the best catalog match of a free-text ingredient name, or null. */
export function matchIngredient(name, index) {
  const tokens = stemTokens(name);
  if (!tokens.length) return null;
  // Strip a definite article / conjunction prefix from each token as a second try.
  const alt = tokens.map((t) => (t.length > 3 && /^[הו]/.test(t) ? t.slice(1) : t));
  for (const hay of [tokens, alt]) {
    const key = hay.join(" ");
    for (const e of index) {
      if (e.tokens.join(" ") === key) return { id: e.id, score: 1 };
    }
    for (const e of index) {
      if (containsSeq(hay, e.tokens)) return { id: e.id, score: 0.8 };
    }
  }
  return null;
}

// ---------------------------------------------------------------- ingredient lines

const NOTE_SPLIT = /\s*(?:,|\(|\s-\s|–)\s*/;
const TASTE_RE = /(?:^|\s)(לפי (?:ה)?טעם|לטעם|לקישוט|להגשה|אופציונלי|אם רוצים)(?:\s|$)/;

/**
 * "2 כפות שמן זית, לטיגון" -> { qty: 2, unit: "tbsp", name: "שמן זית", note: "לטיגון", id: "olive-oil" }
 * id is null when the name is not in the catalog.
 */
export function parseIngredientLine(line, index) {
  const raw = line;
  let s = stripNiqqud(line)
    .replace(/^[\s\-•*·▪◦–]+/, "")
    .replace(/^\d+[.)]\s+(?=\D)/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  let qty = null;
  let unit = null;
  let unitWord = null;
  let toTaste = false;

  const q = parseQuantity(s);
  if (q) {
    qty = q.qty;
    s = q.rest;
  }

  // unit word
  const parts = s.split(" ");
  const first = norm(parts[0] || "");
  if (UNIT_LOOKUP.has(first)) {
    unit = UNIT_LOOKUP.get(first);
    if (unit === "u" && !["יחידה", "יחידות", "יח"].includes(first)) unitWord = first;
    parts.shift();
    if (parts[0] && UNIT_ADJECTIVES.has(norm(parts[0]))) parts.shift();
    if (parts[0] === "של") parts.shift();
    s = parts.join(" ");
    if (qty === null) qty = 1; // "קורט מלח", "כף שמן"
  } else if (qty !== null) {
    unit = "u";
  }

  // note / name split
  let name = s;
  let note = "";
  const cut = s.search(NOTE_SPLIT);
  if (cut > 0) {
    name = s.slice(0, cut);
    note = s.slice(cut).replace(NOTE_SPLIT, "").replace(/\)\s*$/, "").trim();
  }
  const taste = name.match(TASTE_RE);
  if (taste) {
    toTaste = true;
    name = name.replace(TASTE_RE, " ").trim();
    note = note || taste[1];
  }
  name = name.replace(/\s+/g, " ").trim();
  if (!name) return null;

  if (qty === null) {
    qty = 1;
    unit = "pinch";
    toTaste = true;
  }

  const hit = matchIngredient(name, index);
  const out = { raw, qty, unit, name, id: hit ? hit.id : null };
  if (note) out.note = note;
  if (unitWord) out.unitWord = unitWord;
  if (toTaste) out.toTaste = true;
  return out;
}

// ---------------------------------------------------------------- Thermomix settings

const TIME = String.raw`(?:\d+\s*(?:שעות|שעה|שע['׳’])\s*(?:ו-?)?\s*)?\d+(?:[.,]\d+)?\s*(?:דק['׳’]|דקות|דקה|שנ['׳’]|שניות|שנייה|min|sec)(?:\s*(?:ו-?)?\s*\d+\s*(?:שנ['׳’]|שניות|שנייה|sec))?|\d+\s*(?:שעות|שעה|שע['׳’])`;
const TEMP = String.raw`(?:\d{2,3}\s*°\s*C?|Varoma|וארומה|ורומה)`;
const SPEED = String.raw`(?:מהירות\s*(?:\d+(?:[.,]5)?(?:\s*(?:עד|-|–)\s*\d+)?|כף|טורבו)|speed\s*\d+)`;
const MISC = String.raw`(?:↺|⟲|סיבוב הפוך|הפוך|תפקיד לישה)`;
const TOKEN = `(?:${TIME}|${TEMP}|${SPEED}|${MISC})`;
const GROUP_RE = new RegExp(`${TOKEN}(?:\\s*\\/\\s*${TOKEN})+`, "gu");
const TOKEN_RE = new RegExp(TOKEN, "gu");

function parseTimeToken(t) {
  let sec = 0;
  const re = /(\d+(?:[.,]\d+)?)\s*(שעות|שעה|שע['׳’]|דק['׳’]|דקות|דקה|min|שנ['׳’]|שניות|שנייה|sec)/g;
  let m;
  while ((m = re.exec(t))) {
    const v = Number(m[1].replace(",", "."));
    sec += /^שע/.test(m[2]) ? v * 3600 : /^(?:דק|min)/.test(m[2]) ? v * 60 : v;
  }
  return Math.round(sec);
}

/** Pull every "5 דק'/100°C/↺/מהירות 2" style group out of a step. */
export function extractSettings(text) {
  const out = [];
  for (const g of text.matchAll(GROUP_RE)) {
    const s = { time: null, temp: null, speed: null, reverse: false, kneading: false };
    for (const t of g[0].match(TOKEN_RE) || []) {
      if (new RegExp(`^${TIME}$`, "u").test(t)) s.time = parseTimeToken(t);
      else if (/Varoma|וארומה|ורומה/.test(t)) s.temp = "varoma";
      else if (/°/.test(t)) s.temp = Number(t.match(/\d+/)[0]);
      else if (/כף/.test(t)) s.speed = "spoon";
      else if (/טורבו/.test(t)) s.speed = "turbo";
      else if (/(?:מהירות|speed)/.test(t)) s.speed = t.replace(/^(?:מהירות|speed)\s*/, "").replace(/\s*(?:עד|-|–)\s*/, "–").replace(",", ".");
      else if (/תפקיד לישה/.test(t)) s.kneading = true;
      else s.reverse = true;
    }
    out.push({ ...s, text: g[0] });
  }
  return out;
}

/** Split a step into plain and setting-group parts: [{ text, setting: boolean }]. */
export function splitBySettings(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(GROUP_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), setting: false });
    out.push({ text: m[0], setting: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), setting: false });
  return out;
}

/** A recipe step: its text plus parsed machine settings and timers. */
export function parseStep(text) {
  const settings = extractSettings(text);
  const step = { text: text.trim() };
  if (settings.length) step.settings = settings.map(({ text: _t, ...s }) => s);
  return step;
}

// ---------------------------------------------------------------- whole-recipe parsing

const ING_HEADER = /^(?:מצרכים|מרכיבים|רכיבים|רשימת מצרכים|ingredients)\s*:?\s*$/i;
const STEP_HEADER = /^(?:אופן (?:ה)?הכנה|הכנה|הוראות הכנה|שיטת הכנה|אופן הכנה|אופן הכנת|הוראות|preparation|directions|instructions|method)\s*:?\s*$/i;

// Button labels that get copied along with a recipe page.
const NOISE = /^(?:שתף|שתפו|הדפס|הדפסה|שמור|שמירה|הוסף לרשימה|הוסף למועדפים|print|share|save)$/i;

// Sections that appear after the method on recipe pages; everything under them is ignored.
const END_HEADER = /^(?:ערכים תזונתיים|ערך תזונתי|תזונה|טיפים?(?: והערות)?|הערות|הערה|תגיות|ציוד(?: נדרש)?|אביזרים|מתכונים דומים|ביקורות|דירוג|משוב|nutrition|tips|notes|tags|equipment)\s*:?\s*$/i;

/** "1 שעה 10 דקות", "45 דק'", "PT1H10M" -> minutes */
export function parseDuration(str) {
  if (!str) return 0;
  const iso = String(str).match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3])) return Number(iso[1] || 0) * 60 + Number(iso[2] || 0) + Math.round(Number(iso[3] || 0) / 60);
  let min = 0;
  const h = String(str).match(/(\d+(?:[.,]\d+)?)\s*(?:שעות|שעה|שע['׳’]|h)/);
  const m = String(str).match(/(\d+)\s*(?:דקות|דקה|דק['׳’]|min)/);
  if (h) min += Number(h[1].replace(",", ".")) * 60;
  if (m) min += Number(m[1]);
  return Math.round(min);
}

function stripStepNumber(line) {
  return line.replace(/^\s*(?:\d+\s*[.)]|[-•*·▪◦])\s*/, "").trim();
}

/** schema.org/Recipe JSON-LD (as embedded in many recipe pages). Accepts the object, an array, or a @graph. */
export function parseJsonLd(input, index) {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const find = (d) => {
    if (!d) return null;
    if (Array.isArray(d)) return d.map(find).find(Boolean) || null;
    if (d["@graph"]) return find(d["@graph"]);
    const t = d["@type"];
    if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return d;
    return null;
  };
  const r = find(data);
  if (!r) return null;

  const steps = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === "string") steps.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x.itemListElement) walk(x.itemListElement);
    else if (x.text) steps.push(x.text);
  };
  walk(r.recipeInstructions);

  const yieldNum = String(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield || "").match(/\d+/);
  const prep = parseDuration(r.prepTime);
  const total = parseDuration(r.totalTime);
  const cookT = parseDuration(r.cookTime);
  return buildDraft(
    {
      name: r.name || "",
      servings: yieldNum ? Number(yieldNum[0]) : 0,
      prep,
      cook: cookT || Math.max(0, total - prep),
      ingredientLines: (r.recipeIngredient || []).map(String),
      stepLines: steps.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean),
    },
    index,
  );
}

function buildDraft({ name, servings, prep, cook, ingredientLines, stepLines }, index) {
  const warnings = [];
  const ingredients = [];
  for (const line of ingredientLines) {
    const p = parseIngredientLine(line, index);
    if (!p) continue;
    const { raw: _raw, name: n, id, ...rest } = p;
    ingredients.push(id ? { id, ...rest } : { custom: n, ...rest });
  }
  const unresolved = ingredients.filter((i) => i.custom).length;
  if (unresolved) warnings.push(`${unresolved} מצרכים לא זוהו - אפשר לשייך אותם ידנית`);
  if (!ingredients.length) warnings.push("לא נמצאו מצרכים");
  if (!stepLines.length) warnings.push("לא נמצאו שלבי הכנה");
  if (!servings) warnings.push("לא זוהה מספר מנות");
  return {
    name: name || "מתכון חדש",
    servings: servings || 4,
    prep: prep || 0,
    cook: cook || 0,
    ingredients,
    steps: stepLines.map(parseStep),
    warnings,
  };
}

/**
 * Parse a pasted recipe. Understands section headers (מצרכים / אופן ההכנה), numbered steps,
 * "6 מנות", "זמן הכנה: 20 דקות", and falls back to guessing by line shape.
 */
export function parseRecipeText(text, index) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const ld = parseJsonLd(trimmed, index);
    if (ld) return ld;
  }
  const ldBlock = trimmed.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (ldBlock) {
    const ld = parseJsonLd(ldBlock[1], index);
    if (ld) return ld;
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.replace(/\s+$/g, "")).filter((l) => l.trim());
  let name = "";
  let servings = 0;
  let prep = 0;
  let cook = 0;
  const ingredientLines = [];
  const stepLines = [];
  let section = null; // "ing" | "step" | null
  const hasHeaders = lines.some((l) => ING_HEADER.test(l.trim()) || STEP_HEADER.test(l.trim()));
  let pending = null; // a meta label seen on its own line ("זמן הכנה"), waiting for its value on the next line
  const setTime = (kind, mins) => {
    if (kind === "cook") cook = mins;
    else if (kind === "total") cook = Math.max(cook, mins - prep);
    else prep = mins;
  };
  const LABELS = [
    [/^(?:זמן הכנה|זמן עבודה|prep time)$/i, "prep"],
    [/^(?:זמן בישול|זמן אפייה|זמן אפיה|cook time)$/i, "cook"],
    [/^(?:זמן כולל|total time)$/i, "total"],
    [/^(?:מספר מנות|כמות מנות|כמות|מנות|סועדים|servings?|yield)$/i, "servings"],
  ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (pending) {
      const kind = pending;
      pending = null;
      if (kind === "servings") {
        const n = line.match(/^(\d+)/);
        if (n) {
          servings = Number(n[1]);
          continue;
        }
      } else if (parseDuration(line) > 0 && line.length < 40) {
        setTime(kind, parseDuration(line));
        continue;
      }
    }
    const label = !section && LABELS.find(([re]) => re.test(line));
    if (label) {
      pending = label[1];
      continue;
    }
    if (NOISE.test(line)) continue;
    if (END_HEADER.test(line)) {
      section = "end";
      continue;
    }
    if (ING_HEADER.test(line)) {
      section = "ing";
      continue;
    }
    if (STEP_HEADER.test(line)) {
      section = "step";
      continue;
    }
    if (section === "end") continue;
    const sv = line.match(/^(?:כמות|מנות|מספר מנות|יוצא|תשואה|servings?|yield)\s*[:\-]?\s*(\d+)/i) || line.match(/^(\d+)\s*(?:מנות|סועדים|יחידות)\s*$/);
    if (sv && !section) {
      servings = Number(sv[1]);
      continue;
    }
    const tm = line.match(/^(זמן הכנה|זמן עבודה|זמן בישול|זמן אפייה|זמן כולל|prep time|cook time|total time)\s*[:\-]?\s*(.+)$/i);
    if (tm) {
      const mins = parseDuration(tm[2]);
      if (/בישול|אפייה|cook/i.test(tm[1])) setTime("cook", mins);
      else if (/כולל|total/i.test(tm[1])) setTime("total", mins);
      else setTime("prep", mins);
      continue;
    }
    if (!name && !section && !/^\d/.test(line)) {
      name = line.replace(/^#+\s*/, "");
      continue;
    }
    if (section === "ing") {
      if (/:\s*$/.test(line) && !/\d/.test(line)) continue; // sub-header such as "לרוטב:"
      ingredientLines.push(line);
    } else if (section === "step") {
      const isNew = /^\s*(?:\d+\s*[.)]|[-•*·▪◦])/.test(line);
      const clean = stripStepNumber(line);
      if (!isNew && stepLines.length && !/[.!?]$/.test(stepLines[stepLines.length - 1])) stepLines[stepLines.length - 1] += " " + clean;
      else stepLines.push(clean);
    } else if (!hasHeaders) {
      // no headers anywhere: guess by shape (with headers, stray lines before them are page chrome and are ignored)
      if (/^[-•*·▪◦]?\s*(?:\d|חצי|רבע|שליש|קורט|[½¼¾⅓⅔])/.test(line) && line.length < 70 && !/[.!?]$/.test(line)) ingredientLines.push(line);
      else stepLines.push(stripStepNumber(line));
    }
  }
  const draft = buildDraft({ name, servings, prep, cook, ingredientLines, stepLines }, index);
  if (!hasHeaders && ingredientLines.length) draft.warnings.push("לא נמצאו כותרות (מצרכים / אופן ההכנה) - הפרדה לפי צורת השורה, כדאי לבדוק");
  return draft;
}

// re-export for convenience
export { stem };
