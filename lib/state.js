// All shared state lives in one JSON file. Set DATA_DIR to a persistent volume
// (Railway's disk is wiped on every deploy otherwise).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "state.json");

const empty = () => ({ rev: 0, items: [], orders: [], events: [] });

function load() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") console.error("state: cannot read", FILE, err.message);
    return empty();
  }
  try {
    return { ...empty(), ...JSON.parse(raw) };
  } catch (err) {
    // Keep the unreadable file instead of overwriting it with an empty cart.
    const backup = `${FILE}.corrupt-${Date.now()}`;
    fs.renameSync(FILE, backup);
    console.error(`state: ${FILE} is not valid JSON, moved to ${backup}`);
    return empty();
  }
}

const state = load();

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

const newId = () => crypto.randomBytes(6).toString("hex");

module.exports = { state, save, newId };
