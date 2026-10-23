// Minimal iCalendar (RFC 5545) writer, enough to export the weekly meal plan to any calendar app.

const enc = new TextEncoder();

/** Escape TEXT values: backslash, semicolon, comma, newline. */
export function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line to at most 75 octets per line (continuations start with one space), never splitting a character. */
export function foldLine(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * events: [{ uid, start: Date, minutes, summary, description? }]. Times are "floating" (the viewer's own time zone).
 */
export function buildIcs(events, { now = new Date(), calendarName = "תכנון שבועי" } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//food-buttons//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(calendarName)}`];
  for (const e of events) {
    const end = new Date(e.start.getTime() + (e.minutes || 60) * 60000);
    lines.push("BEGIN:VEVENT", `UID:${icsEscape(e.uid)}@food-buttons`, `DTSTAMP:${utc(now)}`, `DTSTART:${local(e.start)}`, `DTEND:${local(end)}`, `SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The next date (today included) that falls on weekday `day` (0 = Sunday), at hour:minute local time. */
export function nextWeekday(day, from, hour, minute = 0) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute, 0, 0);
  d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7));
  return d;
}
