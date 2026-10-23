import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseProducts, decodeBuffer, readPriceFile, sizeFromName, normalisePrice, matcherFor, median, buildPriceTable, loadStoreProducts } from "../tools/ingest-prices.js";
import { loadRaw } from "./helpers.js";

const item = (o) => `<Item><PriceUpdateDate>2026-10-01 06:00</PriceUpdateDate><ItemCode>${o.code || "1"}</ItemCode><ItemType>1</ItemType><ItemName>${o.name}</ItemName><ManufacturerName>x</ManufacturerName><UnitQty>${o.unitQty ?? 'ק"ג'}</UnitQty><Quantity>${o.quantity ?? 1}</Quantity><bIsWeighted>${o.weighted ? 1 : 0}</bIsWeighted><UnitOfMeasure>100 גרם</UnitOfMeasure><QtyInPackage>0</QtyInPackage><ItemPrice>${o.price}</ItemPrice><UnitOfMeasurePrice>0</UnitOfMeasurePrice><AllowDiscount>1</AllowDiscount><ItemStatus>${o.status ?? 1}</ItemStatus></Item>`;
const file = (items) => `<?xml version="1.0" encoding="utf-8"?><Root><ChainId>1</ChainId><StoreId>1</StoreId><Items Count="${items.length}">${items.join("")}</Items></Root>`;

test("parseProducts: Item blocks, entities, delisted items, other tag names", () => {
  const xml = file([item({ name: "קמח לבן &amp; עלית", price: "5.90", unitQty: 'ק"ג' }), item({ name: "מוצר ישן", price: "3", status: 0 }), item({ name: "חינם", price: "0" })]);
  const p = parseProducts(xml);
  assert.equal(p.length, 1);
  assert.equal(p[0].name, "קמח לבן & עלית");
  assert.equal(p[0].price, 5.9);
  const alt = parseProducts("<Root><Products><Product><ItemId>9</ItemId><ItemNm>שמן זית 750 מ\"ל</ItemNm><Price>31.9</Price><Qty>750</Qty><UnitQty>מ\"ל</UnitQty></Product></Products></Root>");
  assert.equal(alt.length, 1);
  assert.equal(alt[0].price, 31.9);
  assert.equal(alt[0].quantity, 750);
});

test("decodeBuffer handles utf-8, BOM, utf-16 and windows-1255; readPriceFile gunzips", () => {
  const s = "<Root>קמח לבן</Root>";
  assert.equal(decodeBuffer(Buffer.from(s, "utf8")), s);
  assert.equal(decodeBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, "utf8")])), s);
  assert.equal(decodeBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")])), s);
  const cp1255 = Buffer.from([0x3c, 0x61, 0x3e, 0xf7, 0xee, 0xf7, 0x3c, 0x2f, 0x61, 0x3e]); // <a>קמק</a> in cp1255 (0xf7 = ק, 0xee = מ)
  assert.equal(decodeBuffer(cp1255), "<a>קמק</a>");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-"));
  const f = path.join(dir, "PriceFull1-001.gz");
  fs.writeFileSync(f, zlib.gzipSync(Buffer.from(s, "utf8")));
  assert.equal(readPriceFile(f), s);
});

test("sizeFromName and normalisePrice", () => {
  assert.deepEqual(sizeFromName('קמח לבן עלית 1 ק"ג'), { base: "g", amount: 1000 });
  assert.deepEqual(sizeFromName("חומוס מבושל 400 גרם"), { base: "g", amount: 400 });
  assert.deepEqual(sizeFromName("חלב 3% 1 ליטר"), { base: "ml", amount: 1000 });
  assert.deepEqual(sizeFromName('שמן זית 750 מ"ל'), { base: "ml", amount: 750 });
  assert.deepEqual(sizeFromName("ביצים L 12 יחידות"), { base: "u", amount: 12 });
  assert.equal(sizeFromName("מוצר בלי כמות"), null);
  assert.equal(normalisePrice({ weighted: true, price: 8 }, "g").perBase, 0.008);
  assert.equal(normalisePrice({ weighted: true, price: 8 }, "ml"), null);
  assert.equal(normalisePrice({ name: "קמח 1 ק\"ג", desc: "", price: 5, quantity: 1, unitQty: "יחידה" }, "g").perBase, 0.005);
  assert.equal(normalisePrice({ name: "סוכר", desc: "", price: 6, quantity: 1, unitQty: 'ק"ג' }, "g").perBase, 0.006); // falls back to Quantity/UnitQty
  assert.equal(normalisePrice({ name: "חלב 1 ליטר", desc: "", price: 7, quantity: 1, unitQty: "יחידה" }, "g"), null); // wrong base
});

