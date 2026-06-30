/// Concept engine tests — the keystone of teach-while-building.
/// Fixtures use real Rust / JS / Python shapes so detection,
/// prereq chains, the diagnosis bridge, and coverage analysis are
/// pinned to behaviour a learner would actually hit.

import { describe, expect, it } from "vitest";
import {
  analyzeConceptCoverage,
  conceptById,
  conceptForDiagnosis,
  conceptLangFor,
  conceptsForLanguage,
  CONCEPTS,
  detectConceptMentions,
  detectConceptsInCode,
  lessonsForConcept,
  prerequisiteChain,
} from "@/lib/ai/concepts";
import type { Course } from "@/data/types";

// ── Taxonomy integrity ──────────────────────────────────────

describe("taxonomy integrity", () => {
  it("has unique ids", () => {
    const ids = CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every prereq id resolves to a real concept", () => {
    for (const c of CONCEPTS) {
      for (const p of c.prereqs) {
        expect(conceptById(p), `${c.id} → ${p}`).toBeDefined();
      }
    }
  });
  it("has no prereq cycles (chain terminates)", () => {
    for (const c of CONCEPTS) {
      const chain = prerequisiteChain(c.id);
      // The concept itself must be last and appear exactly once.
      expect(chain[chain.length - 1].id).toBe(c.id);
      expect(chain.filter((x) => x.id === c.id)).toHaveLength(1);
    }
  });
});

describe("conceptLangFor", () => {
  it("maps the taught trio", () => {
    expect(conceptLangFor("rust")).toBe("rust");
    expect(conceptLangFor("python")).toBe("python");
    expect(conceptLangFor("typescript")).toBe("typescript");
  });
  it("maps web frameworks to javascript", () => {
    expect(conceptLangFor("react")).toBe("javascript");
    expect(conceptLangFor("svelte")).toBe("javascript");
    expect(conceptLangFor("web")).toBe("javascript");
  });
  it("returns null for untaught languages", () => {
    expect(conceptLangFor("go")).toBeNull();
    expect(conceptLangFor("haskell")).toBeNull();
  });
});

describe("conceptsForLanguage", () => {
  it("typescript includes javascript concepts", () => {
    const ts = conceptsForLanguage("typescript");
    expect(ts.some((c) => c.id === "js-closures")).toBe(true);
    expect(ts.some((c) => c.id === "ts-types")).toBe(true);
  });
  it("javascript excludes typescript-only concepts", () => {
    const js = conceptsForLanguage("javascript");
    expect(js.some((c) => c.id === "ts-types")).toBe(false);
  });
});

// ── Code detection ──────────────────────────────────────────

describe("detectConceptsInCode — Rust", () => {
  it("detects borrowing, pattern matching, and Result in idiomatic Rust", () => {
    const code = `
fn parse(input: &str) -> Result<i32, String> {
    match input.trim().parse::<i32>() {
        Ok(n) => Ok(n),
        Err(_) => Err(String::from("not a number")),
    }
}`;
    const ids = detectConceptsInCode(code, "rust").map((h) => h.concept.id);
    expect(ids).toContain("rust-borrowing");
    expect(ids).toContain("rust-pattern-matching");
    expect(ids).toContain("rust-result");
    expect(ids).toContain("rust-strings");
  });

  it("detects closures + iterators in a chain", () => {
    const code = `let total: i32 = nums.iter().map(|x| x * 2).filter(|x| x > &4).sum();`;
    const ids = detectConceptsInCode(code, "rust").map((h) => h.concept.id);
    expect(ids).toContain("rust-closures");
    expect(ids).toContain("rust-iterators");
  });

  it("detects traits + generics", () => {
    const code = `
trait Shape { fn area(&self) -> f64; }
fn describe<T: Shape>(s: &T) -> f64 { s.area() }`;
    const ids = detectConceptsInCode(code, "rust").map((h) => h.concept.id);
    expect(ids).toContain("rust-traits");
    expect(ids).toContain("rust-generics");
  });

  it("detects smart pointers", () => {
    const code = `let shared = Rc::new(RefCell::new(vec![1, 2, 3]));`;
    const ids = detectConceptsInCode(code, "rust").map((h) => h.concept.id);
    expect(ids).toContain("rust-smart-pointers");
    expect(ids).toContain("rust-collections");
  });

  it("sorts harder concepts first + carries evidence", () => {
    const code = `
struct Point { x: i32 }
impl Clone for Point { fn clone(&self) -> Point { Point { x: self.x } } }`;
    const hits = detectConceptsInCode(code, "rust");
    expect(hits.length).toBeGreaterThan(0);
    // traits (d3) should outrank structs (d2).
    const traitIdx = hits.findIndex((h) => h.concept.id === "rust-traits");
    const structIdx = hits.findIndex((h) => h.concept.id === "rust-structs");
    expect(traitIdx).toBeGreaterThanOrEqual(0);
    expect(traitIdx).toBeLessThan(structIdx);
    expect(hits[0].evidence.length).toBeGreaterThan(0);
  });
});

