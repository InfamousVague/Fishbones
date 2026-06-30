import { describe, it, expect } from "vitest";
import { assembleRunnable } from "@/lib/workbenchFiles";
import type { WorkbenchFile } from "@/data/types";

const rs = (name: string, content: string): WorkbenchFile => ({
  name,
  language: "rust",
  content,
});

describe("assembleRunnable — Rust sibling-file module resolution", () => {
  it("inlines `mod foo;` from a sibling foo.rs as `mod foo { ... }`", () => {
    const out = assembleRunnable(
      [
        rs("src/lib.rs", "mod foo;\n\nuse foo::Bar;\n\npub fn go() -> Bar { Bar }"),
        rs("src/foo.rs", "pub struct Bar;"),
      ],
      "rust",
    );
    expect(out).toContain("mod foo {\npub struct Bar;\n}");
    expect(out).toContain("use foo::Bar;");
    // The module body lands INSIDE `mod foo`, before the `use`, not appended
    // at top level with a filename marker.
    expect(out).not.toMatch(/----\s*src\/foo\.rs/);
    expect(out.indexOf("pub struct Bar;")).toBeLessThan(out.indexOf("use foo::Bar;"));
  });

  it("preserves `pub` visibility on the inlined module declaration", () => {
    const out = assembleRunnable(
      [rs("lib.rs", "pub mod foo;"), rs("foo.rs", "pub fn x() {}")],
      "rust",
    );
    expect(out).toContain("pub mod foo {\npub fn x() {}\n}");
  });

  it("leaves `mod foo;` untouched when no sibling file matches (honest error)", () => {
    const out = assembleRunnable([rs("lib.rs", "mod ghost;\nfn main() {}")], "rust");
    expect(out).toBe("mod ghost;\nfn main() {}");
  });

  it("does not match inline `mod foo { ... }` declarations", () => {
    const src = "mod foo { pub fn x() {} }\nfn main() {}";
    const out = assembleRunnable([rs("lib.rs", src)], "rust");
    expect(out).toBe(src);
  });

  it("still concatenates inline-module multi-file lessons with filename markers", () => {
    // The create-package shape: lib.rs uses `pub mod greeter { ... }` inline
    // (no `mod X;`), paired with a main.rs — must behave exactly as before.
    const out = assembleRunnable(
      [
        rs("src/lib.rs", "pub mod greeter { pub fn hi() -> &'static str { \"hi\" } }"),
        rs("src/main.rs", "fn main() { println!(\"{}\", greeter::hi()); }"),
      ],
      "rust",
    );
    expect(out).toContain("// ---- src/lib.rs ----");
    expect(out).toContain("// ---- src/main.rs ----");
  });

  it("does not apply Rust module resolution to other languages", () => {
    const out = assembleRunnable(
      [
        { name: "a.py", language: "python", content: "mod foo;" },
        { name: "b.py", language: "python", content: "x = 1" },
      ],
      "python",
    );
    // Plain concatenation path: both files present verbatim, no `mod foo { }`.
    expect(out).toContain("mod foo;");
    expect(out).toContain("x = 1");
    expect(out).not.toContain("mod foo {");
  });
});
