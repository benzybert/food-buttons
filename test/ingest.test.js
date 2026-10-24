import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProducts, parseStores, decodeBuffer, readPriceFile, readCsv, sizeFromName, normalisePrice, matcherFor, median, buildPriceTable, loadStoreProducts, loadBranches, loadRules, isGlobalBarcode, mergePrices } from "../tools/ingest-prices.js";
import { loadRaw } from "./helpers.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ingest-"));

const item = (o) => `<Item><PriceUpdateDate>2026-10-01 06:00</PriceUpdateDate><ItemCode>${o.code || "1"}</ItemCode><ItemType>1</ItemType><ItemName>${o.name}</ItemName><ManufacturerName>x</ManufacturerName><UnitQty>${o.unitQty ?? 'ק"ג'}</UnitQty><Quantity>${o.quantity ?? 1}</Quantity><bIsWeighted>${o.weighted ? 1 : 0}</bIsWeighted><UnitOfMeasure>100 גרם</UnitOfMeasure><QtyInPackage>0</QtyInPackage><ItemPrice>${o.price}</ItemPrice><UnitOfMeasurePrice>0</UnitOfMeasurePrice><AllowDiscount>1</AllowDiscount><ItemStatus>${o.status ?? 1}</ItemStatus></Item>`;
const file = (items) => `<?xml version="1.0" encoding="utf-8"?><Root><ChainId>1</ChainId><StoreId>1</StoreId><Items Count="${items.length}">${items.join("")}</Items></Root>`;

