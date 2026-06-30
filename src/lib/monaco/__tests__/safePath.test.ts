/// The editor must never crash on an AI-written filename. `Uri.parse`
/// throws on a scheme with illegal chars; `safeMonacoPath` guarantees
/// the result has no colon (so no scheme) and only Uri-safe chars.

import { describe, expect, it } from "vitest";
import { safeMonacoPath } from "@/lib/monaco/safePath";

// A faithful stand-in for Monaco's scheme rule: the part before the
// first ":" must be a valid scheme (letter, then [A-Za-z0-9+.-]).
function parsesAsUri(path: string): boolean {
  const m = /^([^:/?#]+):/.exec(path);
  if (!m) return true; // no scheme → always fine
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(m[1]);
}

describe("safeMonacoPath", () => {
  it("leaves a normal relative path untouched", () => {
    expect(safeMonacoPath("src/App.jsx")).toBe("src/App.jsx");
    expect(safeMonacoPath("main.py")).toBe("main.py");
    expect(safeMonacoPath("a/b/c-d_e.test.ts")).toBe("a/b/c-d_e.test.ts");
  });

  it("never produces a string Monaco would reject", () => {
    const nasty = [
      "weird name:v2.js", // space in scheme
      "café:x.rs", // unicode scheme
      "jsx:src/App.jsx", // lang-prefixed path
      "https://evil.com/x", // a URL as a filename
      "C:\\Users\\me\\f.js", // windows path
      "▟ writing.js", // a stray marker char
      "1abc:start.js", // scheme starting with a digit
      "a b c.js",
      ":leading-colon.js",
      "emoji😀.js",
    ];
    for (const n of nasty) {
      const safe = safeMonacoPath(n);
      expect(safe.includes(":"), `no colon in: ${safe}`).toBe(false);
      expect(parsesAsUri(safe), `parses: ${safe}`).toBe(true);
    }
  });

  it("is deterministic and collision-free for distinct names", () => {
    expect(safeMonacoPath("a:b")).toBe(safeMonacoPath("a:b"));
    // The literal tilde is itself escaped, so a name can't collide
    // with another name's escape sequence.
    expect(safeMonacoPath("a:b")).not.toBe(safeMonacoPath("a~3ab"));
  });

  it("handles empty / falsy names", () => {
    expect(safeMonacoPath("")).toBe("untitled");
  });
});
