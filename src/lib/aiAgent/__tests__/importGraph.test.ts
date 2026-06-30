/// Import-graph / orphan detection — the basis for auto-removing
/// "un-needed files". Must UNDER-report (never flag a reachable file)
/// so the loop's auto-prune can't delete a live file.

import { describe, expect, it } from "vitest";
import { detectEntry, findOrphans, reachableFrom } from "@/lib/aiAgent/importGraph";

describe("detectEntry", () => {
  it("prefers index.html, then src/main, then src/App", () => {
    expect(detectEntry({ "index.html": "", "src/App.jsx": "" })).toBe("index.html");
    expect(detectEntry({ "src/main.jsx": "", "src/App.jsx": "" })).toBe("src/main.jsx");
    expect(detectEntry({ "src/App.jsx": "" })).toBe("src/App.jsx");
    expect(detectEntry({ "main.py": "" })).toBe("main.py");
  });
  it("returns null when no known entry exists", () => {
    expect(detectEntry({ "src/lib/util.js": "" })).toBeNull();
  });
});

describe("findOrphans", () => {
  it("flags a React component nothing imports", () => {
    const files = {
      "src/App.jsx": "import './styles.css';\nexport default function App(){return null;}",
      "src/styles.css": "body{}",
      "src/Unused.jsx": "export default function U(){return null;}",
    };
    expect(findOrphans(files)).toEqual(["src/Unused.jsx"]);
  });

  it("does NOT flag files reachable transitively", () => {
    const files = {
      "src/App.jsx": "import { deck } from './lib/deck';\nimport './App.css';",
      "src/lib/deck.js": "import { SUITS } from './constants';\nexport const deck=[];",
      "src/lib/constants.js": "export const SUITS=[];",
      "src/App.css": "body{}",
    };
    expect(findOrphans(files)).toEqual([]);
  });

  it("resolves an extensionless import to its .jsx file", () => {
    const files = {
      "src/index.js": "import App from './App';",
      "src/App.jsx": "export default function App(){return null;}",
    };
    // index.js is the entry; App.jsx is imported as './App' → reachable.
    expect(findOrphans(files)).toEqual([]);
  });

  it("treats an index.html as bootstrapping src/main even if not literally linked", () => {
    const files = {
      "index.html": "<html></html>",
      "src/main.jsx": "import './App';",
      "src/App.jsx": "export default function App(){return null;}",
    };
    expect(findOrphans(files)).toEqual([]);
  });

  it("returns [] (refuses to guess) when there is no detectable entry", () => {
    expect(findOrphans({ "src/a.js": "import './b'", "src/b.js": "" })).toEqual([]);
  });

  it("never flags non-modelled file types (.svelte, .json, assets) as orphans", () => {
    const files = {
      "index.html": "<html></html>",
      "data.json": "{}",
      "logo.svg": "<svg/>",
    };
    expect(findOrphans(files)).toEqual([]);
  });

  it("never prunes test files (intentionally not imported)", () => {
    const files = {
      "src/App.jsx": "import { deck } from './lib/deck';\nexport default function App(){return <div/>;}",
      "src/lib/deck.js": "export const deck=[];",
      "src/lib/deck.test.js": "import { deck } from './deck';\ntest('x',()=>{});", // not imported by app — but a TEST
      "src/lib/score.spec.ts": "test('y',()=>{});",
    };
    expect(findOrphans(files)).toEqual([]);
  });

  it("catches the gemma case: two css files, only one imported", () => {
    const files = {
      "src/App.jsx": "import './styles.css';\nexport default function App(){return <div/>;}",
      "src/styles.css": "body{}",
      "src/App.css": "h1{}", // written but never imported
    };
    expect(findOrphans(files)).toEqual(["src/App.css"]);
    expect(reachableFrom(files).has("src/styles.css")).toBe(true);
    expect(reachableFrom(files).has("src/App.css")).toBe(false);
  });
});
