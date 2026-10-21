// Optional: `npx eslint .` (eslint is not a dependency of the app; install it globally or with npx).
const g = (names) => Object.fromEntries(names.split(" ").map((k) => [k, "readonly"]));
const browser = g("document window location history navigator localStorage fetch URL URLSearchParams Blob CSS HashChangeEvent setTimeout clearTimeout setInterval clearInterval queueMicrotask console confirm alert Node AudioContext webkitAudioContext requestAnimationFrame performance Intl Promise TextEncoder TextDecoder speechSynthesis SpeechSynthesisUtterance Event KeyboardEvent File caches axe");
const node = g("process console Buffer URL URLSearchParams TextDecoder TextEncoder setTimeout clearTimeout setInterval clearInterval queueMicrotask fetch");
const rules = { "no-undef": "error", "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }], "no-dupe-keys": "error", "no-unreachable": "warn" };

export default [
  { files: ["public/**/*.js"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: browser }, rules },
  { files: ["server.js", "tools/**/*.js", "test/**/*.js", "test/**/*.mjs", "eslint.config.js"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...node, ...browser } }, rules },
  { files: ["tools/sw.template.js"], languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...g("self caches fetch URL Response console"), __VERSION__: "readonly", __FILES__: "readonly" } }, rules },
  { ignores: ["public/sw.js"] },
];
