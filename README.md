# food-buttons

Two giant food-order buttons (Sharon, Thermomix), Alef font, Hebrew RTL. Static files in `public/`, served by `server.js` (no dependencies, reads `PORT`).

- Run: `npm start`
- Home: `public/index.html`, each button is an `<a>` to its workflow page
- Sharon (`public/sharon/`): choose dishes from her menu, or paste a recipe
- Thermomix (`public/thermomix/`): paste a recipe's ingredients
- Both end in **🛒 קנה מצרכים** → `public/groceries/`, which compares prices at Shufersal and Tiv Taam
- Sharon's menu: `public/menu.json`, `{"dishes": [{"name": "...", "ingredients": ["2 כוסות קמח", "..."]}]}` (a dish without `ingredients` is listed but can't be priced)
- Price comparison runs in `grocery-api/` (Python, separate service). `server.js` proxies `/api/*` to `GROCERY_API_URL`; see `grocery-api/README.md`
- Fonts: Alef (SIL OFL), subset to Hebrew letters and ASCII in `public/fonts/`
- Deploy: Railway (site service from the repo root, grocery API service from `grocery-api/`)
