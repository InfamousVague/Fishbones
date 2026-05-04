/// Auto-split from the original `src/runtimes/playgroundTemplates.ts`
/// monolith. See `scripts/split-playground-templates.mjs` for the
/// splitter. Each multi-file template gets its own file; single-file
/// templates live together in `../single-file.ts`.

import type { WorkbenchFile } from "../../../data/types";

/// React (web) starter — a counter component that exercises hooks and
/// CSS so the learner sees the "JSX + state + styles" loop wired up
/// from the first Run. The runtime (`runReact`) imports React + ReactDOM
/// from esm.sh and bundles the App component into the iframe; the user
/// just declares `function App()` (or `export default function …`).
export const REACT_TEMPLATE_FILES: WorkbenchFile[] = [
  {
    name: "App.jsx",
    language: "javascript",
    content: `function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <h1>Hello, React</h1>
      <p>You clicked {count} time{count === 1 ? '' : 's'}.</p>
      <button onClick={() => setCount(count + 1)}>Click me</button>
    </main>
  );
}
`,
  },
  {
    name: "style.css",
    language: "css",
    content: `:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
.app {
  font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  text-align: center;
  padding: 32px;
}
.app h1 { margin: 0 0 12px; font-weight: 700; letter-spacing: -0.01em; }
.app p { color: #aaa; margin-bottom: 16px; }
.app button {
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: #000;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.app button:hover { opacity: 0.9; }
`,
  },
];
