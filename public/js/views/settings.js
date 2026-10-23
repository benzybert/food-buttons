import { h } from "../dom.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { catalog, settings } from "../app.js";
import { pageHead, stepper, toast } from "../ui.js";
import { ALLERGEN_LABELS, DIET_LABELS, KOSHER_LABELS } from "../lib/derive.js";
import { bridgeConfigured, bridgeMessage, checkBridge, loginBridge, normalizeBridgeUrl } from "../lib/cookidoo.js";

const upd = (fn) => store.update((s) => fn(s.settings));
const toggle = (arr, v, on) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));

export function settingsView() {
  const c = catalog();
  const s = settings();
  const checks = (items, selected, key, labelOf = (x) => x) =>
    h("div.chips", items.map((id) => h("label.chip", { style: { cursor: "pointer", "min-block-size": "2.4rem", padding: "0.1rem 0.8rem" } }, h("input", { type: "checkbox", checked: selected.includes(id), "data-fk": `${key}-${id}`, onchange: (e) => upd((x) => void (x[key] = toggle(x[key], id, e.target.checked))) }), labelOf(id))));
  const radios = (name, options, value, onPick) => h("div.chips", { role: "radiogroup" }, options.map(([v, label]) => h("label.chip", { style: { cursor: "pointer", "min-block-size": "2.4rem", padding: "0.1rem 0.8rem" } }, h("input", { type: "radio", name, value: v, checked: value === v, "data-fk": `${name}-${v}`, onchange: () => onPick(v) }), label)));

  const fileInput = h("input", { type: "file", accept: "application/json,.json", style: { display: "none" }, onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("הייבוא מחליף את כל הנתונים הנוכחיים. להמשיך?")) return;
    const res = store.importJSON(await file.text());
    toast(res.ok ? "הנתונים שוחזרו" : res.error);
  } });

  const el = h(
    "div.page",
    pageHead("הגדרות", "הכול נשמר בדפדפן הזה בלבד"),
    h(
      "div.stack",
      h("section.card.stack", h("h2", "משק הבית"), h("div.row", h("span", "כמה סועדים בדרך כלל?"), stepper({ value: s.household, min: 1, max: 20, label: "סועדים", onChange: (n) => upd((x) => void (x.household = n)) }))),
      h("section.card.stack", h("h2", "חנויות להשוואה"), h("p.small.muted", "בלי בחירה, כל החנויות נכללות."), checks(c.stores.map((x) => x.id), s.stores, "stores", (id) => c.storeById.get(id).name)),
      h(
        "section.card.stack",
        h("h2", "העדפות מתכונים"),
        h("div.filter-group", h("span.label", "כשרות"), radios("kosher", [["all", "הכול"], ...Object.entries(KOSHER_LABELS).filter(([k]) => k !== "mixed")], s.kosher, (v) => upd((x) => void (x.kosher = v)))),
        h("div.filter-group", h("span.label", "תזונה"), checks(Object.keys(DIET_LABELS), s.diet, "diet", (id) => DIET_LABELS[id])),
        h("div.filter-group", h("span.label", "להימנע מ"), checks(Object.keys(ALLERGEN_LABELS), s.avoid, "avoid", (id) => ALLERGEN_LABELS[id])),
        h("p.small.muted", "ההעדפות מסננות את ספר המתכונים והצעות התכנון. תמיד אפשר לשנות בסינון במסך המתכונים."),
      ),
      h(
        "section.card.stack",
        h("h2", "כסף"),
        h("label.check", h("input", { type: "checkbox", checked: s.delivery, onchange: (e) => upd((x) => void (x.delivery = e.target.checked)) }), "לחשב קנייה במשלוח (כולל דמי משלוח)"),
        h("div.field", h("label", { for: "set-hourly" }, "שווי שעת עבודה שלי (₪)"), h("input.input.num-in", { id: "set-hourly", type: "number", min: "0", step: "5", value: String(s.hourly), "data-fk": "set-hourly", onchange: (e) => upd((x) => void (x.hourly = Math.max(0, Number(e.target.value) || 0))) }), h("span.small.muted", "אם תזינו מספר, הוא יתווסף לעלות הבישול בהשוואה מול הזמנה.")),
        h("div.field", h("label", { for: "set-device" }, "כמה עלה המכשיר? (₪)"), h("input.input.num-in", { id: "set-device", type: "number", min: "0", step: "100", value: String(s.deviceCost), "data-fk": "set-device", onchange: (e) => upd((x) => void (x.deviceCost = Math.max(0, Number(e.target.value) || 0))) }), h("span.small.muted", "אופציונלי: נראה כמה מההשקעה כבר חזרה מהחיסכון ביומן הבישולים.")),
        h("div.field", h("label", { for: "set-budget" }, "תקציב מצרכים לשבוע (₪)"), h("input.input.num-in", { id: "set-budget", type: "number", min: "0", step: "50", value: String(s.budget), "data-fk": "set-budget", onchange: (e) => upd((x) => void (x.budget = Math.max(0, Number(e.target.value) || 0))) })),
      ),
      h("section.card.stack", h("h2", "שרון"), h("div.field", h("label", { for: "set-phone" }, "מספר וואטסאפ להזמנות"), h("input.input", { id: "set-phone", type: "tel", dir: "ltr", inputmode: "tel", placeholder: "050-1234567", value: s.sharonPhone, "data-fk": "set-phone", onchange: (e) => upd((x) => void (x.sharonPhone = e.target.value.trim())) }))),
      cookidooCard(s),
      h(
        "section.card.stack",
        h("h2", "תצוגה"),
        h("div.filter-group", h("span.label", "ערכת נושא"), radios("theme", [["auto", "לפי המכשיר"], ["light", "בהיר"], ["dark", "כהה"]], s.theme, (v) => upd((x) => void (x.theme = v)))),
        h("div.filter-group", h("span.label", "גודל טקסט"), radios("textSize", [["100", "רגיל"], ["115", "גדול"], ["130", "גדול מאוד"]], String(s.textSize), (v) => upd((x) => void (x.textSize = Number(v))))),
      ),
      h(
        "section.card.stack",
        h("h2", "הנתונים שלי"),
        h("p.small.muted", store.persistent ? "הסל, המזווה, המחירים והמתכונים שלכם נשמרים בדפדפן. כדאי לגבות מדי פעם." : "הדפדפן חוסם שמירה, ולכן הנתונים יימחקו בסגירת הדף."),
        h("div.row", h("button.btn.btn-ghost", { type: "button", onclick: exportData }, icon("download", { size: 20 }), "גיבוי לקובץ"), h("label.btn.btn-ghost", { style: { cursor: "pointer" } }, icon("upload", { size: 20 }), "שחזור מקובץ", fileInput), h("button.btn.btn-ghost", { type: "button", onclick: () => confirm("למחוק את כל הנתונים באפליקציה (סל, מזווה, מחירים, מתכונים שיובאו)?") && (store.reset(), toast("הכול נמחק")) }, icon("trash", { size: 20 }), "מחיקת הכול")),
      ),
      h("p.small.muted", h("a", { href: "#/about" }, "אודות, מקורות נתונים והצהרת נגישות")),
    ),
  );
  return { el, title: "הגדרות" };
}