describe("detectConceptsInCode — JS/React + Python", () => {
  it("detects React hooks + jsx", () => {
    const code = `
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => { document.title = count; }, [count]);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`;
    const ids = detectConceptsInCode(code, "react").map((h) => h.concept.id);
    expect(ids).toContain("react-hooks");
    expect(ids).toContain("react-jsx");
    expect(ids).toContain("js-functions");
  });

  it("detects async/await", () => {
    const code = `async function load() { const r = await fetch(url); return r.json(); }`;
    const ids = detectConceptsInCode(code, "javascript").map((h) => h.concept.id);
    expect(ids).toContain("js-async");
  });

  it("detects Python comprehensions + classes", () => {
    const code = `
class Bag:
    def __init__(self):
        self.items = [x * 2 for x in range(10)]`;
    const ids = detectConceptsInCode(code, "python").map((h) => h.concept.id);
    expect(ids).toContain("py-classes");
    expect(ids).toContain("py-comprehensions");
  });

  it("returns [] for untaught languages + empty code", () => {
    expect(detectConceptsInCode("package main", "go")).toEqual([]);
    expect(detectConceptsInCode("", "rust")).toEqual([]);
  });
});

// ── Prose mention detection ─────────────────────────────────

describe("detectConceptMentions", () => {
  it("finds concepts named in an explanation", () => {
    const prose =
      "Here the borrow checker rejects the second mutable reference because borrowing rules forbid it.";
    const ids = detectConceptMentions(prose, "rust").map((c) => c.id);
    expect(ids).toContain("rust-borrowing");
  });
  it("does not match a word embedded in a longer word", () => {
    // "classification" must NOT trigger the Python "class" concept.
    const ids = detectConceptMentions(
      "a taxonomy of classification systems",
      "python",
    ).map((c) => c.id);
    expect(ids).not.toContain("py-classes");
  });
  it("matches symbol-y aliases like &str", () => {
    const ids = detectConceptMentions(
      "convert the String into an &str slice",
      "rust",
    ).map((c) => c.id);
    expect(ids).toContain("rust-strings");
  });
});

// ── Diagnosis bridge ────────────────────────────────────────

describe("conceptForDiagnosis", () => {
  it("maps a Rust move error to ownership", () => {
    expect(conceptForDiagnosis("rust-E0382")?.id).toBe("rust-ownership");
  });
  it("maps a borrow conflict to borrowing", () => {
    expect(conceptForDiagnosis("rust-E0502")?.id).toBe("rust-borrowing");
  });
  it("maps a JS missing-module to modules", () => {
    expect(conceptForDiagnosis("js-missing-module")?.id).toBe("js-modules");
  });
  it("returns undefined for unknown codes", () => {
    expect(conceptForDiagnosis("nope-9999")).toBeUndefined();
  });
});

// ── Prereq chain ────────────────────────────────────────────

describe("prerequisiteChain", () => {
  it("expands lifetimes → borrowing → ownership → variables, in order", () => {
    const chain = prerequisiteChain("rust-lifetimes").map((c) => c.id);
    expect(chain).toEqual([
      "rust-variables",
      "rust-ownership",
      "rust-borrowing",
      "rust-lifetimes",
    ]);
  });
  it("returns just the concept when it has no prereqs", () => {
    expect(prerequisiteChain("rust-structs").map((c) => c.id)).toEqual([
      "rust-structs",
    ]);
  });
});

// ── Lesson linking + coverage ───────────────────────────────

const RUST_COURSE: Course = {
  id: "rust-book",
  title: "The Rust Programming Language",
  language: "rust",
  chapters: [
    {
      id: "ch04",
      title: "Understanding Ownership",
      lessons: [
        {
          id: "ownership",
          title: "What Is Ownership?",
          kind: "reading",
          body: "Ownership is Rust's most unique feature. Each value has an owner; when the owner goes out of scope the value is dropped. Move semantics transfer ownership.",
        },
        {
          id: "borrowing",
          title: "References and Borrowing",
          kind: "reading",
          body: "A reference borrows a value without taking ownership. The borrow checker enforces one mutable or many immutable borrows.",
        },
      ],
    },
  ],
} as unknown as Course;

describe("lessonsForConcept", () => {
  it("links the ownership concept to the ownership lesson", () => {
    const c = conceptById("rust-ownership")!;
    const hits = lessonsForConcept([RUST_COURSE], c, 2);
    expect(hits[0].lessonId).toBe("ownership");
    expect(hits[0].link).toBe("libre://lesson/rust-book/ownership");
  });
});

describe("analyzeConceptCoverage", () => {
  it("flags learned vs unlearned and sorts unlearned first", () => {
    const concepts = [
      conceptById("rust-ownership")!,
      conceptById("rust-borrowing")!,
    ];
    // Learner finished the ownership lesson but not borrowing.
    const completed = new Set(["rust-book:ownership"]);
    const cov = analyzeConceptCoverage(concepts, [RUST_COURSE], completed);
    const ownership = cov.find((c) => c.concept.id === "rust-ownership")!;
    const borrowing = cov.find((c) => c.concept.id === "rust-borrowing")!;
    expect(ownership.learned).toBe(true);
    expect(borrowing.learned).toBe(false);
    // Unlearned (borrowing) must sort before learned (ownership).
    expect(cov[0].concept.id).toBe("rust-borrowing");
    // Each carries its teaching lessons.
    expect(borrowing.lessons.length).toBeGreaterThan(0);
  });
});