test("parseProducts: Item blocks, entities, unpriced items, other tag names", () => {
  // ItemStatus is not a delisted flag: real files carry 0 on every item, so status 0 still counts.
  const xml = file([item({ name: "קמח לבן &amp; עלית", price: "5.90", unitQty: 'ק"ג' }), item({ name: "מוצר רגיל", price: "3", status: 0 }), item({ name: "חינם", price: "0" })]);
  const p = parseProducts(xml);
  assert.equal(p.length, 2);
  assert.equal(p[0].name, "קמח לבן & עלית");
  assert.equal(p[0].price, 5.9);
  assert.equal(p[0].store, "1");
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

// ------------------------------------------------------------------ real file formats
// test/fixtures holds a few items cut out of real files published by the chains (via OpenIsraeliSupermarkets'
// test resources): Super-Pharm (<Line>, blsWeighted with a lowercase L, one stray invalid UTF-8 byte), Zol Ubegadol
// (<Item>, gzipped, UnitQty "מיליליטרים"), and a Shufersal Stores file (uppercase SAP tags).

test("real Super-Pharm price file: <Line> items, Envelope store id, every ItemStatus 0 item kept", () => {
  const p = parseProducts(readPriceFile(path.join(FIXTURES, "PriceFull7290172900007-083-202409270311.xml")));
  assert.equal(p.length, 8);
  assert.ok(p.every((x) => x.store === "83" && isGlobalBarcode(x.code) && x.price > 0)); // one EAN-8 among them
  assert.ok(p.some((x) => x.name.includes("שמן זית")), "Hebrew decoded as UTF-8");
});

test("real Zol Ubegadol file: gzipped, plural unit names, weighted produce", () => {
  const p = parseProducts(readPriceFile(path.join(FIXTURES, "PriceFull7290876100000-003-202410070010.gz")));
  assert.equal(p.length, 12);
  const milk = p.find((x) => x.code === "7290000042640");
  assert.equal(milk.unitQty, "מיליליטרים");
  assert.equal(normalisePrice(milk, "ml").perBase, 3.9 / 250);
  assert.ok(p.find((x) => x.name === "קישוא עגול").weighted);
  assert.equal(p[0].store, "3"); // "003"
});

test("Stores files: branches with address and city, settlement codes named, empty values dropped", () => {
  const b = parseStores(readPriceFile(path.join(FIXTURES, "Stores7290027600007-000-202410020201")));
  assert.equal(b.length, 5);
  assert.deepEqual(b[0], { id: "1", name: 'שלי ת"א- בן יהודה', address: "בן יהודה 79", city: "תל אביב", zip: "6343504" });
  // What the chains publish today (October 2026): the city as a settlement code, ZIPCode in capitals.
  const live = parseStores("<Root><Store><StoreID>001</StoreID><StoreName>תלפיות</StoreName><Address>האומן,15</Address><City>3000</City><ZIPCode>9342110</ZIPCode></Store><Store><StoreID>007</StoreID><City>0</City><ZipCode>0000000</ZipCode></Store><Branch><StoreID>8</StoreID><City>unknown</City></Branch><Store><StoreID>9</StoreID><City>99999</City></Store></Root>");
  assert.deepEqual(live.map((x) => [x.id, x.city, x.cityCode ?? null, x.zip]), [["1", "ירושלים", "3000", "9342110"], ["7", "", null, ""], ["8", "", null, ""], ["9", "", "99999", ""]]);
  const dir = tmp();
  fs.copyFileSync(path.join(FIXTURES, "Stores7290027600007-000-202410020201"), path.join(dir, "Stores7290027600007-000-202410020201"));
  fs.copyFileSync(path.join(FIXTURES, "PriceFull7290172900007-083-202409270311.xml"), path.join(dir, "PriceFull1.xml"));
  assert.equal(loadBranches(dir).length, 5);
  assert.equal(loadStoreProducts(dir).length, 8, "the stores file is not read as prices");
});

test("matching on the real files: the right products, none of the look-alikes", () => {
  const ingredients = loadRaw().ingredients;
  const products = new Map([
    ["shufersal", parseProducts(readPriceFile(path.join(FIXTURES, "PriceFull7290876100000-003-202410070010.gz")))],
    ["ramilevy", parseProducts(readPriceFile(path.join(FIXTURES, "PriceFull7290172900007-083-202409270311.xml")))],
  ]);
  const { report } = buildPriceTable(ingredients, products, { rules: loadRules(), minMatches: 1 });
  const at = (id, sid) => report.find((r) => r.id === id).stores[sid];
  assert.equal(at("zucchini", "shufersal").price, 9.9); // weighted, per kg
  assert.equal(at("potato", "shufersal").price, 6.9);
  assert.equal(at("onion", "shufersal").matches, 0, "a pack of onion rings is not onions");
  assert.equal(at("flour", "shufersal").matches, 2);
  assert.ok(at("olive-oil", "ramilevy").matches >= 1);
  assert.equal(at("oil", "ramilevy").matches, 0, "bath oil is not cooking oil");
});

test("decodeBuffer keeps UTF-8 when one stray byte sits among Hebrew text", () => {
  const s = "<a>" + "קמח לבן ".repeat(40) + "</a>";
  const buf = Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0xff]), Buffer.from("<b>סוכר</b>", "utf8")]);
  assert.ok(decodeBuffer(buf).includes("סוכר"));
});

test("readPriceFile reads what there is of a truncated gzip", () => {
  const s = file([item({ name: 'קמח לבן 1 ק"ג', price: 5 }), item({ name: 'סוכר לבן 1 ק"ג', price: 6 })]);
  const gz = zlib.gzipSync(Buffer.from(s, "utf8"));
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "PriceFull9.gz"), gz.subarray(0, gz.length - 12));
  assert.ok(readPriceFile(path.join(dir, "PriceFull9.gz")).includes("קמח"));
});

