/// Tests for the rebuilt AI brain: context engine, course
/// retrieval, conversation compaction. Retrieval fixtures are
/// shaped like the two courses the integration targets — The
/// Rust Programming Language (book chapters) and Rustlings
/// (fix-the-broken-code exercises).

import { describe, expect, it } from "vitest";
import {
  buildContextBlock,
  DEFAULT_CONTEXT_BUDGET,
} from "../context";
import {
  formatRetrievalBlock,
  searchCourseContent,
} from "../retrieval";
import {
  compactWireMessages,
  type WireMessage,
} from "../compaction";
import type { Course } from "../../../data/types";

// ── Fixtures ────────────────────────────────────────────────

const RUST_BOOK: Course = {
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
          body:
            "Ownership is Rust's most unique feature. Each value in Rust has an owner. " +
            "When the owner goes out of scope, the value will be dropped. " +
            "Move semantics transfer ownership between variables.",
        },
        {
          id: "borrowing",
          title: "References and Borrowing",
          kind: "reading",
          body:
            "A reference lets you refer to a value without taking ownership of it. " +
            "We call the action of creating a reference borrowing. " +
            "You can have either one mutable reference or any number of immutable references. " +
            "The borrow checker enforces these rules at compile time.",
        },
      ],
    },
    {
      id: "ch15",
      title: "Smart Pointers",
      lessons: [
        {
          id: "rc-refcell",
          title: "Rc<T> and RefCell<T>",
          kind: "reading",
          body:
            "Rc<T> enables multiple ownership through reference counting. " +
            "RefCell<T> gives interior mutability checked at runtime. " +
            "Combining Rc<RefCell<T>> lets multiple owners mutate shared data.",
        },
      ],
    },
  ],
} as unknown as Course;

const RUSTLINGS: Course = {
  id: "rustlings",
  title: "Rustlings",
  language: "rust",
  packType: "lings",
  chapters: [
    {
      id: "move-semantics",
      title: "Move Semantics",
      lessons: [
        {
          id: "move_semantics1",
          title: "move_semantics1",
          kind: "exercise",
          body:
            "Fix the compiler error in this exercise about move semantics. " +
            "```rust\nfn main() { let vec0 = vec![22, 44, 66]; let vec1 = vec0; println!(\"{:?}\", vec0); }\n``` " +
            "The value vec0 was moved into vec1 — borrowing or cloning fixes it.",
        },
      ],
    },
  ],
} as unknown as Course;

const COURSES = [RUST_BOOK, RUSTLINGS];

// ── Retrieval ───────────────────────────────────────────────

describe("searchCourseContent", () => {
  it("finds the borrowing lesson for a borrow-checker question", () => {
    const hits = searchCourseContent(COURSES, "why does the borrow checker reject two mutable references?", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].lessonId).toBe("borrowing");
    expect(hits[0].link).toBe("libre://lesson/rust-book/borrowing");
  });

  it("finds the smart-pointer lesson for Rc<RefCell<T>>", () => {
    const hits = searchCourseContent(COURSES, "how do I share mutable state with Rc<RefCell<T>>?", 3);
    expect(hits[0].lessonId).toBe("rc-refcell");
  });

  it("surfaces the Rustlings exercise for move-semantics questions", () => {
    const hits = searchCourseContent(COURSES, "value moved here vec0 move semantics", 3);
    const ids = hits.map((h) => h.lessonId);
    expect(ids).toContain("move_semantics1");
  });

  it("returns [] for queries with only stopwords", () => {
    expect(searchCourseContent(COURSES, "what is the", 3)).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(searchCourseContent(COURSES, "kubernetes ingress controllers", 3)).toEqual([]);
  });

  it("caps results at k", () => {
    const hits = searchCourseContent(COURSES, "rust ownership reference value", 1);
    expect(hits).toHaveLength(1);
  });

  it("snippets centre on the matched token", () => {
    const hits = searchCourseContent(COURSES, "interior mutability", 1);
    expect(hits[0].snippet.toLowerCase()).toContain("interior mutability");
  });
});

