// Sharon, Thermomix and groceries pages. Server data is only ever inserted with textContent.
(() => {
  const DRAFT_KEY = "groceryDraft";
  const BACK_LINKS = new Set(["/sharon/", "/thermomix/"]);
  const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function saveDraft(draft) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* private mode: the groceries page will ask for the list again */
    }
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && typeof draft.text === "string" ? draft : null;
    } catch {
      return null;
    }
  }

  function goShopping(draft) {
    saveDraft(draft);
    location.href = "/groceries/";
  }

  // ---- Thermomix and Sharon (recipe tab) ----

  function initRecipeForm(back) {
    const title = $("title");
    const list = $("ingredients");
    const shop = $("shop");
    const sync = () => {
      shop.disabled = !list.value.trim();
    };
    list.addEventListener("input", sync);
    sync();
    return () => ({ title: title.value.trim(), text: list.value, back });
  }

  function initThermomix() {
    const read = initRecipeForm("/thermomix/");
    $("shop").addEventListener("click", () => goShopping(read()));
  }

  async function loadDishes() {
    try {
      const res = await fetch("/menu.json", { cache: "no-cache" });
      const data = await res.json();
      return Array.isArray(data.dishes) ? data.dishes : [];
    } catch {
      return [];
    }
  }

  async function initSharon() {
    const shop = $("shop");
    const panels = { menu: $("panel-menu"), recipe: $("panel-recipe") };
    const readRecipe = initRecipeForm("/sharon/");
    const dishes = (await loadDishes()).filter((d) => d && typeof d.name === "string");
    const picked = new Set();

    const source = () => document.querySelector('input[name="source"]:checked').value;
    const pickedLines = () =>
      dishes
        .filter((_, i) => picked.has(i))
        .flatMap((d) => (Array.isArray(d.ingredients) ? d.ingredients.filter((l) => typeof l === "string") : []));

    function refresh() {
      const isMenu = source() === "menu";
      panels.menu.hidden = !isMenu;
      panels.recipe.hidden = isMenu;
      shop.disabled = isMenu ? pickedLines().length === 0 : !$("ingredients").value.trim();
      const withoutList = dishes.some((d, i) => picked.has(i) && !(Array.isArray(d.ingredients) && d.ingredients.length));
      $("menu-note").hidden = !(isMenu && withoutList);
    }

    $("menu-empty").hidden = dishes.length > 0;
    dishes.forEach((dish, i) => {
      const id = `dish-${i}`;
      const box = el("input");
      box.type = "checkbox";
      box.id = id;
      box.addEventListener("change", () => {
        box.checked ? picked.add(i) : picked.delete(i);
        refresh();
      });
      const label = el("label", "dish");
      label.htmlFor = id;
      label.append(box, el("span", "", dish.name));
      const item = el("li");
      item.append(label);
      $("dishes").append(item);
    });

    document.querySelectorAll('input[name="source"]').forEach((r) => r.addEventListener("change", refresh));
    $("ingredients").addEventListener("input", refresh);
    refresh();

    shop.addEventListener("click", () => {
      if (source() === "menu") {
        const names = dishes.filter((_, i) => picked.has(i)).map((d) => d.name);
        goShopping({ title: names.join(", "), text: pickedLines().join("\n"), back: "/sharon/" });
      } else {
        goShopping(readRecipe());
      }
    });
  }

  // ---- Groceries page ----

  function offerRow(store, offer, isBest) {
    const row = el("div", "offer" + (isBest ? " best" : ""));
    row.append(el("span", "offer-store", store.name));
    if (!offer) {
      row.append(el("span", "offer-none", store.available ? "לא נמצא" : "לא זמין כרגע"));
      return row;
    }
    const product = el("span", "offer-product");
    const label = [offer.name, offer.brand, offer.size].filter(Boolean).join(" · ");
    if (offer.url) {
      const link = el("a", "", label);
      link.href = offer.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      product.append(link);
    } else {
      product.textContent = label;
    }
    if (offer.on_sale) product.append(" ", el("span", "tag", "מבצע"));
    if (offer.uncertain) product.append(" ", el("span", "tag warn", "בדקו שזה המוצר"));

    const price = el("span", "offer-price");
    price.append(el("strong", "", money.format(offer.line_cost)));
    const unitPrice = money.format(offer.price) + (offer.per_kg ? " לק״ג" : "");
    price.append(el("small", "", `${unitPrice} · ${offer.amount_basis}`));

    row.append(product, price);
    if (isBest) row.append(el("span", "tag good", "הכי זול"));
    return row;
  }

  function renderResults(data) {
    const stores = Object.entries(data.stores).map(([id, s]) => ({ id, ...s }));
    const byId = Object.fromEntries(stores.map((s) => [s.id, s]));

    $("results-title").textContent = data.title ? `השוואת מחירים: ${data.title}` : "השוואת מחירים";

    const summary = $("summary");
    summary.replaceChildren();
    for (const store of stores) {
      const isBest = store.id === data.best_store && stores.length > 1;
      const card = el("div", "store" + (isBest ? " best" : ""));
      card.append(el("span", "store-name", store.name));
      card.append(el("strong", "store-total", store.available ? money.format(store.total) : "לא זמין"));
      const detail = store.available
        ? `${store.matched} מוצרים נמצאו` + (store.missing ? `, ${store.missing} חסרים` : "")
        : "לא הצלחנו להתחבר לחנות";
      card.append(el("span", "store-detail", detail));
      if (isBest) card.append(el("span", "tag good", data.best_reason === "cheapest" ? "הזול ביותר" : "נמצאו בו הכי הרבה מוצרים"));
      summary.append(card);
    }

    const split = $("split");
    split.textContent = "";
    if (data.split_saving >= 0.5 && stores.filter((s) => s.matched).length > 1) {
      split.textContent =
        `אם קונים כל מצרך איפה שהוא הכי זול: ${money.format(data.split_total)} ` +
        `(חוסכים עוד ${money.format(data.split_saving)}).`;
    }

    const items = $("items");
    items.replaceChildren();
    for (const ing of data.ingredients) {
      const li = el("li", "item" + (ing.skipped ? " skipped" : ""));
      li.append(el("h3", "", ing.raw));
      if (ing.skipped) {
        li.append(el("p", "muted", `${ing.skip_reason}, לא נכלל בחישוב`));
      } else {
        for (const store of stores) {
          li.append(offerRow(byId[store.id], ing.offers[store.id], ing.best_store === store.id && stores.length > 1));
        }
      }
      items.append(li);
    }

    $("note").textContent = data.note || "";
    $("results").hidden = false;
  }

  async function compare(text, includePantry, title) {
    const status = $("status");
    const go = $("go");
    status.textContent = "משווים מחירים בשופרסל ובטיב טעם…";
    status.className = "status busy";
    go.disabled = true;
    $("results").hidden = true;
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title, include_pantry: includePantry }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "משהו השתבש, נסו שוב");
      renderResults(data);
      const down = Object.values(data.stores).every((s) => !s.available);
      status.textContent = down ? "לא הצלחנו להתחבר לשופרסל ולטיב טעם כרגע, נסו שוב עוד כמה דקות" : "";
      status.className = down ? "status error" : "status";
      $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (err) {
      status.textContent = err instanceof TypeError ? "אין חיבור לשרת, נסו שוב" : err.message;
      status.className = "status error";
    } finally {
      go.disabled = false;
    }
  }

  function initGroceries() {
    const draft = loadDraft();
    const text = $("text");
    let title = "";
    if (draft) {
      text.value = draft.text;
      title = typeof draft.title === "string" ? draft.title : "";
      if (title) $("source-label").textContent = `מתכון: ${title}`;
      if (BACK_LINKS.has(draft.back)) $("back").href = draft.back;
    }
    $("form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!text.value.trim()) {
        $("status").textContent = "כתבו לפחות מצרך אחד";
        $("status").className = "status error";
        text.focus();
        return;
      }
      compare(text.value, $("pantry").checked, title);
    });
    if (draft && draft.text.trim()) compare(draft.text, false, title);
  }

  const pages = { thermomix: initThermomix, sharon: initSharon, groceries: initGroceries };
  pages[document.body.dataset.page]?.();
})();
