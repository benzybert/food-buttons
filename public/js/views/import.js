// Import a recipe: paste text (e.g. copied from Cookidoo or any site), a schema.org JSON-LD blob,
// or start empty. Parsed into an editable draft, then saved to this browser as a "my recipe".

import { h, debounce } from "../dom.js";
import { icon } from "../icons.js";
import { catalog, actions } from "../app.js";
import { pageHead, notice, settingChips, toast } from "../ui.js";
import { parseRecipeText, parseStep } from "../lib/parse.js";
import { UNIT_LABELS } from "../lib/units.js";
import { CATEGORY_LABELS, AISLE_LABELS, AISLE_ORDER } from "../lib/catalog.js";

const EMOJIS = ["🍲", "🥣", "🍝", "🍛", "🍗", "🥩", "🐟", "🥗", "🥙", "🧆", "🍕", "🥞", "🍞", "🥘", "🍰", "🍪", "🍨", "🥤", "🍅", "🥕"];
let draft = null; // { id?, name, emoji, category, servings, prep, cook, order, tags, ingredients[], steps[], warnings[] }

const blankDraft = () => ({ name: "", emoji: "🍲", category: "main", servings: 4, prep: 15, cook: 20, order: "", tags: "", ingredients: [{ qty: 1, unit: "g", id: "", custom: "", note: "" }], steps: [""], warnings: [] });

