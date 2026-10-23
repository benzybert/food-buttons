const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fb-test-"));
delete process.env.INSTINCT_WEBHOOK_URL;

const cart = require("../lib/cart");
const { compare } = require("../lib/compare");
const { state } = require("../lib/state");

test("the same item from two sources becomes one line with both sources", () => {
  cart.addItem({ name: "קמח", qty: 1, unit: "ק״ג", source: "sharon" }, "דנה");
  const item = cart.addItem({ name: "קמח", qty: 2, unit: "ק״ג", source: "thermomix" }, "יוסי");
  assert.equal(item.qty, 3);
  assert.deepEqual(item.sources, ["sharon", "thermomix"]);
  assert.equal(state.items.filter((i) => i.name === "קמח").length, 1);
});

test("a different unit is a different line", () => {
  cart.addItem({ name: "סוכר", qty: 1, unit: "ק״ג" }, "דנה");
  cart.addItem({ name: "סוכר", qty: 1, unit: "כוס" }, "דנה");
  assert.equal(state.items.filter((i) => i.name === "סוכר").length, 2);
});

test("rejects bad input", () => {
  assert.throws(() => cart.addItem({ name: "  " }, "x"), { status: 400 });
  assert.throws(() => cart.addItem({ name: "חלב", qty: -1 }, "x"), { status: 400 });
  assert.throws(() => cart.addItem({ name: "חלב", source: "wolt" }, "x"), { status: 400 });
});

test("parseLine reads quantity, unit and name", () => {
  assert.deepEqual(cart.parseLine("2 כוסות קמח"), { name: "קמח", qty: 2, unit: "כוסות" });
  assert.deepEqual(cart.parseLine("- 1/2 כפית מלח"), { name: "מלח", qty: 0.5, unit: "כפית" });
  assert.deepEqual(cart.parseLine('500 ק"ג עגבניות'), { name: "עגבניות", qty: 500, unit: "ק״ג" });
  assert.deepEqual(cart.parseLine("3 ביצים"), { name: "ביצים", qty: 3, unit: "" });
  assert.deepEqual(cart.parseLine("פלפל שחור"), { name: "פלפל שחור", qty: 1, unit: "" });
});

test("recipe import adds every ingredient as one event", () => {
  const before = state.events.length;
  cart.importRecipe({ recipe: "חומוס", lines: "200 גרם גרגרי חומוס\n2 שיני שום\n\n1/2 כפית כמון" }, "שבן");
  assert.equal(state.events.length, before + 1);
  assert.equal(state.events.at(-1).type, "cart.recipe_imported");
  assert.deepEqual(state.items.find((i) => i.name === "כמון").sources, ["thermomix"]);
  assert.ok(state.items.some((i) => i.name === "כמון" && i.qty === 0.5));
  assert.throws(() => cart.importRecipe({ lines: "  \n " }, "x"), { status: 400 });
});

test("only a provider priced for every item can be cheapest", () => {
  const providers = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];
  const items = [
    { qty: 2, prices: { a: 10, b: 12, c: 1 } },
    { qty: 1, prices: { a: 5, b: 3 } },
  ];
  const rows = Object.fromEntries(compare(items, providers).map((r) => [r.id, r]));
  assert.equal(rows.a.total, 25);
  assert.equal(rows.b.total, 27);
  assert.equal(rows.c.complete, false);
  assert.equal(rows.c.missing, 1);
  assert.equal(rows.a.cheapest, true);
  assert.equal(rows.c.cheapest, false);
});

test("no cheapest when nothing is fully priced, or the cart is empty", () => {
  const providers = [{ id: "a", name: "A" }];
  assert.equal(compare([{ qty: 1, prices: {} }], providers)[0].cheapest, false);
  assert.equal(compare([], providers)[0].cheapest, false);
});

test("prices are validated and can be cleared", () => {
  const item = cart.addItem({ name: "שמן", qty: 2 }, "דנה");
  cart.updateItem(item.id, { prices: { shufersal: 12.345 } }, "דנה");
  assert.equal(item.prices.shufersal, 12.35);
  assert.throws(() => cart.updateItem(item.id, { prices: { nope: 1 } }, "x"), { status: 400 });
  assert.throws(() => cart.updateItem(item.id, { prices: { shufersal: -3 } }, "x"), { status: 400 });
  cart.updateItem(item.id, { prices: { shufersal: null } }, "דנה");
  assert.equal(item.prices.shufersal, undefined);
});

test("ordering marks items, records the total and locks them", () => {
  state.items.length = 0;
  const a = cart.addItem({ name: "לחם", qty: 2 }, "דנה");
  cart.updateItem(a.id, { prices: { shufersal: 8 } }, "דנה");
  const order = cart.placeOrder("shufersal", "דנה");
  assert.equal(order.total, 16);
  assert.equal(state.events.at(-1).type, "order.placed");
  assert.throws(() => cart.updateItem(a.id, { qty: 5 }, "x"), { status: 409 });
  assert.throws(() => cart.placeOrder("shufersal", "x"), { status: 409 });
  assert.equal(cart.clearOrdered("דנה"), 1);
});

test("an unpriced order has no total", () => {
  cart.addItem({ name: "גבינה" }, "דנה");
  assert.equal(cart.placeOrder("victory", "דנה").total, null);
});
