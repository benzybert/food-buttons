// "Add to the shared cart" on the groceries page. Signs in with the key and name
// the cart page saved on this device. Server data is only inserted with textContent.
(() => {
  const SOURCE_BY_PAGE = { "/sharon/": "sharon", "/thermomix/": "thermomix" };
  const $ = (id) => document.getElementById(id);

  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  function draft() {
    try {
      return JSON.parse(sessionStorage.getItem("groceryDraft") || "null") || {};
    } catch {
      return {};
    }
  }

  function say(message, kind, linkText, href) {
    const status = $("status");
    status.textContent = message;
    status.className = kind ? `status ${kind}` : "status";
    if (linkText) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = linkText;
      status.append(" ", link);
    }
  }

  const button = document.createElement("button");
  button.type = "button";
  button.id = "to-cart";
  button.className = "shop secondary";
  button.textContent = "הוסף לעגלה המשותפת";
  $("go").after(button);

  button.addEventListener("click", async () => {
    const text = $("text").value.trim();
    if (!text) {
      say("כתבו לפחות מצרך אחד", "error");
      $("text").focus();
      return;
    }
    const key = read("fb.key");
    const actor = read("fb.actor");
    if (!key || !actor) {
      say("כדי להוסיף לעגלה צריך להיכנס אליה פעם אחת.", "error", "כניסה לעגלה", "/cart.html");
      return;
    }

    const saved = draft();
    button.disabled = true;
    try {
      const res = await fetch("/api/cart/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Actor": encodeURIComponent(actor) },
        body: JSON.stringify({
          recipe: typeof saved.title === "string" ? saved.title : "",
          lines: text,
          source: SOURCE_BY_PAGE[saved.back] || "manual",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        say("הקוד השמור לא תקין.", "error", "כניסה מחדש", "/cart.html");
      } else if (!res.ok) {
        say(data.error || "משהו השתבש, נסו שוב", "error");
      } else {
        say(`נוספו ${data.length} מצרכים לעגלה המשותפת.`, "", "לעגלה", "/cart.html");
      }
    } catch {
      say("אין חיבור לשרת, נסו שוב", "error");
    } finally {
      button.disabled = false;
    }
  });
})();
