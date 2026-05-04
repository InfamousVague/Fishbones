/// Auto-split from the original `src/runtimes/playgroundTemplates.ts`
/// monolith. See `scripts/split-playground-templates.mjs` for the
/// splitter. Each multi-file template gets its own file; single-file
/// templates live together in `../single-file.ts`.

import type { WorkbenchFile } from "../../../data/types";

/// The playground's "Hello, world!" shim for a three-file web project.
/// Buttons click, logs appear — nothing clever, enough to show the
/// learner that Run → DOM + console wiring is live.
export const WEB_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "index.html",
    language: "html",
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fishbones Playground</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello, world!</h1>
    <button id="greet">Click me</button>
    <p id="out"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  },
  {
    name: "style.css",
    language: "css",
    content: `:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #0b0b10;
  color: #e6e6ea;
}
main { text-align: center; }
button {
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid #2a2a33;
  border-radius: 8px;
  background: #16161d;
  color: inherit;
  cursor: pointer;
}
button:hover { background: #1d1d27; }
`,
  },
  {
    name: "script.js",
    language: "javascript",
    content: `const btn = document.getElementById('greet');
const out = document.getElementById('out');
let count = 0;

btn.addEventListener('click', () => {
  count++;
  out.textContent = \`Clicked \${count} time\${count === 1 ? '' : 's'}\`;
  console.log('click', count);
});
`,
  },
];
