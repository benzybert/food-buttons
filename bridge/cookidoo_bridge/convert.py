"""Turns Cookidoo recipe objects into the schema.org Recipe JSON the web app already knows how to import.

Everything here is a pure function over duck-typed objects (the dataclasses of cookidoo-api), so it is tested
without a network and without an account.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any

# Tags after which a new "line" starts, so "<p>a</p><p>b</p>" does not become "ab".
_BREAKS = {"br", "p", "div", "li", "ul", "ol", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}
_SKIPPED = {"script", "style"}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED:
            self._skip += 1
        elif tag in _BREAKS:
            self.parts.append(" ")
        elif tag == "img":  # machine settings such as "reverse" are sometimes icons with a text alternative
            alt = dict(attrs).get("alt")
            if alt:
                self.parts.append(f" {alt} ")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED:
            self._skip = max(0, self._skip - 1)
        elif tag in _BREAKS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(markup: str | None) -> str:
    """Plain text of an HTML snippet. Inline tags (such as <nobr>5 min/100°C/speed 2</nobr>) keep their text intact."""
    if not markup:
        return ""
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    text = "".join(parser.parts)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


def iso_duration(seconds: int | float | None) -> str:
    """Seconds -> ISO 8601 duration rounded to whole minutes ("PT1H10M")."""
    minutes = round(max(0, seconds or 0) / 60)
    hours, minutes = divmod(minutes, 60)
    return "PT" + (f"{hours}H" if hours else "") + (f"{minutes}M" if minutes or not hours else "")


def ingredient_line(ingredient: Any) -> str:
    """"200 g" + "onions" + "peeled" -> "200 g onions, peeled"."""
    quantity = (getattr(ingredient, "description", "") or "").strip()
    name = (getattr(ingredient, "name", "") or "").strip()
    line = f"{quantity} {name}".strip()
    preparation = (getattr(ingredient, "preparation", None) or "").strip()
    return f"{line}, {preparation}" if line and preparation else line


def step_lines(step_groups: list[Any]) -> list[str]:
    lines: list[str] = []
    for group in step_groups or []:
        group_title = (getattr(group, "title", "") or "").strip()
        for index, step in enumerate(getattr(group, "recipe_steps", []) or []):
            text = html_to_text(getattr(step, "formatted_text", ""))
            heading = (getattr(step, "title", "") or "").strip() or (group_title if index == 0 else "")
            line = f"{heading}: {text}" if heading and text else heading or text
            if line:
                lines.append(line)
    return lines


def recipe_to_jsonld(details: Any) -> dict[str, Any]:
    """schema.org/Recipe for a CookidooShoppingRecipeDetails, plus a small `cookidoo` block with source info."""
    servings = getattr(details, "serving_size", 0) or 0
    recipe: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": (getattr(details, "name", "") or "").strip(),
        "prepTime": iso_duration(getattr(details, "active_time", 0)),
        "totalTime": iso_duration(getattr(details, "total_time", 0)),
        "recipeIngredient": [line for line in (ingredient_line(i) for i in getattr(details, "ingredients", []) or []) if line],
        "recipeInstructions": [{"@type": "HowToStep", "text": line} for line in step_lines(getattr(details, "step_groups", []))],
        "cookidoo": {
            "id": getattr(details, "id", ""),
            "url": getattr(details, "url", None),
            "image": getattr(details, "image", None),
            "difficulty": getattr(details, "difficulty", None),
            "utensils": list(getattr(details, "utensils", []) or []),
            "notes": [text for text in (html_to_text(n) for n in getattr(details, "notes", []) or []) if text],
        },
    }
    if servings:
        recipe["recipeYield"] = f"{servings} servings"
    return recipe


def search_hit(hit: Any) -> dict[str, Any]:
    return {
        "id": getattr(hit, "id", ""),
        "name": (getattr(hit, "name", "") or "").strip(),
        "thumbnail": getattr(hit, "thumbnail", None),
        "url": getattr(hit, "url", None),
    }
