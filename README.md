# food-buttons

Two giant food-order buttons (Sharon, Thermomix), Alef font, Hebrew RTL. Static files in `public/`, served by `server.js` (no dependencies, reads `PORT`).

- Run: `npm start`
- Labels and link targets: `public/index.html` (each button is an `<a>`; `href="#"` is a placeholder)
- Fonts: Alef (SIL OFL), subset to Hebrew letters and ASCII in `public/fonts/`
- Deploy: Railway, Vercel or Netlify (static, output directory `public`)