test("matcherFor: all words of an alias, exclusions, plural stems", () => {
  const flour = { id: "flour", name: "קמח לבן", aliases: ["קמח"], pack: { size: 1000 } };
  const m = matcherFor(flour);
  assert.ok(m('קמח לבן עלית 1 ק"ג'));
  assert.ok(m("קמח חיטה רגיל"));
  assert.ok(!m("קמח תופח 1 קג")); // default exclusion
  assert.ok(!m("עוגיות קמח שקדים"));
  const olive = matcherFor({ id: "olive-oil", name: "שמן זית", aliases: [], pack: { size: 750 } });
  assert.ok(olive("שמן זית כתית מעולה 750 מל"));
  assert.ok(!olive("שמן קנולה 1 ליטר"));
  const custom = matcherFor(flour, { flour: { exclude: ["מלא"] } });
  assert.ok(!custom("קמח מלא 1 קג"));
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("buildPriceTable: median pack price, outliers dropped, sparse matches omitted", () => {
  const ingredients = loadRaw().ingredients.filter((i) => ["flour", "olive-oil", "onion", "tahini"].includes(i.id));
  const flour = (n, price) => ({ name: `קמח לבן ${n} 1 ק"ג`, desc: "", price, quantity: 1, unitQty: 'ק"ג', weighted: false });
  const products = new Map([
    ["shufersal", [flour("עלית", 5), flour("סופר", 6), flour("שף", 4), flour("מותג יקר", 40) /* outlier */, { name: "בצל יבש", desc: "", price: 6, weighted: true }, { name: "בצל סגול", desc: "", price: 9, weighted: true }, { name: "בצל לבן", desc: "", price: 7, weighted: true }, { name: "בצל צהוב", desc: "", price: 6.5, weighted: true }, { name: 'טחינה גולמית 500 גרם', desc: "", price: 24, quantity: 500, unitQty: "גרם" }]],
    ["ramilevy", [flour("עלית", 4.5), flour("סופר", 5), flour("שף", 5.5)]],
  ]);
  ingredients.push({ id: "red-onion", name: "בצל סגול", aliases: [], aisle: "produce", base: "g", pack: { type: "loose", size: 1000, step: 100 }, flags: [] });
  const { table, report } = buildPriceTable(ingredients, products, { minMatches: 3 });
  assert.equal(table.flour.shufersal, 5); // median of 4,5,6 (40 dropped as an outlier)
  assert.equal(table.flour.ramilevy, 5);
  assert.equal(table.onion.shufersal, 6.5); // per kg: red onion (9) belongs to "red-onion", so median of 6, 6.5, 7
  assert.equal(table["red-onion"], undefined); // a single product is not enough evidence
  assert.equal(table.tahini, undefined); // only one match -> not enough evidence
  assert.equal(table["olive-oil"], undefined);
  assert.equal(report.find((r) => r.id === "tahini").stores.shufersal.matches, 1);
});

test("loadStoreProducts reads a folder of .xml and .gz and skips promo/store files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-"));
  fs.writeFileSync(path.join(dir, "PriceFull1.xml"), file([item({ name: "קמח לבן 1 ק\"ג", price: 5 })]));
  fs.writeFileSync(path.join(dir, "PriceFull2.gz"), zlib.gzipSync(Buffer.from(file([item({ name: "סוכר לבן 1 ק\"ג", price: 6 })]))));
  fs.writeFileSync(path.join(dir, "PromoFull1.xml"), file([item({ name: "מבצע", price: 1 })]));
  fs.writeFileSync(path.join(dir, "Stores1.xml"), "<Root/>");
  const products = loadStoreProducts(dir);
  assert.deepEqual(products.map((p) => p.name).sort(), ['סוכר לבן 1 ק"ג', 'קמח לבן 1 ק"ג']);
});