test("readCsv: the dataset's CSVs, quoted commas, newlines and quotes inside fields, any column order", () => {
  const dir = tmp();
  const f = path.join(dir, "price_full_file_victory.csv");
  fs.writeFileSync(f, '\ufeffchainid,storeid,itemcode,itemname,itemprice,unitqty,quantity,bisweighted,itemstatus\r\n' + '7290696200003,12,7290000000001,"קמח לבן, 1 ק""ג",5.9,,,0,0\r\n' + '7290696200003,12,7290000000002,"שמן זית\nכתית 750 מ""ל",44.9,מיליליטרים,750,0,1\r\n' + "7290696200003,15,7290000000001,קמח לבן 1 קג,6.5,,,0,0\r\n");
  const rows = [];
  readCsv(f, (get) => rows.push([get(["ItemName"]), get(["itemprice"])]));
  assert.deepEqual(rows[0], ['קמח לבן, 1 ק"ג', "5.9"]);
  assert.equal(rows[1][0], 'שמן זית\nכתית 750 מ"ל');
  const p = loadStoreProducts(dir);
  assert.equal(p.length, 3);
  assert.deepEqual(new Set(p.map((x) => x.store)), new Set(["12", "15"]));
  assert.equal(loadStoreProducts(dir, { maxBranches: 1 }).length, 2, "at most one branch");
  fs.writeFileSync(path.join(dir, "store_file_victory.csv"), "storeid,storename,address,city,zipcode\n12,ויקטורי אשדוד,הבנים 4,אשדוד,7745104\n");
  assert.deepEqual(loadBranches(dir), [{ id: "12", name: "ויקטורי אשדוד", address: "הבנים 4", city: "אשדוד", zip: "7745104" }]);
  assert.equal(loadStoreProducts(dir).length, 3, "the store CSV is not prices");
});

test("loadStoreProducts: one row per branch and item code, the later file wins", () => {
  const dir = tmp();
  const withStore = (store, items) => `<Root><StoreId>${store}</StoreId><Items>${items.join("")}</Items></Root>`;
  fs.writeFileSync(path.join(dir, "PriceFull1-001-1.xml"), withStore("001", [item({ code: "7290000000001", name: "קמח", price: 5 })]));
  fs.writeFileSync(path.join(dir, "PriceFull1-001-2.xml"), withStore("001", [item({ code: "7290000000001", name: "קמח", price: 6 })]));
  fs.writeFileSync(path.join(dir, "PriceFull1-002-1.xml"), withStore("002", [item({ code: "7290000000001", name: "קמח", price: 7 })]));
  const p = loadStoreProducts(dir);
  assert.deepEqual(p.map((x) => [x.store, x.price]).sort(), [["1", 6], ["2", 7]]);
});

test("name matching: whole words, phrase near the start, exclusions unless part of the ingredient", () => {
  const ings = loadRaw().ingredients;
  const rules = loadRules();
  const m = (id) => matcherFor(ings.find((i) => i.id === id), rules);
  assert.ok(m("sugar")('סוכר לבן 1 ק"ג'));
  assert.ok(!m("sugar")("ריקולה סוכריות 50 גרם"), "סוכר is not סוכריות");
  assert.ok(!m("oil")('בלנאום שמן רחצה 500 מ"ל'));
  assert.ok(m("oil")("שמן קנולה 1 ליטר"));
  assert.ok(m("soy-sauce")('רוטב סויה 700 מל'), "רוטב is excluded, except where it is the ingredient");
  assert.ok(!m("onion")("קנור מרק בצל 225 גרם"));
  assert.ok(!m("rice-basmati")("פתיתים אפויים בניחוח אורז בסמטי"), "the phrase starts too far in");
  assert.ok(m("chicken-stock")("קנור אבקת מרק עוף 400 גרם"), "one brand word first is fine");
  assert.ok(m("olive-oil")("לייף וולנס שמן זית כתית מעולה 750 מל"), "two brand words first are fine");
  assert.ok(!m("cream")("SOS DERMAL CREAM 15ML"), "English aliases are for recipes, not for the price files");
  assert.ok(!m("salt")("חמאה מפינלנד ללא מלח"), "what follows ללא is not the product");
  assert.ok(!m("strawberry")("יוגורט עם תות"));
});

