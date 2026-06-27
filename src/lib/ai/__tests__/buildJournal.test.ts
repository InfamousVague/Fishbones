/// Build Journal tests — the deterministic worked-example spine.

import { describe, expect, it } from "vitest";
import { buildBuildJournal } from "../buildJournal";
import type { ToolResult } from "../../aiTools/types";
import type { Course } from "../../../data/types";

function tr(name: string, ok: boolean, payload: Record<string, unknown>): ToolResult {
  return {
    toolCallId: `id-${Math.random().toString(36).slice(2, 8)}`,
    name,
    ok,
    content: JSON.stringify(payload),
  };
}

const RUST_COURSE: Course = {
  id: "rust-book",
  title: "The Rust Programming Language",
  language: "rust",
  chapters: [
    {
      id: "ch13",
      title: "Functional Features",
      lessons: [
        {
          id: "closures",
          title: "Closures",
          kind: "reading",
          body: "A closure is an anonymous function that can capture variables from its environment. Closures are passed to iterator adapters like map.",
        },
        {
          id: "iterators",
          title: "Processing a Series of Items with Iterators",
          kind: "reading",
          body: "Iterators let you process sequences. iter, map, filter, collect transform items lazily.",
        },
      ],
    },
  ],
} as unknown as Course;

const TIMELINE = [
  tr("create_sandbox_project", true, { ok: true, projectId: "wc-1" }),
  tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
  tr("write_sandbox_file", true, { ok: true, path: "src/counter.rs" }),
  tr("run_sandbox_project", true, { ok: true, logs: [] }),
];

describe("buildBuildJournal", () => {
  it("detects concepts across files + links lessons + flags new-to-you", () => {
    const journal = buildBuildJournal({
      timeline: TIMELINE,
      files: [
        {
          path: "src/main.rs",
          language: "rust",
          content:
            'fn main() {\n  let words = vec!["a","b"];\n  let upper: Vec<String> = words.iter().map(|w| w.to_uppercase()).collect();\n  println!("{:?}", upper);\n}',
        },
        {
          path: "src/counter.rs",
          language: "rust",
          content:
            "pub fn count(items: &[i32]) -> usize { items.iter().filter(|n| **n > 0).count() }",
        },
      ],
      courses: [RUST_COURSE],
      completed: new Set(["rust-book:closures"]), // learned closures, not iterators
    });

    expect(journal.stage).toBe("complete");
    expect(journal.projectId).toBe("wc-1");
    expect(journal.hasContent).toBe(true);

    // Files ordered entry-point first.
    expect(journal.files[0].path).toBe("src/main.rs");
    expect(journal.files[0].purpose).toBe("Entry point");
    expect(journal.files[1].purpose).toBe("Logic module");

    // Concept union includes closures + iterators.
    const ids = journal.concepts.map((c) => c.concept.id);
    expect(ids).toContain("rust-closures");
    expect(ids).toContain("rust-iterators");

    // Closures learned, iterators not → iterators in newToYou, not closures.
    const newIds = journal.newToYou.map((c) => c.concept.id);
    expect(newIds).toContain("rust-iterators");
    expect(newIds).not.toContain("rust-closures");

    // Each new concept carries teaching lessons with libre:// links.
    const iter = journal.newToYou.find((c) => c.concept.id === "rust-iterators")!;
    expect(iter.lessons.length).toBeGreaterThan(0);
    expect(iter.lessons[0].link).toContain("libre://lesson/rust-book/");
  });

  it("infers per-file purposes from conventions", () => {
    const journal = buildBuildJournal({
      timeline: [tr("create_sandbox_project", true, { ok: true, projectId: "p" })],
      files: [
        { path: "index.html", language: "web", content: "<html></html>" },
        { path: "main.js", language: "javascript", content: "const x = useState ? 1 : 2;" },
        { path: "style.css", language: "css", content: "body { color: red; }" },
        { path: "src/components/Card.jsx", language: "javascript", content: "export function Card(){ return <div/>; }" },
      ],
      courses: [],
      completed: new Set(),
    });
    const byPath = Object.fromEntries(journal.files.map((f) => [f.path, f.purpose]));
    expect(byPath["index.html"]).toBe("Page shell");
    expect(byPath["main.js"]).toBe("Entry point");
    expect(byPath["style.css"]).toBe("Styles");
    expect(byPath["src/components/Card.jsx"]).toBe("Component");
  });

  it("hasContent is false when no concepts are detectable", () => {
    const journal = buildBuildJournal({
      timeline: [tr("create_sandbox_project", true, { ok: true, projectId: "p" })],
      files: [{ path: "notes.txt", language: "plain", content: "just some prose, no code" }],
      courses: [],
      completed: new Set(),
    });
    expect(journal.hasContent).toBe(false);
    expect(journal.concepts).toEqual([]);
  });

  it("falls back to file extension when language is missing", () => {
    const journal = buildBuildJournal({
      timeline: [tr("create_sandbox_project", true, { ok: true, projectId: "p" })],
      files: [
        { path: "lib.rs", language: "", content: "fn add(a: i32, b: i32) -> i32 { a + b }" },
      ],
      courses: [],
      completed: new Set(),
    });
    expect(journal.files[0].language).toBe("rust");
    expect(journal.files[0].concepts.some((c) => c.id === "rust-functions")).toBe(true);
  });
});
