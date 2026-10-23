import pytest

import service  # noqa: F401  (puts vendor/ on sys.path)
from hebrew import parse_hebrew_line, parse_ingredient_lines


@pytest.mark.parametrize("line, name, qty, unit", [
    ("2 כוסות קמח", "קמח", 2, "cup"),
    ("חצי כוס סוכר", "סוכר", 0.5, "cup"),
    ("3 שיני שום", "שום", 3, "clove"),
    ('500 גרם חזה עוף', "חזה עוף", 500, "g"),
    ('1.5 ק"ג תפוחי אדמה', "תפוחי אדמה", 1.5, "kg"),
    ("1/2 כוס חלב", "חלב", 0.5, "cup"),
    ("1 1/2 כוסות אורז", "אורז", 1.5, "cup"),
    ("2-3 עגבניות", "עגבניות", 3, ""),
    ("2 בצלים קצוצים", "בצלים", 2, ""),
    ("בצל - 2 יחידות", "בצל", 2, "unit"),
    ("קמח, 500 גרם", "קמח", 500, "g"),
    ("שלוש ביצים", "ביצים", 3, ""),
    ("2 כוסות של חלב", "חלב", 2, "cup"),
    ("• 1 חבילה פסטה (פנה)", "פסטה", 1, "package"),
])
def test_parses_quantity_unit_and_name(line, name, qty, unit):
    ingredient = parse_hebrew_line(line)
    assert ingredient is not None
    assert (ingredient.name, ingredient.quantity, ingredient.unit) == (name, qty, unit)


def test_percentage_stays_in_the_name():
    ingredient = parse_hebrew_line("גבינה 5% שומן")
    assert ingredient.name == "גבינה 5% שומן"
    assert ingredient.quantity == 1


def test_notes_are_split_off_the_name():
    ingredient = parse_hebrew_line("2 גזרים (גדולים), קצוצים דק")
    assert ingredient.name == "גזרים"
    assert "גדולים" in ingredient.notes


@pytest.mark.parametrize("line", ["מצרכים:", "אופן ההכנה", "לרוטב:", "", "א"])
def test_headers_and_blanks_are_skipped(line):
    assert parse_hebrew_line(line) is None


def test_pantry_items_are_flagged():
    flagged = {i.name: i.is_pantry for i in parse_ingredient_lines(
        "קורט מלח\n3 כפות שמן זית\nפלפל אדום\n2 כוסות קמח\nסוכר"
    )}
    assert flagged["קורט מלח"] and flagged["שמן זית"] and flagged["סוכר"]
    assert not flagged["פלפל אדום"] and not flagged["קמח"]


def test_english_lines_use_the_upstream_parser():
    ingredient = parse_ingredient_lines("2 cups flour")[0]
    assert (ingredient.name, ingredient.quantity, ingredient.unit) == ("flour", 2, "cups")


def test_mixed_list():
    names = [i.name for i in parse_ingredient_lines("מצרכים:\n2 כוסות קמח\n\n1 lb chicken\n3 ביצים")]
    assert names == ["קמח", "chicken", "ביצים"]
