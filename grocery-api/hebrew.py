"""Hebrew ingredient-line parsing.

The upstream parser only knows English units ("cups", "tbsp"), so a line like
"2 כוסות קמח" would come out as the ingredient "כוסות קמח". Lines with Hebrew
letters are parsed here; everything else goes through the upstream parser.
"""
from __future__ import annotations

import re
from typing import Optional

from models import IngredientIntent
from recipes.parser import _parse_ingredient_line as parse_english_line

_HEBREW = re.compile(r"[֐-׿]")

# Hebrew unit word -> canonical unit (same vocabulary as the upstream parser)
_UNITS: dict[str, str] = {
    "כוס": "cup", "כוסות": "cup", "כוסית": "cup",
    "כף": "tbsp", "כפות": "tbsp",
    "כפית": "tsp", "כפיות": "tsp",
    "גרם": "g", "גר'": "g", "גר": "g", "ג'": "g",
    'ק"ג': "kg", "קג": "kg", "קילו": "kg", "קילוגרם": "kg",
    'מ"ל': "ml", "מל": "ml", "מיליליטר": "ml",
    "ליטר": "l", "ליטרים": "l",
    "יחידה": "unit", "יחידות": "unit",
    "שן": "clove", "שיני": "clove", "שיניים": "clove",
    "חבילה": "package", "חבילות": "package", "אריזה": "package", "אריזות": "package",
    "קופסה": "can", "קופסאות": "can", "קופסת": "can", "פחית": "can", "פחיות": "can",
    "שימורים": "can",
    "צרור": "bunch", "צרורות": "bunch",
    "פרוסה": "slice", "פרוסות": "slice",
    "חתיכה": "piece", "חתיכות": "piece",
}

# Units where the number counts whole packages in a shop
PACKAGE_UNITS = frozenset({"package", "can"})
WEIGHT_UNITS = {"g": 0.001, "kg": 1.0}
# Counted whole items (3 tomatoes, 2 cloves): no unit at all also means a count
PIECE_UNITS = frozenset({"", "unit", "piece", "clove", "slice"})

_WORD_NUMBERS: dict[str, float] = {
    "חצי": 0.5, "רבע": 0.25, "שליש": 1 / 3, "אחד": 1, "אחת": 1,
    "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2, "שלוש": 3, "שלושה": 3,
    "ארבע": 4, "ארבעה": 4, "חמש": 5, "חמישה": 5, "שש": 6, "שישה": 6,
}
_FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}

_NUMBER = r"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])"
_RANGE = rf"{_NUMBER}(?:\s*[-–]\s*{_NUMBER})?"
_LEADING_QTY = re.compile(rf"^(?P<qty>{_RANGE})\s*")
_SEPARATOR_QTY = re.compile(
    rf"^(?P<name>.+?)\s*(?:[-–:,]|\s)\s*(?P<qty>{_RANGE})(?![\d%])\s*(?P<rest>(?!%).*)$"
)

# Words after the ingredient that describe preparation, not the product
_PREP_WORDS = frozenset({
    "קצוץ", "קצוצה", "קצוצים", "קצוצות", "מגורד", "מגורדת", "מגורדים",
    "פרוס", "פרוסה", "פרוסים", "פרוסות", "חתוך", "חתוכה", "חתוכים", "חתוכות",
    "מרוסק", "מרוסקים", "מרוסקת", "מבושל", "מבושלים", "מבושלת", "מומס", "מומסת",
    "מוקרם", "שטוף", "שטופים", "לקישוט", "להגשה", "לפי", "אופציונלי", "אופציונלית",
    "בקוביות", "בפרוסות", "בטמפרטורת",
})

_HEADER_START = (
    "מצרכים", "רכיבים", "אופן הכנה", "אופן ההכנה", "הוראות", "הכנה", "לרוטב",
    "לבצק", "למילוי", "לקישוט", "להגשה", "לתוספת", "טיפ", "הערה", "הערות",
)

# Pantry items (matched as whole words), skipped unless the user asks for them
_PANTRY_WORDS = frozenset({
    "מלח", "פלפל שחור", "סוכר", "שמן", "שמן זית", "מים", "אבקת אפייה", "אבקת אפיה",
    "סודה לשתייה", "תבלין", "תבלינים", "כמון", "פפריקה", "כורכום", "קינמון",
    "אורגנו", "עלי דפנה", "אבקת שום", "אבקת בצל", "וניל", "תמצית וניל",
})


