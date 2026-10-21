import test from "node:test";
import assert from "node:assert/strict";
import { icsEscape, foldLine, buildIcs, nextWeekday } from "../public/js/lib/ics.js";

test("icsEscape follows RFC 5545 text escaping", () => {
  assert.equal(icsEscape("a;b,c\\d\ne"), "a\;b\\,c\\\\d\\ne");
});

test("foldLine: lines are at most 75 octets and never split a character", () => {
  const long = "SUMMARY:" + "מרק עוף של שישי ".repeat(12);
  const folded = foldLine(long);
  const enc = new TextEncoder();
  for (const l of folded.split("\r\n")) assert.ok(enc.encode(l).length <= 75, `too long: ${enc.encode(l).length}`);
  assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), long);
  assert.equal(foldLine("short"), "short");
});

test("nextWeekday: today counts, otherwise the coming one", () => {
  const wed = new Date(2026, 9, 21, 10, 0); // Wed 21 Oct 2026
  assert.equal(wed.getDay(), 3);
  const same = nextWeekday(3, wed, 19);
  assert.deepEqual([same.getMonth(), same.getDate(), same.getHours()], [9, 21, 19]);
  const fri = nextWeekday(5, wed, 13, 30);
  assert.deepEqual([fri.getMonth(), fri.getDate(), fri.getHours(), fri.getMinutes()], [9, 23, 13, 30]);
  const sun = nextWeekday(0, wed, 19);
  assert.deepEqual([sun.getMonth(), sun.getDate()], [9, 25]);
});

test("buildIcs produces a valid-looking calendar with CRLF endings", () => {
  const ics = buildIcs([{ uid: "b1", start: new Date(2026, 9, 23, 19, 0), minutes: 90, summary: "🍲 מרק, עוף", description: "5 מנות\nשוקי עוף" }], { now: new Date(Date.UTC(2026, 9, 21, 12, 0, 0)) });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART:20261023T190000\r\n/);
  assert.match(ics, /DTEND:20261023T203000\r\n/);
  assert.match(ics, /DTSTAMP:20261021T120000Z\r\n/);
  assert.match(ics, /SUMMARY:🍲 מרק\\, עוף/);
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line breaks");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
