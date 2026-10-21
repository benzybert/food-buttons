// Builds public/data/{ingredients,recipes}.json from data-src/.
//   node tools/build-data.js          write the files
//   node tools/build-data.js --check  exit 1 if the files on disk are stale
// Fails loudly on any unresolved ingredient, unconvertible unit, or kosher mix-up.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, parseIngredientLine, parseStep } from "../public/js/lib/parse.js";
import { deriveRecipe } from "../public/js/lib/derive.js";
import { toBase } from "../public/js/lib/units.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data-src");
const OUT = path.join(ROOT, "public", "data");

const CATEGORIES = new Set(["soup", "main", "side", "salad", "dip", "sauce", "breakfast", "bread", "dessert", "drink"]);
const AISLES = new Set(["produce", "meat", "dairy", "dry", "canned", "oils", "spices", "baking", "nuts", "frozen", "free"]);
const FLAGS = new Set(["m", "f", "d", "e", "h", "a", "g", "n", "p", "s", "o", "home", "free"]);

const errors = [];
const fail = (msg) => errors.push(msg);

// ------------------------------------------------------------------ ingredients

export function parseIngredientsFile(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const f = line.split("|").map((x) => x.trim());
    const where = `ingredients.txt:${i + 1}`;
    if (f.length !== 10) return fail(`${where}: expected 10 columns, got ${f.length}: ${line}`);
    const [id, name, aliases, aisle, base, pack, ref, uw, density, flags] = f;
    if (!AISLES.has(aisle)) fail(`${where}: unknown aisle ${aisle}`);
    if (!["g", "ml", "u"].includes(base)) fail(`${where}: unknown base unit ${base}`);
    const flagList = flags ? flags.split(/\s+/).filter(Boolean) : [];
    for (const fl of flagList) if (!FLAGS.has(fl)) fail(`${where}: unknown flag ${fl}`);

    let packObj;
    if (pack === "kg") packObj = { type: "loose", size: 1000, step: 100 };
    else if (pack === "unit") packObj = { type: "loose", size: 1, step: 1 };
    else if (/^P\d+$/.test(pack)) packObj = { type: "pack", size: Number(pack.slice(1)) };
    else fail(`${where}: bad pack ${pack}`);

    const ing = {
      id,
      name,
      aliases: aliases ? aliases.split(",").map((x) => x.trim()).filter(Boolean) : [],
      aisle,
      base,
      pack: packObj,
      ref: Number(ref),
      flags: flagList.filter((x) => x !== "home" && x !== "free"),
    };
    if (uw) ing.unitWeight = Number(uw);
    if (density) ing.density = Number(density);
    if (flagList.includes("home")) ing.home = true;
    if (flagList.includes("free")) ing.free = true;
    if (!Number.isFinite(ing.ref)) fail(`${where}: bad price ${ref}`);
    out.push(ing);
  });
  const seen = new Set();
  for (const i of out) {
    if (seen.has(i.id)) fail(`duplicate ingredient id ${i.id}`);
    seen.add(i.id);
  }
  return out;
}

// ------------------------------------------------------------------ recipes

export function parseRecipeSource(text, file, index) {
  const recipes = [];
  const blocks = text.split(/^@\s+/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const id = lines.shift().trim();
    const r = { id, tags: [], ingredients: [], steps: [], src: "builtin" };
    let mode = "meta";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line === "ingredients:") {
        mode = "ing";
        continue;
      }
      if (line === "steps:") {
        mode = "steps";
        continue;
      }
      if (mode === "meta") {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (!m) {
          fail(`${file}/${id}: bad meta line: ${line}`);
          continue;
        }
        const [, k, v] = m;
        if (k === "tags") r.tags = v.split(",").map((x) => x.trim()).filter(Boolean);
        else if (["servings", "prep", "cook", "level", "order"].includes(k)) r[k] = Number(v);
        else if (k === "desc") r.description = v;
        else r[k] = v;
      } else if (mode === "ing") {
        const p = parseIngredientLine(line.replace(/^-\s*/, ""), index);
        if (!p) fail(`${file}/${id}: unparsable ingredient: ${line}`);
        else if (!p.id) fail(`${file}/${id}: unknown ingredient "${p.name}" in line: ${line}`);
        else {
          const { raw: _raw, name: _n, ...rest } = p;
          r.ingredients.push(rest);
        }
      } else if (mode === "steps") {
        const m = line.match(/^\d+\.\s*(.*)$/);
        if (m) r.steps.push(parseStep(m[1]));
        else if (r.steps.length) r.steps[r.steps.length - 1].text += " " + line;
        else fail(`${file}/${id}: step text before numbering: ${line}`);
      }
    }
    recipes.push(r);
  }
  return recipes;
}

function validateRecipe(r, ingById) {
  const w = `recipe ${r.id}`;
  for (const k of ["name", "emoji", "category", "servings", "prep", "cook", "level", "order"]) {
    if (r[k] === undefined || r[k] === "" || Number.isNaN(r[k])) fail(`${w}: missing ${k}`);
  }
  if (!CATEGORIES.has(r.category)) fail(`${w}: unknown category ${r.category}`);
  if (!r.ingredients.length) fail(`${w}: no ingredients`);
  if (!r.steps.length) fail(`${w}: no steps`);
  for (const l of r.ingredients) {
    const ing = ingById.get(l.id);
    if (!ing) continue;
    const base = toBase(ing, l.qty, l.unit);
    if (!Number.isFinite(base)) fail(`${w}: cannot convert ${l.qty} ${l.unit} of ${l.id} (missing unitWeight/density?)`);
  }
  if (r.kosher === "mixed") fail(`${w}: mixes meat and dairy ingredients`);
}

export function buildAll() {
  errors.length = 0;
  const ingredients = parseIngredientsFile(fs.readFileSync(path.join(SRC, "ingredients.txt"), "utf8"));
  const index = buildIndex(ingredients);
  const ingById = new Map(ingredients.map((i) => [i.id, i]));

  const recipes = [];
  const dir = path.join(SRC, "recipes");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
    const parsed = parseRecipeSource(fs.readFileSync(path.join(dir, file), "utf8"), file, index);
    for (const r of parsed) recipes.push(deriveRecipe(r, ingById));
  }
  const ids = new Set();
  for (const r of recipes) {
    if (ids.has(r.id)) fail(`duplicate recipe id ${r.id}`);
    ids.add(r.id);
    validateRecipe(r, ingById);
  }
  return { ingredients, recipes, errors: [...errors] };
}

const stringify = (x) => JSON.stringify(x, null, 1) + "\n";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ingredients, recipes, errors: errs } = buildAll();
  if (errs.length) {
    console.error("build-data failed:\n" + errs.map((e) => " - " + e).join("\n"));
    process.exit(1);
  }
  const files = {
    "ingredients.json": stringify(ingredients),
    "recipes.json": stringify(recipes),
  };
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([f, c]) => !fs.existsSync(path.join(OUT, f)) || fs.readFileSync(path.join(OUT, f), "utf8") !== c);
    if (stale.length) {
      console.error("stale generated data: " + stale.map(([f]) => f).join(", ") + " (run npm run build:data)");
      process.exit(1);
    }
    console.log("data is up to date");
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), c);
    console.log(`wrote ${ingredients.length} ingredients, ${recipes.length} recipes`);
  }
}
