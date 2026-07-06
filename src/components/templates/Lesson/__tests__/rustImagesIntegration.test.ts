/// End-to-end smoke test against the SHIPPED migrated Rust course: read
/// the real `public/starter-courses/the-rust-programming-language.json`,
/// register its de-duplicated `images` map, render actual lesson bodies
/// through the real markdown pipeline, and assert that EVERY resolved
/// `data-asset` hash exists in the map. This is the guarantee that a
/// migrated course renders no broken images.
///
/// Skips gracefully if the file is absent or un-migrated (no `images`),
/// so it never blocks a checkout that hasn't run the migration.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown";
import {
  registerCourseImages,
  resolveCourseAsset,
} from "@/data/courseImages";

const COURSE_PATH = resolve(
  process.cwd(),
  "public/starter-courses/the-rust-programming-language.json",
);

describe("shipped Rust course — asset images resolve end-to-end", () => {
  it("every rendered data-asset in real lesson bodies exists in course.images", async () => {
    if (!existsSync(COURSE_PATH)) {
      console.warn("Rust course json not found — skipping integration check");
      return;
    }
    const course = JSON.parse(readFileSync(COURSE_PATH, "utf8"));
    if (!course.images || Object.keys(course.images).length === 0) {
      console.warn("Rust course not migrated (no images map) — skipping");
      return;
    }

    registerCourseImages(course.id, course.images);
    expect(Object.keys(course.images).length).toBeGreaterThan(50);

    // Render the first lesson of each chapter (a representative spread).
    const lessons = course.chapters.flatMap((c: { lessons: unknown[] }) =>
      c.lessons.slice(0, 1),
    ) as Array<{ body?: string }>;
    expect(lessons.length).toBeGreaterThan(3);

    let checkedImages = 0;
    for (const lesson of lessons) {
      if (!lesson.body) continue;
      const html = await renderMarkdown(lesson.body);
      // No bogus scheme ever reaches the DOM.
      expect(html).not.toContain("asset://");
      // Every hoisted data-asset hash must resolve in the map.
      for (const m of html.matchAll(/data-asset="([a-f0-9]+)"/g)) {
        checkedImages++;
        expect(resolveCourseAsset(course.id, m[1])).toBeTruthy();
      }
    }
    // The spread should have exercised a bunch of real images.
    expect(checkedImages).toBeGreaterThan(3);
  });
});
