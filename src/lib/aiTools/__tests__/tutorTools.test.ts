/// Tutor tools — explain_concept + suggest_lessons. They must be
/// GROUNDED: blurb/prereqs from the concept engine, lesson links
/// from retrieval over the user's installed courses, learned flags
/// from the completion set. No hallucinated URLs.

import { describe, expect, it } from "vitest";
import { buildToolRegistry } from "@/lib/aiTools/tools";
import type { ToolContext } from "@/lib/aiTools/tools";
import type { ToolDef } from "@/lib/aiTools/types";
import { findConceptByName } from "@/lib/ai/concepts";
import type { Course } from "@/data/types";

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
          body: "Ownership is Rust's central feature. Each value has an owner; when the owner goes out of scope the value is dropped. Move semantics transfer ownership.",
        },
        {
          id: "borrowing",
          title: "References and Borrowing",
          kind: "reading",
          body: "A reference borrows a value without taking ownership. The borrow checker permits one mutable or many immutable borrows.",
        },
      ],
    },
  ],
} as unknown as Course;

function makeCtx(completed: string[] = []): ToolContext {
  return {
    courses: [RUST_COURSE],
    completed: new Set(completed),
    history: [],
    openLesson: () => {},
    openCourse: () => {},
    scope: { kind: "open" } as unknown as ToolContext["scope"],
    updateScope: () => {},
  };
}

function tool(name: string): ToolDef {
  const t = buildToolRegistry(makeCtx()).find((d) => d.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

describe("findConceptByName", () => {
  it("resolves by id, exact label, and alias", () => {
    expect(findConceptByName("rust-borrowing")?.id).toBe("rust-borrowing");
    expect(findConceptByName("Borrowing")?.id).toBe("rust-borrowing");
    expect(findConceptByName("ownership", "rust")?.id).toBe("rust-ownership");
  });
  it("returns undefined for nonsense", () => {
    expect(findConceptByName("blockchain sharding")).toBeUndefined();
    expect(findConceptByName("")).toBeUndefined();
  });
});

describe("explain_concept tool", () => {
  it("returns a grounded skeleton with real lesson links + prereqs", async () => {
    const reg = buildToolRegistry(makeCtx(["rust-book:ownership"]));
    const t = reg.find((d) => d.name === "explain_concept")!;
    expect(t.auto).toBe(true);
    const out = (await t.handler({ concept: "borrowing", language: "rust" })) as any;
    expect(out.found).toBe(true);
    expect(out.id).toBe("rust-borrowing");
    expect(out.blurb.length).toBeGreaterThan(0);
    expect(out.difficulty).toBeGreaterThanOrEqual(1);
    // borrowing's prereq chain includes ownership.
    expect(out.prerequisites).toContain("Ownership");
    // Lessons come back with real libre:// links.
    expect(out.lessons.length).toBeGreaterThan(0);
    expect(out.lessons[0].link).toMatch(/^libre:\/\/lesson\/rust-book\//);
    // Completed flag reflects the completion set.
    const ownershipLesson = out.lessons.find((l: any) => l.lessonId === "ownership");
    if (ownershipLesson) expect(ownershipLesson.completed).toBe(true);
  });

  it("returns found:false for an unknown concept", async () => {
    const out = (await tool("explain_concept").handler({ concept: "monads" })) as any;
    expect(out.found).toBe(false);
  });
});

describe("suggest_lessons tool", () => {
  it("returns an unlearned-first path for a topic", async () => {
    const out = (await tool("suggest_lessons").handler({
      topic: "borrowing",
      language: "rust",
    })) as any;
    expect(out.found).toBe(true);
    expect(out.path.length).toBeGreaterThan(0);
    // Every path entry carries difficulty + (possibly) lesson links.
    for (const step of out.path) {
      expect(typeof step.difficulty).toBe("number");
      expect(typeof step.learned).toBe("boolean");
    }
    // The chain for borrowing should include ownership (a prereq).
    expect(out.path.map((s: any) => s.id)).toContain("rust-ownership");
  });

  it("falls back to a language pool when no topic resolves", async () => {
    const out = (await tool("suggest_lessons").handler({ language: "rust" })) as any;
    expect(out.found).toBe(true);
    expect(out.path.length).toBeGreaterThan(0);
  });

  it("returns found:false when nothing matches", async () => {
    const out = (await tool("suggest_lessons").handler({ topic: "quantum" })) as any;
    expect(out.found).toBe(false);
  });
});
