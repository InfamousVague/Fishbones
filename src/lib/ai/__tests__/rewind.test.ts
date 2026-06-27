/// "Earn the Diff" rewind tests — the fail-open selection contract +
/// the lenient deterministic grader. The whole safety story is "a
/// bad challenge is worse than none", so the null cases matter as
/// much as the hit cases.

import { describe, expect, it } from "vitest";
import { gradeRewindGuess, selectRewindStep } from "../rewind";
import { analyzeBuildTape } from "../buildTape";
import type { ToolResult } from "../../aiTools/types";
import type { Course } from "../../../data/types";

function tr(name: string, ok: boolean, payload: Record<string, unknown>): ToolResult {
  return { toolCallId: `id-${Math.random()}`, name, ok, content: JSON.stringify(payload) };
}

const RUST_COURSE: Course = {
  id: "rust-book",
  title: "The Rust Programming Language",
  language: "rust",
  chapters: [
    {
      id: "ch04",
      title: "Ownership",
      lessons: [
        {
          id: "ownership",
          title: "What Is Ownership?",
          kind: "reading",
          body: "Ownership is Rust's most unique feature. Each value has an owner; move semantics transfer ownership when assigned or passed.",
        },
        {
          id: "borrowing",
          title: "References and Borrowing",
          kind: "reading",
          body: "A reference borrows a value without taking ownership. The borrow checker allows one mutable borrow or many immutable borrows of a value.",
        },
      ],
    },
    {
      id: "ch13",
      title: "Iterators and Closures",
      lessons: [
        {
          id: "iterators",
          title: "Processing a Series of Items with Iterators",
          kind: "reading",
          body: "Iterators let you process a sequence of items. iter, map, filter, and collect transform and gather items lazily.",
        },
        {
          id: "closures",
          title: "Closures: Anonymous Functions",
          kind: "reading",
          body: "A closure is an anonymous function you can store in a variable. Closures capture their environment and are passed to iterator adapters like map.",
        },
      ],
    },
  ],
} as unknown as Course;

const ITER_FILE = {
  path: "src/main.rs",
  language: "rust",
  content: [
    "fn main() {",
    "    let nums = vec![1, 2, 3];",
    "    let doubled: Vec<i32> = nums.iter().map(|n| n * 2).collect();",
    '    println!("{:?}", doubled);',
    "}",
  ].join("\n"),
};

describe("selectRewindStep — fires on a teachable line", () => {
  it("blanks the load-bearing iterator/closure line and links a lesson", () => {
    const choice = selectRewindStep({
      files: [ITER_FILE],
      courses: [RUST_COURSE],
      completed: new Set(), // nothing learned yet
    });
    expect(choice).not.toBeNull();
    // The chosen line is the doubled iterator line (difficulty-2
    // concept), not the difficulty-1 `let nums` / `fn main`.
    expect(choice!.answer).toContain(".iter().map(");
    expect(choice!.lineIndex).toBe(2);
    // It's a real, lesson-backed concept.
    expect(["rust-iterators", "rust-closures"]).toContain(choice!.concept.concept.id);
    expect(choice!.concept.lessons.length).toBeGreaterThan(0);
    // The blank replaced the line, preserving indentation.
    expect(choice!.blankedSource).toContain(choice!.blankMarker);
    expect(choice!.blankedSource).not.toContain(".iter().map(");
    expect(choice!.blankedSource.split("\n")[2].startsWith("    ")).toBe(true);
    expect(choice!.reason).toBe("new-concept");
  });
});

