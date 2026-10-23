// Number/time/money formatting for Hebrew UI. Money is Intl-formatted; views wrap it in <bdi>.

const ils2 = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ils0 = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("he-IL", { style: "percent", maximumFractionDigits: 0 });

/** 12.4 -> "‏12.40 ‏₪", 1234.5 -> "‏1,235 ‏₪" */
export function money(n) {
  if (!Number.isFinite(n)) return "-";
  return Math.abs(n) >= 100 ? ils0.format(Math.round(n)) : ils2.format(n);
}

export const percent = (x) => pct.format(x);

/** 95 -> "שעה ו-35 דק׳", 45 -> "45 דק׳", 60 -> "שעה" */
export function duration(min) {
  min = Math.round(min);
  if (min <= 0) return "";
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hs = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  return m ? `${hs} ו-${m} דק׳` : hs;
}

/** 300 -> "5:00", 75 -> "1:15" for timers */
export function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

import { splitBySettings, extractSettings } from "./lib/parse.js";

/** Machine setting spoken in words: "5 דקות, 100 מעלות, מהירות 2". */
export function settingSpoken(s) {
  const parts = [];
  if (s.time) {
    const m = Math.floor(s.time / 60);
    const sec = s.time % 60;
    if (m) parts.push(m === 1 ? "דקה" : `${m} דקות`);
    if (sec) parts.push(`${sec} שניות`);
  }
  if (s.temp === "varoma") parts.push("וארומה");
  else if (s.temp) parts.push(`${s.temp} מעלות`);
  if (s.kneading) parts.push("תפקיד לישה");
  if (s.reverse) parts.push("הפוך");
  if (s.speed === "spoon") parts.push("מהירות כף");
  else if (s.speed === "turbo") parts.push("טורבו");
  else if (s.speed) parts.push(`מהירות ${s.speed.replace("–", " עד ")}`);
  return parts.join(", ");
}

/** A step's text prepared for speech synthesis: setting groups like "5 דק'/100°C/מהירות 2" become words. */
export function spokenStep(text) {
  return splitBySettings(text)
    .map((p) => (p.setting ? settingSpoken(extractSettings(p.text)[0]) : p.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Thermomix setting -> short Hebrew chip texts. */
export function settingParts(s) {
  const parts = [];
  if (s.time) parts.push(s.time >= 60 ? `${Math.floor(s.time / 60)}${s.time % 60 ? `:${String(s.time % 60).padStart(2, "0")}` : ""} דק׳` : `${s.time} שנ׳`);
  if (s.temp === "varoma") parts.push("Varoma");
  else if (s.temp) parts.push(`${s.temp}°C`);
  if (s.kneading) parts.push("תפקיד לישה");
  if (s.reverse) parts.push("↺");
  if (s.speed === "spoon") parts.push("מהירות כף");
  else if (s.speed === "turbo") parts.push("טורבו");
  else if (s.speed) parts.push(`מהירות ${s.speed}`);
  return parts;
}

export const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const MEAL_SLOTS = [
  { id: "lunch", label: "צהריים" },
  { id: "dinner", label: "ערב" },
];

export function hebrewDate(d = new Date()) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

/** +₪4.50 / −₪2.00 (always with an explicit sign) */
export function signedMoney(n) {
  if (Math.abs(n) < 0.005) return money(0);
  return `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`;
}

/** plural(1, "פריט", "פריטים") -> "פריט אחד"; plural(3, ...) -> "3 פריטים" (masculine nouns) */
export function countOf(n, one, many) {
  return n === 1 ? `${one} אחד` : `${n} ${many}`;
}

/** Money for plain-text messages (WhatsApp, clipboard): no bidi marks, "64 ₪" / "12.40 ₪". */
export function plainMoney(n) {
  if (!Number.isFinite(n)) return "-";
  const v = Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(2).replace(/\.00$/, "");
  return `${v} ₪`;
}

/** 21.10 -> "21.10.2026" style short date for lists */
export function hebrewShort(d) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" }).format(d);
}

/** "מתכון אחד" / "3 מתכונים" */
export const recipesWord = (n) => (n === 1 ? "מתכון אחד" : `${n} מתכונים`);
/** "מנה אחת" / "4 מנות" */
export const servingsWord = (n) => (n === 1 ? "מנה אחת" : `${n} מנות`);