def has_hebrew(text: str) -> bool:
    return bool(_HEBREW.search(text))


def _to_number(text: str) -> float:
    text = text.strip().replace(",", ".")
    for char, value in _FRACTIONS.items():
        text = text.replace(char, str(value))
    if " " in text and "/" in text:
        whole, frac = text.split(None, 1)
        num, den = frac.split("/")
        return float(whole) + float(num) / float(den)
    if "/" in text:
        num, den = text.split("/")
        return float(num) / float(den) if float(den) else 1.0
    return float(text)


def _range_to_number(text: str) -> float:
    """'2-3' -> 3 (buy for the upper end)."""
    parts = [p for p in re.split(r"\s*[-–]\s*", text.strip()) if p]
    return max(_to_number(p) for p in parts)


def _is_pantry(name: str) -> bool:
    words = f" {name} "
    return any(f" {item} " in words for item in _PANTRY_WORDS)


def _clean_name(text: str) -> tuple[str, str]:
    """Return (name, notes): drop parentheses, 'של', and trailing preparation words."""
    notes = ""
    paren = re.search(r"\(([^)]*)\)", text)
    if paren:
        notes = paren.group(1).strip()
        text = (text[: paren.start()] + " " + text[paren.end():]).strip()
    if "," in text:
        text, _, tail = text.partition(",")
        notes = f"{notes} {tail.strip()}".strip()
    words = text.replace("־", " ").split()
    if words and words[0] == "של":
        words = words[1:]
    cut = next((i for i, w in enumerate(words) if i > 0 and w in _PREP_WORDS), None)
    if cut is not None:
        notes = f"{' '.join(words[cut:])} {notes}".strip()
        words = words[:cut]
    return " ".join(words).strip(" -–:."), notes


def _split_unit(text: str) -> tuple[str, str]:
    """Take a leading unit word off the text. Returns (unit, remainder)."""
    words = text.split(None, 1)
    if words and words[0] in _UNITS:
        return _UNITS[words[0]], words[1] if len(words) > 1 else ""
    return "", text


def _split_leading_quantity(line: str) -> tuple[Optional[float], str]:
    match = _LEADING_QTY.match(line)
    if match:
        return _range_to_number(match.group("qty")), line[match.end():]
    first, _, rest = line.partition(" ")
    if first in _WORD_NUMBERS:
        return _WORD_NUMBERS[first], rest
    return None, line


def parse_hebrew_line(line: str) -> Optional[IngredientIntent]:
    original = line.strip().lstrip("-•*●◦‣·").strip()
    if len(original) < 2:
        return None
    if original.endswith(":") or original.startswith(_HEADER_START):
        return None
    if len(original) > 80:  # a sentence from the method, not an ingredient
        return None

    qty, rest = _split_leading_quantity(original)
    unit = ""
    if qty is not None:
        unit, rest = _split_unit(rest.strip())
        name, notes = _clean_name(rest)
    else:
        # "קמח - 2 כוסות" / "קמח, 500 גרם"
        trailing = _SEPARATOR_QTY.match(original)
        if trailing:
            qty = _range_to_number(trailing.group("qty"))
            unit, tail = _split_unit(trailing.group("rest").strip())
            name, notes = _clean_name(trailing.group("name"))
            notes = f"{notes} {tail}".strip()
        else:
            name, notes = _clean_name(original)
            qty = 1.0

    if len(name) < 2:
        return None
    return IngredientIntent(
        raw=original,
        name=name,
        quantity=qty if qty else 1.0,
        unit=unit,
        is_pantry=_is_pantry(name),
        notes=notes,
        search_terms=[name],
    )


def parse_ingredient_lines(text: str) -> list[IngredientIntent]:
    """One ingredient per line, Hebrew or English. Unparseable lines are dropped."""
    ingredients: list[IngredientIntent] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        intent = parse_hebrew_line(line) if has_hebrew(line) else parse_english_line(line)
        if intent is not None:
            ingredients.append(intent)
    return ingredients