describe("searchCourseContent v2 (chunks, bigrams, affinity)", () => {
  it("bigram phrase beats scattered tokens", () => {
    const scattered: Course = {
      id: "scattered",
      title: "Scattered",
      language: "rust",
      chapters: [
        {
          id: "c",
          title: "Misc",
          lessons: [
            {
              id: "noise",
              title: "Assorted notes",
              kind: "reading",
              body:
                "You can borrow books from a library.\n\n" +
                "A spell checker validates documents thoroughly and carefully today.",
            },
          ],
        },
      ],
    } as unknown as Course;
    const phrase: Course = {
      id: "phrase",
      title: "Phrase",
      language: "rust",
      chapters: [
        {
          id: "c",
          title: "Compiler",
          lessons: [
            {
              id: "bc",
              title: "Compiler internals",
              kind: "reading",
              body:
                "The borrow checker is the compiler pass that validates reference lifetimes and exclusive mutable access.",
            },
          ],
        },
      ],
    } as unknown as Course;
    const hits = searchCourseContent(
      [scattered, phrase],
      "how does the borrow checker work?",
      2,
    );
    expect(hits[0].lessonId).toBe("bc");
  });

  it("snippet comes from the best-matching chunk, not the lesson opening", () => {
    const padded: Course = {
      id: "padded",
      title: "Padded",
      language: "rust",
      chapters: [
        {
          id: "c",
          title: "Ch",
          lessons: [
            {
              id: "deep",
              title: "Long lesson",
              kind: "reading",
              body:
                "This opening paragraph is generic filler about programming in general and contains nothing about the topic of interest at all whatsoever.\n\n" +
                "More filler describing the history of computing and other generalities that pad the lesson body out considerably for testing.\n\n" +
                "Interior mutability lets you mutate data through a shared reference using RefCell, which enforces the borrow rules at runtime instead of compile time.",
            },
          ],
        },
      ],
    } as unknown as Course;
    const hits = searchCourseContent([padded], "interior mutability RefCell", 1);
    expect(hits[0].snippet).toContain("Interior mutability");
    expect(hits[0].snippet).not.toContain("generic filler");
  });

  it("currentCourseId affinity breaks near-ties toward the active course", () => {
    const mk = (id: string): Course =>
      ({
        id,
        title: id,
        language: "rust",
        chapters: [
          {
            id: "c",
            title: "Ownership",
            lessons: [
              {
                id: `${id}-lesson`,
                title: "Move semantics",
                kind: "reading",
                body: "Move semantics transfer ownership between bindings when you assign values.",
              },
            ],
          },
        ],
      }) as unknown as Course;
    const a = mk("course-a");
    const b = mk("course-b");
    const noBoost = searchCourseContent([a, b], "move semantics ownership", 2);
    // Identical content — order is corpus order without affinity.
    expect(noBoost[0].courseId).toBe("course-a");
    const boosted = searchCourseContent(
      [a, b],
      "move semantics ownership",
      2,
      { currentCourseId: "course-b" },
    );
    expect(boosted[0].courseId).toBe("course-b");
  });
});

describe("formatRetrievalBlock", () => {
  it("returns empty for no hits", () => {
    expect(formatRetrievalBlock([])).toBe("");
  });
  it("includes links + snippets for each hit", () => {
    const hits = searchCourseContent(COURSES, "borrowing references", 2);
    const block = formatRetrievalBlock(hits);
    expect(block).toContain("libre://lesson/rust-book/borrowing");
    expect(block).toContain("References and Borrowing");
  });
});

// ── Context engine ──────────────────────────────────────────

describe("buildContextBlock", () => {
  it("returns empty string for empty state", () => {
    expect(buildContextBlock({})).toBe("");
  });

  it("includes selection with attribution first", () => {
    const block = buildContextBlock({
      selection: {
        text: "the borrow checker enforces these rules",
        lessonTitle: "References and Borrowing",
        courseTitle: "The Rust Programming Language",
      },
      lesson: {
        courseId: "rust-book",
        courseTitle: "The Rust Programming Language",
        lessonId: "borrowing",
        title: "References and Borrowing",
        kind: "reading",
        body: "A reference lets you refer to a value...",
      },
    });
    expect(block.startsWith("## Selected text")).toBe(true);
    expect(block).toContain("borrow checker");
    expect(block).toContain("## Active lesson");
    expect(block).toContain("libre://lesson/rust-book/borrowing");
  });

  it("includes console errors and sandbox summary", () => {
    const block = buildContextBlock({
      consoleErrors: ["error[E0382]: borrow of moved value: `vec0`"],
      sandbox: {
        projectId: "p1",
        name: "Move Fix",
        language: "rust",
        files: [{ name: "main.rs", bytes: 120 }],
      },
    });
    expect(block).toContain("E0382");
    expect(block).toContain("main.rs");
    expect(block).toContain("language: rust");
  });

  it("respects the hard budget", () => {
    const huge = "x".repeat(20_000);
    const block = buildContextBlock(
      {
        selection: { text: huge },
        lesson: {
          courseId: "c",
          courseTitle: "C",
          lessonId: "l",
          title: "L",
          body: huge,
        },
        consoleErrors: [huge],
      },
      2_000,
    );
    expect(block.length).toBeLessThanOrEqual(2_100); // small joiner slack
    expect(block).toContain("…[truncated]");
  });

  it("default budget keeps blocks comfortably promptable", () => {
    const block = buildContextBlock({
      lesson: {
        courseId: "rustlings",
        courseTitle: "Rustlings",
        lessonId: "move_semantics1",
        title: "move_semantics1",
        kind: "exercise",
        body: "Fix the compiler error. ".repeat(500),
      },
    });
    expect(block.length).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET);
  });
});

