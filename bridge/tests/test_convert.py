import unittest

from cookidoo_api.types import (
    CookidooIngredient,
    CookidooRecipeStep,
    CookidooRecipeStepGroup,
    CookidooSearchRecipeHit,
    CookidooShoppingRecipeDetails,
)

from cookidoo_bridge.convert import html_to_text, ingredient_line, iso_duration, recipe_to_jsonld, search_hit, step_lines


def details(**over):
    base = dict(
        id="r12345",
        name="  Tomato soup ",
        ingredients=[
            CookidooIngredient(id="i1", name="onions", description="200 g", preparation="peeled and quartered"),
            CookidooIngredient(id="i2", name="olive oil", description="2 tbsp"),
            CookidooIngredient(id="i3", name="salt", description=""),
        ],
        thumbnail=None,
        image="https://img.example/soup.jpg",
        url="https://cookidoo.international/recipes/recipe/en/r12345",
        difficulty="easy",
        notes=["<p>Serve <b>hot</b>.</p>"],
        categories=[],
        collections=[],
        utensils=["TM6"],
        serving_size=4,
        active_time=900,
        total_time=4200,
        nutrition_groups=[],
        step_groups=[
            CookidooRecipeStepGroup(
                title="Soup",
                recipe_steps=[
                    CookidooRecipeStep(title="", formatted_text="Place <nobr>onion</nobr> into mixing bowl and chop <nobr>5 sec/speed 5</nobr>.<br/>Scrape down."),
                    CookidooRecipeStep(title="Cook", formatted_text="<p>Add oil and sauté <nobr>3 min/120°C/speed 1</nobr>.</p>"),
                ],
            ),
            CookidooRecipeStepGroup(title="", recipe_steps=[CookidooRecipeStep(title="", formatted_text="Serve &amp; enjoy")]),
        ],
    )
    base.update(over)
    return CookidooShoppingRecipeDetails(**base)


class HtmlToText(unittest.TestCase):
    def test_inline_tags_keep_machine_settings_together(self):
        self.assertEqual(html_to_text("chop <nobr>5 sec/speed 5</nobr>."), "chop 5 sec/speed 5.")

    def test_block_tags_separate_words(self):
        self.assertEqual(html_to_text("<p>one</p><p>two</p>a<br>b"), "one two a b")

    def test_entities_scripts_and_icon_alt_text(self):
        self.assertEqual(html_to_text("a &amp; b<script>alert(1)</script><style>x{}</style>"), "a & b")
        self.assertEqual(html_to_text('3 min/<img src="x.svg" alt="reverse">/speed 1'), "3 min/ reverse /speed 1")

    def test_empty_and_none(self):
        self.assertEqual(html_to_text(None), "")
        self.assertEqual(html_to_text(""), "")


class Durations(unittest.TestCase):
    def test_iso(self):
        self.assertEqual(iso_duration(0), "PT0M")
        self.assertEqual(iso_duration(None), "PT0M")
        self.assertEqual(iso_duration(900), "PT15M")
        self.assertEqual(iso_duration(3600), "PT1H")
        self.assertEqual(iso_duration(4200), "PT1H10M")
        self.assertEqual(iso_duration(89), "PT1M")  # rounded to minutes
        self.assertEqual(iso_duration(-5), "PT0M")


class Lines(unittest.TestCase):
    def test_ingredient_line(self):
        a, b, c = details().ingredients
        self.assertEqual(ingredient_line(a), "200 g onions, peeled and quartered")
        self.assertEqual(ingredient_line(b), "2 tbsp olive oil")
        self.assertEqual(ingredient_line(c), "salt")

    def test_step_lines_use_group_and_step_titles(self):
        self.assertEqual(
            step_lines(details().step_groups),
            [
                "Soup: Place onion into mixing bowl and chop 5 sec/speed 5. Scrape down.",
                "Cook: Add oil and sauté 3 min/120°C/speed 1.",
                "Serve & enjoy",
            ],
        )


class Recipe(unittest.TestCase):
    def test_jsonld_shape(self):
        r = recipe_to_jsonld(details())
        self.assertEqual(r["@type"], "Recipe")
        self.assertEqual(r["name"], "Tomato soup")
        self.assertEqual(r["recipeYield"], "4 servings")
        self.assertEqual((r["prepTime"], r["totalTime"]), ("PT15M", "PT1H10M"))
        self.assertEqual(len(r["recipeIngredient"]), 3)
        self.assertEqual([s["@type"] for s in r["recipeInstructions"]], ["HowToStep"] * 3)
        self.assertEqual(r["cookidoo"]["notes"], ["Serve hot."])
        self.assertEqual(r["cookidoo"]["id"], "r12345")

    def test_missing_servings_is_omitted_rather_than_zero(self):
        self.assertNotIn("recipeYield", recipe_to_jsonld(details(serving_size=0)))

    def test_search_hit(self):
        hit = CookidooSearchRecipeHit(id="r1", name=" Soup ", thumbnail="t", image="i", url="u")
        self.assertEqual(search_hit(hit), {"id": "r1", "name": "Soup", "thumbnail": "t", "url": "u"})


if __name__ == "__main__":
    unittest.main()
