/// `ensureChapterIds` backfills the chapter ids that 14 of the bundled
/// starter courses shipped without (see chapterIds.ts for the blast
/// radius). These pin the derivation contract the storage layer relies
/// on: deterministic title slugs, collision suffixes, identity fast-path
/// — plus a sweep over every real `public/starter-courses/*.json` so a
/// future ingest that ships id-less chapters in a shape the backfill
/// can't repair fails loudly here.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureChapterIds } from "@/data/chapterIds";
import type { Chapter, Course } from "@/data/types";

/// Bare-bones course; chapters carry no lessons because the backfill
/// never looks at them.
function course(chapters: Array<Partial<Chapter>>): Course {
  return {
    id: "demo",
    title: "Demo",
    language: "rust",
    chapters: chapters.map((ch) => ({ lessons: [], ...ch }) as Chapter),
  };
}

describe("ensureChapterIds", () => {
  it("returns the same reference when every chapter already has an id", () => {
    const c = course([
      { id: "intro", title: "Intro" },
      { id: "closures", title: "Closures" },
    ]);
    expect(ensureChapterIds(c)).toBe(c);
  });

  it("derives a slug from the title for chapters missing an id", () => {
    const c = course([
      { title: "Flow Control: Decisions and Loops" },
      { title: "Beazley's Last Statement" },
    ]);
    const ids = ensureChapterIds(c).chapters.map((ch) => ch.id);
    expect(ids).toEqual([
      "flow-control-decisions-and-loops",
      "beazley-s-last-statement",
    ]);
  });

  it("treats an empty-string id as missing", () => {
    const c = course([{ id: "", title: "Basics" }]);
    expect(ensureChapterIds(c).chapters[0].id).toBe("basics");
  });

  it("leaves already-valid ids untouched (same chapter reference)", () => {
    const c = course([{ id: "keep-me", title: "Keep Me" }, { title: "Fill Me" }]);
    const out = ensureChapterIds(c);
    expect(out.chapters[0]).toBe(c.chapters[0]);
    expect(out.chapters[1].id).toBe("fill-me");
  });

  it("suffixes duplicate titles positionally", () => {
    const c = course([{ title: "Koans" }, { title: "Koans" }, { title: "Koans" }]);
    const ids = ensureChapterIds(c).chapters.map((ch) => ch.id);
    expect(ids).toEqual(["koans", "koans-2", "koans-3"]);
  });

  it("never collides a derived slug with an existing chapter id", () => {
    const c = course([{ id: "basics", title: "Advanced" }, { title: "Basics" }]);
    const ids = ensureChapterIds(c).chapters.map((ch) => ch.id);
    expect(ids).toEqual(["basics", "basics-2"]);
  });

  it("renames later duplicates of a valid id, keeping the first untouched", () => {
    // Mirrors the real introduction-to-computer-organization-arm.json,
    // which ships two chapters sharing one id.
    const c = course([
      { id: "arm", title: "ARM" },
      { id: "arm", title: "ARM" },
    ]);
    const out = ensureChapterIds(c);
    expect(out.chapters[0]).toBe(c.chapters[0]);
    expect(out.chapters.map((ch) => ch.id)).toEqual(["arm", "arm-2"]);
  });

  it("suffixing a duplicate never steals a later chapter's legitimate id", () => {
    const c = course([
      { id: "basics", title: "Basics" },
      { id: "basics", title: "Basics" },
      { id: "basics-2", title: "More Basics" },
    ]);
    const ids = ensureChapterIds(c).chapters.map((ch) => ch.id);
    expect(ids).toEqual(["basics", "basics-3", "basics-2"]);
  });

  it("falls back to a positional id when the title yields no slug", () => {
    const c = course([{ title: "???" }, { title: undefined as unknown as string }]);
    const ids = ensureChapterIds(c).chapters.map((ch) => ch.id);
    expect(ids).toEqual(["chapter-1", "chapter-2"]);
  });

  it("is deterministic across repeated runs on fresh parses", () => {
    const c1 = course([{ title: "Koans" }, { title: "Koans" }]);
    const c2 = course([{ title: "Koans" }, { title: "Koans" }]);
    expect(ensureChapterIds(c1).chapters.map((ch) => ch.id)).toEqual(
      ensureChapterIds(c2).chapters.map((ch) => ch.id),
    );
  });

  it("tolerates placeholder-style courses with no chapters array", () => {
    const placeholder = { id: "p", title: "P" } as unknown as Course;
    expect(ensureChapterIds(placeholder)).toBe(placeholder);
  });
});

describe("shipped starter courses — backfill repairs every bundled JSON", () => {
  const dir = resolve(process.cwd(), "public/starter-courses");

  it("every chapter of every bundled course has a unique id after the backfill", () => {
    if (!existsSync(dir)) {
      console.warn("starter-courses extract not staged — skipping sweep");
      return;
    }
    const files = readdirSync(dir).filter(
      (f) =>
        f.endsWith(".json") &&
        f !== "manifest.json" &&
        // Locale overlays (<stem>.<loc>.json) aren't Course-shaped.
        !/\.[a-z]{2}\.json$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const f of files) {
      const raw = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Course;
      const fixed = ensureChapterIds(raw);
      const ids = fixed.chapters.map((ch) => ch.id);
      for (const id of ids) {
        expect(typeof id, `${f}: chapter id missing`).toBe("string");
        expect(id.length, `${f}: empty chapter id`).toBeGreaterThan(0);
      }
      expect(new Set(ids).size, `${f}: duplicate chapter ids`).toBe(ids.length);
    }
  });
});
