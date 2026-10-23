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

const LATIN_WORD = /^[a-z]+$/;

/**
 * Very light stemmer, plural endings only: "גזרים" matches "גזר", "tomatoes" matches "tomato".
 * It is applied to both the catalog and the query, so it only has to be consistent, not correct.
 */
export function stem(token) {
  if (LATIN_WORD.test(token) && token.length > 3) {
    if (token.endsWith("ies")) return token.slice(0, -3) + "y";
    if (token.endsWith("oes")) return token.slice(0, -2);
    if (/(?:ch|sh|x|z|ss)es$/.test(token)) return token.slice(0, -2);
    if (/(?:ss|us|is)$/.test(token)) return token; // hummus, couscous, asparagus
    if (token.endsWith("s")) return token.slice(0, -1);
    return token;
  }
  if (token.length > 4 && (token.endsWith("ים") || token.endsWith("ות"))) return token.slice(0, -2);
  return token;
}

export function stemTokens(s) {
  return norm(s).split(" ").filter(Boolean).map(stem);
}

/** Which voice should read this text: "he" or "en", by whichever script has more letters (Hebrew when in doubt). */
export function textLang(text) {
  const hebrew = (String(text).match(/[\u0590-\u05FF]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  return latin > hebrew ? "en" : "he";
}