function exportData() {
  const blob = new Blob([store.exportJSON()], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `food-buttons-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

/** Optional link to a personal cookidoo-bridge service; see docs/COOKIDOO.md. Nothing here talks to Cookidoo directly. */
function cookidooCard(s) {
  const status = h("p.small", { role: "status", "aria-live": "polite" });
  const say = (text, bad = false) => ((status.textContent = text), status.classList.toggle("bad", bad));

  const test = async () => {
    say("בודק...");
    try {
      const r = await checkBridge(settings());
      if (r.fixedAccount) say("מחובר: השירות עובד עם חשבון קבוע, אין צורך להתחבר");
      else if (r.loggedIn) say(`מחובר לחשבון ${settings().bridgeAccount || "Cookidoo"}`);
      else if (r.canLogin) say("השירות עונה והטוקן תקין. התחברו לחשבון Cookidoo למטה");
      else say("השירות עונה, אבל אין בו חשבון Cookidoo ואי אפשר להתחבר", true);
    } catch (e) {
      say(bridgeMessage(e), true);
    }
  };

  const loginStatus = h("p.small", { role: "status", "aria-live": "polite" });
  const email = h("input.input", { id: "set-ck-email", type: "email", dir: "ltr", autocomplete: "username", inputmode: "email", "data-fk": "ck-email", placeholder: "name@example.com" });
  const password = h("input.input", { id: "set-ck-pass", type: "password", dir: "ltr", autocomplete: "current-password", "data-fk": "ck-pass" });
  const loginBtn = h("button.btn", { type: "submit", "data-fk": "ck-login" }, icon("check", { size: 20 }), "התחברות");
  const login = async (e) => {
    e.preventDefault();
    if (!email.value.trim() || !password.value) return void ((loginStatus.textContent = "הזינו אימייל וסיסמה"), loginStatus.classList.add("bad"));
    loginBtn.disabled = true;
    loginStatus.classList.remove("bad");
    loginStatus.textContent = "מתחבר...";
    try {
      const r = await loginBridge(settings(), email.value, password.value);
      password.value = ""; // the password is not kept anywhere: only the sealed session the bridge returned
      toast("התחברתם ל-Cookidoo");
      upd((x) => void Object.assign(x, { bridgeSession: r.session, bridgeAccount: r.email }));
    } catch (err) {
      loginBtn.disabled = false;
      loginStatus.textContent = bridgeMessage(err);
      loginStatus.classList.add("bad");
    }
  };
  const logout = () => upd((x) => void Object.assign(x, { bridgeSession: "", bridgeAccount: "" }));

  const account = !bridgeConfigured(s)
    ? h("p.small.muted", "אחרי שמזינים כתובת וטוקן אפשר להתחבר לחשבון Cookidoo.")
    : s.bridgeSession
      ? h("div.row", h("span", ["מחובר כ-", h("bdi", { dir: "ltr" }, s.bridgeAccount || "Cookidoo")]), h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: logout, "data-fk": "ck-logout" }, "התנתקות"))
      : h(
          "form.stack",
          { onsubmit: login },
          h("p.small.muted", "אם בשירות מוגדר חשבון קבוע, אין צורך בשלב הזה. אחרת: הסיסמה נשלחת פעם אחת, נבדקת מול Cookidoo, והדפדפן שומר רק אישור כניסה מוצפן שהשירות הנפיק (לא את הסיסמה). הוא תקף כחודש."),
          h("div.field", h("label", { for: "set-ck-email" }, "אימייל ב-Cookidoo"), email),
          h("div.field", h("label", { for: "set-ck-pass" }, "סיסמה"), password),
          h("div.row", loginBtn, loginStatus),
        );

  return h(
    "section.card.stack",
    h("h2", "Cookidoo (אופציונלי)"),
    h("p.small.muted", "חיפוש וייבוא מתכונים מהחשבון שלכם דרך שירות אישי שאתם מריצים (תיקיית bridge בפרויקט). האפליקציה לא שומרת את סיסמת Cookidoo; היא מכירה את כתובת השירות, את הטוקן שלו ואת אישור הכניסה שהוא הנפיק. אלה נשמרים בדפדפן הזה בלבד ולא נכללים בגיבוי."),
    h(
      "div.field",
      h("label", { for: "set-bridge-url" }, "כתובת השירות"),
      h("input.input", {
        id: "set-bridge-url",
        type: "url",
        dir: "ltr",
        inputmode: "url",
        autocomplete: "off",
        placeholder: "https://cookidoo-bridge.example.com",
        value: s.bridgeUrl,
        "data-fk": "set-bridge-url",
        onchange: (e) => {
          const url = normalizeBridgeUrl(e.target.value);
          if (url === null) {
            e.target.value = settings().bridgeUrl;
            return toast("כתובת לא תקינה: https בלבד (או localhost לבדיקה)");
          }
          e.target.value = url;
          // another service means another login
          upd((x) => void (url !== x.bridgeUrl && Object.assign(x, { bridgeUrl: url, bridgeSession: "", bridgeAccount: "" })));
        },
      }),
    ),
    h(
      "div.field",
      h("label", { for: "set-bridge-token" }, "טוקן גישה לשירות"),
      h("input.input", { id: "set-bridge-token", type: "password", dir: "ltr", autocomplete: "off", spellcheck: "false", value: s.bridgeToken, "data-fk": "set-bridge-token", onchange: (e) => upd((x) => void (x.bridgeToken = e.target.value.trim())) }),
    ),
    h("div.row", h("button.btn.btn-ghost", { type: "button", onclick: test, "data-fk": "bridge-test" }, icon("check", { size: 20 }), "בדיקת חיבור"), status),
    account,
  );
}
