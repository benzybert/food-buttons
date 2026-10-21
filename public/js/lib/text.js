// Hebrew text helpers used for matching ingredient names.

const NIQQUD = /[֑-ׇ]/g;

export function stripNiqqud(s) {
  return s.replace(NIQQUD, "");
}

/** Lowercase, drop niqqud and punctuation, unify quotes, collapse whitespace. */
export function norm(s) {
  return stripNiqqud(String(s))
    .toLowerCase()
    .replace(/[׳’‘`´]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/["']/g, "")
    .replace(/[^\p{L}\p{N}\s%]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Very light Hebrew stemmer: plural endings only, so "גזרים" matches "גזר". */
export function stem(token) {
  if (token.length > 4 && (token.endsWith("ים") || token.endsWith("ות"))) return token.slice(0, -2);
  return token;
}

export function stemTokens(s) {
  return norm(s).split(" ").filter(Boolean).map(stem);
}