test("loose produce is priced only from items sold by weight, unless the rules allow packs", () => {
  const ings = loadRaw().ingredients.filter((i) => ["onion", "mushroom"].includes(i.id));
  const w = (name, price) => ({ name, desc: "", price, weighted: true, code: "" });
  const pack = (name, price) => ({ name, desc: "", price, weighted: false, code: "" });
  const products = new Map([["a", [w("בצל יבש", 5), w("בצל לבן", 6), w("בצל צהוב", 7), pack("בצל קצוץ קפוא 400 גרם", 9), pack("פטריות שמפיניון 250 גרם", 7), pack("פטריות 250 גרם", 8), pack("פטריות פרוסות 250 גרם", 9)]]]);
  const { table, report } = buildPriceTable(ings, products, { rules: { mushroom: { packaged: true } }, minMatches: 3 });
  assert.equal(table.onion.a, 6);
  assert.equal(report.find((r) => r.id === "onion").stores.a.matches, 3);
  assert.equal(table.mushroom.a, 32); // 8 per 250 g -> 32 per kg
});

test("barcodes carry a match to chains that spell the name differently; ambiguous and in-store codes do not", () => {
  const ings = loadRaw().ingredients.filter((i) => ["olive-oil", "flour"].includes(i.id));
  const prod = (code, name, price) => ({ code, name, desc: "", price, weighted: false });
  const products = new Map([
    ["a", [prod("7290000000101", 'שמן זית כתית 750 מ"ל', 45), prod("7290000000102", 'שמן זית 750 מ"ל', 40), prod("7290000000103", 'שמן זית בשן 750 מ"ל', 50)]],
    // chain b abbreviates the names so they do not match by name at all
    ["b", [prod("7290000000101", 'ש.ז. כתית 750 מ"ל', 46), prod("7290000000102", 'ש.ז 750 מ"ל', 41), prod("7290000000103", 'ש"ז בשן 750 מ"ל', 49), prod("2000000000104", 'ש"ז בתפזורת 750 מ"ל', 1)]],
  ]);
  const { table, report } = buildPriceTable(ings, products, { minMatches: 3 });
  assert.equal(table["olive-oil"].a, 45);
  assert.equal(table["olive-oil"].b, 46);
  assert.equal(report.find((r) => r.id === "olive-oil").stores.b.byBarcode, 3);
  assert.ok(isGlobalBarcode("7290000000101") && isGlobalBarcode("12345678"));
  assert.ok(!isGlobalBarcode("2000000000104") && !isGlobalBarcode("5522") && !isGlobalBarcode(""));
  // a barcode listed in the rules for one ingredient and matched by name to another is nobody's
  const { report: r2 } = buildPriceTable(ings, products, { rules: { flour: { barcodes: ["7290000000101"] } }, minMatches: 1 });
  assert.equal(r2.find((r) => r.id === "olive-oil").stores.b.byBarcode, 2);
  assert.equal(r2.find((r) => r.id === "flour").stores.b.matches, 0);
});

test("mergePrices: real kind, per-chain sources, a chain missing tonight keeps its last prices", () => {
  const previous = { meta: { kind: "real", updated: "2026-10-20", sources: { victory: { updated: "2026-10-20", source: "kaggle" }, shufersal: { updated: "2026-10-20", source: "scraper" } } }, table: { flour: { victory: 6, shufersal: 5 }, salt: { victory: 2 } } };
  const run = new Map([["shufersal", { source: "scraper", branches: 3, products: 900 }]]);
  const out = mergePrices(previous, { flour: { shufersal: 5.5 } }, run, { today: "2026-10-24", keepMissing: true });
  assert.equal(out.meta.kind, "real");
  assert.deepEqual(out.table, { flour: { shufersal: 5.5, victory: 6 }, salt: { victory: 2 } });
  assert.equal(out.meta.sources.victory.updated, "2026-10-20");
  assert.deepEqual(out.meta.sources.shufersal, { updated: "2026-10-24", source: "scraper", branches: 3, products: 900 });
  const fresh = mergePrices(previous, { flour: { shufersal: 5.5 } }, run, { today: "2026-10-24" });
  assert.deepEqual(fresh.table, { flour: { shufersal: 5.5 } });
});