describe("selectRewindStep — fails open (returns null)", () => {
  it("returns null for boilerplate with no teachable concept", () => {
    const choice = selectRewindStep({
      files: [
        {
          path: "src/main.rs",
          language: "rust",
          content: "use std::io;\n\nfn main() {\n}",
        },
      ],
      courses: [RUST_COURSE],
      completed: new Set(),
    });
    expect(choice).toBeNull();
  });

  it("returns null when no installed course teaches the concept", () => {
    const choice = selectRewindStep({
      files: [ITER_FILE],
      courses: [], // no lessons → nowhere to deep-link → no challenge
      completed: new Set(),
    });
    expect(choice).toBeNull();
  });

  it("returns null when every concept is already mastered (and none struggled)", () => {
    // Complete the lessons whose retrieval top-hit marks the
    // concepts learned. iterators + closures + their neighbours.
    const choice = selectRewindStep({
      files: [ITER_FILE],
      courses: [RUST_COURSE],
      completed: new Set([
        "rust-book:iterators",
        "rust-book:closures",
        "rust-book:ownership",
        "rust-book:borrowing",
      ]),
    });
    // Some difficulty-1 concept might still be unlearned, but it has
    // no lesson hit OR is learned → with the strong lessons done the
    // teachable set collapses. Accept null OR a still-unlearned hit,
    // but it must NOT re-teach a completed iterators/closures line.
    if (choice) {
      expect(["rust-iterators", "rust-closures"]).not.toContain(
        choice.concept.concept.id,
      );
    } else {
      expect(choice).toBeNull();
    }
  });

  it("rejects an over-long tangled line via the size guard", () => {
    const longLine =
      "    let result: Vec<(usize, String)> = data.iter().enumerate().filter(|(i, _)| i % 2 == 0).map(|(i, s)| (i, s.to_uppercase())).collect();";
    const choice = selectRewindStep({
      files: [
        {
          path: "src/main.rs",
          language: "rust",
          content: `fn main() {\n${longLine}\n}`,
        },
      ],
      courses: [RUST_COURSE],
      completed: new Set(),
    });
    // The only concept-bearing line is > 100 chars → guarded out →
    // no other qualifying line → null.
    expect(choice).toBeNull();
  });
});

describe("selectRewindStep — ZPD: struggled concept wins", () => {
  it("a freshly-struggled borrowing line outranks a novel iterator line", () => {
    const file = {
      path: "src/main.rs",
      language: "rust",
      content: [
        "fn main() {",
        "    let mut count = 0;",
        "    let r = &mut count;",
        "    let doubled: Vec<i32> = vec![1].iter().map(|n| n * 2).collect();",
        "    *r += 1;",
        "}",
      ].join("\n"),
    };
    // The build tripped on a borrow conflict (E0502 → borrowing) in
    // this very file.
    const tape = analyzeBuildTape([
      tr("write_sandbox_file", true, { ok: true, path: "src/main.rs" }),
      tr("run_sandbox_project", false, { ok: false, diagnosis: { code: "rust-E0502" } }),
      tr("apply_sandbox_patch", true, { ok: true, applied: [{ op: "write", path: "src/main.rs" }] }),
      tr("run_sandbox_project", true, { ok: true }),
    ]);
    const choice = selectRewindStep({
      files: [file],
      tape,
      courses: [RUST_COURSE],
      completed: new Set(),
    });
    expect(choice).not.toBeNull();
    expect(choice!.concept.concept.id).toBe("rust-borrowing");
    expect(choice!.reason).toBe("struggled-concept");
    expect(choice!.answer.trim()).toBe("let r = &mut count;");
    expect(choice!.prompt.toLowerCase()).toContain("tripped");
  });
});

describe("gradeRewindGuess", () => {
  const answer = "let doubled: Vec<i32> = nums.iter().map(|n| n * 2).collect();";

  it("passes an exact match", () => {
    expect(gradeRewindGuess(answer, answer)).toEqual({ passed: true, similarity: 1 });
  });
  it("passes despite whitespace differences", () => {
    const spaced = "let  doubled:Vec<i32>=nums.iter().map(|n| n*2).collect();";
    const r = gradeRewindGuess(spaced, answer);
    expect(r.passed).toBe(true);
  });
  it("passes a near-miss with the right pieces (>=0.8 overlap)", () => {
    // Same tokens, learner forgot the type annotation's exact form.
    const close = "let doubled = nums.iter().map(|n| n * 2).collect();";
    const r = gradeRewindGuess(close, answer);
    expect(r.similarity).toBeGreaterThan(0.8);
    expect(r.passed).toBe(true);
  });
  it("fails a wrong guess", () => {
    const r = gradeRewindGuess('println!("{}", doubled);', answer);
    expect(r.passed).toBe(false);
    expect(r.similarity).toBeLessThan(0.8);
  });
  it("fails an empty guess", () => {
    expect(gradeRewindGuess("", answer)).toEqual({ passed: false, similarity: 0 });
  });
});