// ── Compaction ──────────────────────────────────────────────

function wire(role: WireMessage["role"], content: string): WireMessage {
  return { role, content };
}

describe("compactWireMessages", () => {
  it("returns input verbatim when small", () => {
    const msgs = [
      wire("system", "sys"),
      wire("user", "hello"),
      wire("assistant", "hi"),
    ];
    expect(compactWireMessages(msgs)).toEqual(msgs);
  });

  it("never touches the system message or the live request", () => {
    const bigTool = "t".repeat(5_000);
    const msgs = [
      wire("system", "SYSTEM PROMPT"),
      wire("user", "build it"),
      { role: "tool" as const, content: bigTool, name: "x", tool_call_id: "1" },
      wire("assistant", "done"),
      wire("user", "now add tests"),
    ];
    const out = compactWireMessages(msgs, { keepRecentRows: 0, maxToolChars: 100 });
    expect(out[0].content).toBe("SYSTEM PROMPT");
    expect(out[out.length - 1].content).toBe("now add tests");
  });

  it("truncates old tool results with an elision marker", () => {
    const bigTool = "f".repeat(3_000);
    const msgs = [
      wire("system", "sys"),
      wire("user", "step 1"),
      { role: "tool" as const, content: bigTool, name: "read_file", tool_call_id: "1" },
      wire("assistant", "ok"),
      wire("user", "step 2"),
      wire("assistant", "working"),
      wire("user", "step 3"),
    ];
    const out = compactWireMessages(msgs, { keepRecentRows: 2, maxToolChars: 200 });
    const tool = out.find((m) => m.role === "tool")!;
    expect(tool.content.length).toBeLessThan(300);
    expect(tool.content).toContain("chars elided");
  });

  it("keeps the recent window verbatim", () => {
    const recent = "r".repeat(2_000);
    const msgs = [
      wire("system", "sys"),
      wire("user", "old"),
      wire("assistant", "a".repeat(2_000)),
      wire("assistant", recent),
      wire("user", "current question"),
    ];
    const out = compactWireMessages(msgs, { keepRecentRows: 1, maxToolChars: 100 });
    // The assistant row immediately before the last user message
    // is inside the keep window → untouched.
    expect(out[3].content).toBe(recent);
    // The older assistant row got truncated.
    expect(out[2].content.length).toBeLessThan(300);
  });

  it("drops oldest rows + tombstones when over budget", () => {
    const msgs: WireMessage[] = [wire("system", "sys")];
    for (let i = 0; i < 30; i++) {
      msgs.push(wire("user", `q${i} ` + "x".repeat(400)));
      msgs.push(wire("assistant", `a${i} ` + "y".repeat(400)));
    }
    msgs.push(wire("user", "FINAL"));
    const out = compactWireMessages(msgs, {
      keepRecentRows: 2,
      maxToolChars: 300,
      budgetChars: 4_000,
    });
    const total = out.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(4_500);
    expect(out.some((m) => m.content.includes("elided to keep this conversation fast"))).toBe(true);
    expect(out[out.length - 1].content).toBe("FINAL");
    expect(out[0].content).toBe("sys");
  });

  it("handles a payload with no user message defensively", () => {
    const msgs = [wire("system", "sys"), wire("assistant", "hi")];
    expect(compactWireMessages(msgs)).toEqual(msgs);
  });

  it("tombstone summarises the dropped goal + tool outcomes", () => {
    const msgs: WireMessage[] = [
      wire("system", "sys"),
      wire("user", "build me a blackjack game in React please"),
      {
        role: "tool",
        name: "create_sandbox_project",
        tool_call_id: "1",
        content: JSON.stringify({ ok: true, projectId: "p1" }) + "x".repeat(900),
      },
      {
        role: "tool",
        name: "run_sandbox_project",
        tool_call_id: "2",
        content:
          JSON.stringify({ ok: false, error: "boom" }) + "y".repeat(900),
      },
    ];
    for (let i = 0; i < 12; i++) {
      msgs.push(wire("assistant", `progress ${i} ` + "z".repeat(400)));
    }
    msgs.push(wire("user", "FINAL"));
    const out = compactWireMessages(msgs, {
      keepRecentRows: 1,
      maxToolChars: 200,
      budgetChars: 1_500,
    });
    const tombstone = out.find((m) =>
      m.content.includes("elided to keep this conversation fast"),
    )!;
    expect(tombstone).toBeDefined();
    expect(tombstone.content).toContain("blackjack");
    expect(tombstone.content).toContain("create_sandbox_project (1 ok)");
    expect(tombstone.content).toContain("run_sandbox_project (1 failed)");
    expect(tombstone.content).toContain("Don't redo completed work");
  });
});