test("live match report, October 2026: what went wrong on the chains' real files stays fixed", () => {
  const ings = loadRaw().ingredients;
  const rules = loadRules();
  const m = (id) => matcherFor(ings.find((i) => i.id === id), rules);
  const no = [
    ["sugar", "מנגו דל סוכר במשקל"], ["salt", "בייגלה מקלות מלח אסם"], ["honey", "פסטרמה מקורמלת דבש במשקל"], ["honey", "קורנפלקס דבש 448ג תלמה"],
    ["yogurt", "יוגורט תות/אפרסק סימ"], ["yogurt", "יוגורט עם אוכמניות שחורות בכוס"], ["milk", "חלב מרוכז ממותק 397 גרם"], ["soy-sauce", "אלפרו סויה וניל 1 ליטר"],
    ["flour", "קמח שקדים מיה 250 גר"], ["whole-flour", "לחם קמח מלא 100% 750 גרם"], ["dill", "שמנת שום שמיר 225 גר"], ["cumin", "גבינת גאודה כמון 28%"],
    ["mint", "חליטת צמחים נענע פומפדור"], ["eggs", "פורס ביצים פלסטיק"], ["raisins", "צימוקים בציפוי שוקולד מריר"], ["peanuts", "M&M's בוטנים 45 גרם"],
    ["eggplant", "חציל במיונז"], ["cabbage", "כרוב אדום"], ["ground-beef", "סינטה בשר בקר 100% קפוא"], ["pasta", "דלעת ספגטי"], ["rice-white", "פרגית ממולא אורז פטריות"],
    ["mushroom", "פטריות ברוביצקי במי מלח 680 גר"], ["oregano", "זיתים ירוקים אורגנו ופלפלים"], ["apple", "תפוח עץ מיובש טבעות במשקל"],
  ];
  for (const [id, name] of no) assert.ok(!m(id)(name), `${id} should not match "${name}"`);
  const yes = [["milk", "חלב טרי 2% דל לקטוז 1 ל"], ["sugar", 'סוכר לבן 1 ק"ג'], ["white-cheese", "גבינה לבנה 5% 250 גרם"], ["parmesan", "גבינת פרמזן 23% במשקל"], ["cooking-cream", "שמנת לבישול 15% 250 מל"], ["breadcrumbs", "פירורי לחם 500 גרם"], ["butter", "אלוויר חמאה רכה 250 גר"]];
  for (const [id, name] of yes) assert.ok(m(id)(name), `${id} should match "${name}"`);
  assert.deepEqual(sizeFromName("ביצים ארוזות 18יח L"), { base: "u", amount: 18 });
});

test("only strong matches of packaged ingredients lend their barcode", () => {
  const ings = loadRaw().ingredients.filter((i) => ["sugar", "onion"].includes(i.id));
  const prod = (code, name, price, weighted = false) => ({ code, name, desc: "", price, weighted });
  const products = new Map([
    ["a", [prod("7290000000201", "שלווה טבע סוכר חום 200 גרם", 9), prod("7290000000202", 'סוכר לבן 1 ק"ג', 5), prod("7290000000203", "בצל יבש", 6, true)]],
    ["b", [prod("7290000000201", "שלווה 200 ג", 9), prod("7290000000202", 'ס. לבן 1 ק"ג', 5), prod("7290000000203", "ירק במשקל", 6, true)]],
  ]);
  const { report } = buildPriceTable(ings, products, { minMatches: 1 });
  assert.equal(report.find((r) => r.id === "sugar").stores.b.byBarcode, 1, "the weak match (brand first) does not travel");
  assert.equal(report.find((r) => r.id === "onion").stores.b.matches, 0, "produce codes do not travel");
});