export function importView({ match }) {
  const c = catalog();
  const editId = match[1];
  if (editId) {
    const rec = c.recById.get(editId);
    if (!rec || rec.src !== "custom") return { title: "עריכת מתכון", el: h("div.page", h("h1", "אפשר לערוך רק מתכונים שיובאו"), h("a.btn", { href: "#/cook" }, "חזרה")) };
    if (!draft || draft.id !== editId) draft = fromRecipe(rec);
  } else if (draft?.id) draft = null;

  const host = h("div");
  const paint = () => host.replaceChildren(draft ? editor() : pasteStage());
  paint();

  function pasteStage() {
    const area = h("textarea.textarea", { dir: "auto", rows: "12", placeholder: "הדביקו כאן את המתכון: שם, מצרכים, אופן ההכנה...", "aria-label": "טקסט המתכון", "data-fk": "paste" });
    const file = h("input", { type: "file", hidden: true, accept: ".txt,.json,.html,.htm,text/plain,application/json", "aria-label": "העלאת קובץ מתכון", onchange: (e) => e.target.files[0]?.text().then((t) => ((area.value = t), analyze(t))) });
    const analyze = (text) => {
      if (!text.trim()) return toast("הדביקו קודם טקסט של מתכון");
      draft = fromParsed(parseRecipeText(text, c.index), c);
      paint();
    };
    return h(
      "div.stack",
      notice("info", "ייבוא הוא לשימוש אישי: המתכון נשמר רק בדפדפן הזה. האפליקציה לא מתחברת ל-Cookidoo ולא מעתיקה ממנו. אתם מעתיקים מתכון שיש לכם גישה אליו, ואנחנו עוזרים לארגן אותו ולחשב עלות.", "info"),
      h("ol", { style: { margin: 0, "padding-inline-start": "1.4rem" } }, h("li", "פתחו את המתכון (ב-", h("a", { href: "https://cookidoo.co.il", target: "_blank", rel: "noopener noreferrer" }, "Cookidoo"), " או בכל אתר)."), h("li", "סמנו את כל הטקסט והעתיקו (Ctrl+A ואז Ctrl+C)."), h("li", "הדביקו כאן ולחצו ״ניתוח המתכון״. נזהה מצרכים, כמויות והגדרות מכשיר כמו ״5 דק׳/100°C/מהירות 2״.")),
      area,
      h("div.row", h("button.btn", { type: "button", onclick: () => analyze(area.value) }, icon("sparkle", { size: 20 }), "ניתוח המתכון"), h("label.btn.btn-ghost", { style: { cursor: "pointer" } }, icon("upload", { size: 20 }), "העלאת קובץ", file), h("button.btn.btn-ghost", { type: "button", onclick: () => ((draft = blankDraft()), paint()) }, icon("plus", { size: 20 }), "מתכון ריק")),
    );
  }

  function editor() {
    const d = draft;
    const ingList = h("div.stack");
    const stepList = h("div.stack");

    const paintIngs = () =>
      ingList.replaceChildren(
        ...d.ingredients.map((row, i) => {
          const sel = h("select.select.ing-sel", { "aria-label": `מצרך ${i + 1}`, onchange: (e) => ((row.id = e.target.value), paintIngs()) }, h("option", { value: "" }, "— מצרך חופשי (ללא מחיר) —"), AISLE_ORDER.filter((a) => a !== "free" || true).map((a) => h("optgroup", { label: AISLE_LABELS[a] }, c.ingredients.filter((x) => x.aisle === a).map((x) => h("option", { value: x.id, selected: row.id === x.id }, x.name)))));
          sel.value = row.id || "";
          return h(
            "div.stack",
            { style: { gap: "0.3rem", padding: "0.5rem 0", "border-bottom": "1px dashed var(--line)" } },
            h(
              "div.edit-row",
              h("input.input", { type: "number", min: "0", step: "any", inputmode: "decimal", value: String(row.qty), "aria-label": `כמות ${i + 1}`, onchange: (e) => (row.qty = Number(e.target.value)) }),
              h("select.select", { "aria-label": `יחידה ${i + 1}`, onchange: (e) => (row.unit = e.target.value) }, Object.entries(UNIT_LABELS).map(([u, [one]]) => h("option", { value: u, selected: row.unit === u }, u === "u" ? "יחידות" : one))),
              sel,
              h("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", "aria-label": `הסר מצרך ${i + 1}`, onclick: () => (d.ingredients.splice(i, 1), paintIngs()) }, icon("trash", { size: 16 })),
            ),
            !row.id ? h("input.input", { dir: "auto", placeholder: "שם המצרך", value: row.custom, "aria-label": `שם מצרך ${i + 1}`, oninput: (e) => (row.custom = e.target.value) }) : null,
            h("input.input", { dir: "auto", placeholder: "הערה (למשל: קצוץ)", value: row.note || "", "aria-label": `הערה למצרך ${i + 1}`, oninput: (e) => (row.note = e.target.value) }),
          );
        }),
      );

    const paintSteps = () =>
      stepList.replaceChildren(
        ...d.steps.map((text, i) => {
          const preview = h("div.chips");
          const showPreview = () => preview.replaceChildren(...settingChips(parseStep(d.steps[i]).settings));
          showPreview();
          return h(
            "div.stack",
            { style: { gap: "0.3rem" } },
            h("div.row", h("strong", `שלב ${i + 1}`), h("span.grow"), h("button.btn.btn-ghost.btn-sm.btn-icon", { type: "button", "aria-label": `הסר שלב ${i + 1}`, onclick: () => (d.steps.splice(i, 1), paintSteps()) }, icon("trash", { size: 16 }))),
            h("textarea.textarea", { dir: "auto", rows: "3", style: { "min-block-size": "5rem" }, "aria-label": `שלב ${i + 1}`, value: text, oninput: debounce((e) => ((d.steps[i] = e.target.value), showPreview()), 150) }),
            preview,
          );
        }),
      );
    paintIngs();
    paintSteps();

    const field = (label, input, id) => h("div.field", h("label", { for: id }, label), Object.assign(input, { id }));
    const num = (key, id, extra = {}) => h("input.input", { type: "number", min: "0", step: "1", inputmode: "numeric", value: String(d[key]), onchange: (e) => (d[key] = e.target.value === "" ? "" : Number(e.target.value)), ...extra });

    return h(
      "form.stack",
      { novalidate: "", onsubmit: (e) => (e.preventDefault(), save()) },
      d.warnings.length ? h("div.notice.warn", { role: "status" }, icon("alert", { size: 20 }), h("div", d.warnings.map((w) => h("p", w)))) : null,
      h("div.card.stack", h("h2", "פרטים"), field("שם המתכון", h("input.input", { dir: "auto", value: d.name, oninput: (e) => (d.name = e.target.value) }), "f-name"), h("div.grid", { style: { "grid-template-columns": "repeat(auto-fit, minmax(8rem, 1fr))" } }, field("מנות", num("servings"), "f-serv"), field("זמן עבודה (דק׳)", num("prep"), "f-prep"), field("בישול/המתנה (דק׳)", num("cook"), "f-cook"), field("מחיר הזמנה למנה (₪)", num("order", { placeholder: "לא חובה" }), "f-order")), h("div.grid", { style: { "grid-template-columns": "repeat(auto-fit, minmax(10rem, 1fr))" } }, field("קטגוריה", h("select.select", { onchange: (e) => (d.category = e.target.value) }, Object.entries(CATEGORY_LABELS).map(([id, l]) => h("option", { value: id, selected: d.category === id }, l))), "f-cat"), field("אייקון", h("select.select", { onchange: (e) => (d.emoji = e.target.value) }, EMOJIS.map((em) => h("option", { value: em, selected: d.emoji === em }, em))), "f-emoji")), field("תגיות (מופרדות בפסיק)", h("input.input", { dir: "auto", value: d.tags, oninput: (e) => (d.tags = e.target.value) }), "f-tags")),
      h("div.card", h("h2", { style: { "margin-block-end": "0.5rem" } }, "מצרכים"), h("p.small.muted", "שייכו כל מצרך לקטלוג כדי לקבל מחיר. מצרך חופשי יופיע במתכון אבל לא ייכלל בחישוב."), ingList, h("button.btn.btn-ghost.btn-sm", { type: "button", style: { "margin-top": "0.5rem" }, onclick: () => (d.ingredients.push({ qty: 1, unit: "g", id: "", custom: "", note: "" }), paintIngs()) }, icon("plus", { size: 16 }), "הוספת מצרך")),
      h("div.card", h("h2", { style: { "margin-block-end": "0.5rem" } }, "אופן ההכנה"), stepList, h("button.btn.btn-ghost.btn-sm", { type: "button", style: { "margin-top": "0.5rem" }, onclick: () => (d.steps.push(""), paintSteps()) }, icon("plus", { size: 16 }), "הוספת שלב")),
      h("div.row", h("button.btn.btn-green", { type: "submit" }, icon("check", { size: 20 }), d.id ? "שמירת שינויים" : "שמירת המתכון"), h("button.btn.btn-ghost", { type: "button", onclick: () => ((draft = null), d.id ? (location.hash = `#/dish/${d.id}`) : paint()) }, "ביטול")),
    );

    function save() {
      const errs = [];
      if (!d.name.trim()) errs.push("חסר שם למתכון");
      const ings = d.ingredients.filter((r) => (r.id || r.custom.trim()) && r.qty > 0).map((r) => (r.id ? { id: r.id, qty: r.qty, unit: r.unit, ...(r.note ? { note: r.note } : {}) } : { custom: r.custom.trim(), qty: r.qty, unit: r.unit, ...(r.note ? { note: r.note } : {}) }));
      if (!ings.length) errs.push("הוסיפו לפחות מצרך אחד עם כמות");
      const steps = d.steps.map((t) => t.trim()).filter(Boolean).map(parseStep);
      if (!steps.length) errs.push("הוסיפו לפחות שלב הכנה אחד");
      if (!(Number(d.servings) > 0)) errs.push("מספר המנות חייב להיות גדול מאפס");
      if (errs.length) {
        d.warnings = errs;
        paint();
        window.scrollTo(0, 0);
        return;
      }
      const id = d.id || `my-${Date.now().toString(36)}`;
      const recipe = { id, name: d.name.trim(), emoji: d.emoji, category: d.category, servings: Number(d.servings), prep: Number(d.prep) || 0, cook: Number(d.cook) || 0, level: 2, order: d.order === "" ? undefined : Number(d.order), tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean), description: "", ingredients: ings, steps, src: "custom" };
      draft = null;
      actions.saveCustomRecipe(recipe);
      toast("המתכון נשמר");
      location.hash = `#/dish/${id}`;
    }
  }

  const el = h("div.page", pageHead(editId ? "עריכת מתכון" : "ייבוא מתכון", editId ? "" : "מכל מקור: מתכון ממקור כלשהו הופך למתכון עם עלות, רשימת קניות ומצב בישול"), host);
  return { el, title: "ייבוא מתכון" };
}

function fromParsed(p, c) {
  return {
    name: p.name,
    emoji: "🍲",
    category: "main",
    servings: p.servings,
    prep: p.prep,
    cook: p.cook,
    order: "",
    tags: "",
    ingredients: p.ingredients.map((l) => ({ qty: Math.round(l.qty * 100) / 100, unit: l.unit, id: l.id && c.ingById.has(l.id) ? l.id : "", custom: l.custom || "", note: l.note || "" })),
    steps: p.steps.map((s) => s.text),
    warnings: p.warnings,
  };
}

function fromRecipe(rec) {
  return {
    id: rec.id,
    name: rec.name,
    emoji: rec.emoji,
    category: rec.category,
    servings: rec.servings,
    prep: rec.prep,
    cook: rec.cook,
    order: rec.order ?? "",
    tags: (rec.tags || []).join(", "),
    ingredients: rec.ingredients.map((l) => ({ qty: l.qty, unit: l.unit, id: l.id || "", custom: l.custom || "", note: l.note || "" })),
    steps: rec.steps.map((s) => s.text),
    warnings: [],
  };
}
