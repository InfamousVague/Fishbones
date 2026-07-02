/// Per-locale download overlays: `extractLocaleOverlay` carves one language
/// out of a fully-translated course into a sidecar; `applyLocaleOverlay`
/// re-attaches it onto the English base. These pin the round-trip that the
/// install/seed path relies on (fetch base + chosen overlays → reconstruct
/// the inline `translations` shape the reader expects).

import { describe, expect, it } from "vitest";
import {
  applyLocaleOverlay,
  availableLocalesFor,
  extractLocaleOverlay,
  stripCourseToLocales,
} from "@/data/localize";
import type { Course } from "@/data/types";

function fixture(): Course {
  return {
    id: "demo",
    title: "Demo",
    language: "rust",
    translations: { es: { title: "Demo ES" }, hi: { title: "Demo HI" } },
    chapters: [
      {
        id: "ch1",
        title: "Chapter 1",
        translations: { es: { title: "Cap 1" } },
        lessons: [
          {
            kind: "reading",
            id: "l1",
            title: "Lesson 1",
            body: "hello",
            translations: {
              es: { title: "Lección 1", body: "hola" },
              hi: { title: "पाठ 1" },
            },
          },
          { kind: "reading", id: "l2", title: "Lesson 2", body: "world" },
        ],
      },
    ],
  };
}

describe("extract/applyLocaleOverlay", () => {
  it("round-trips: English base + overlay reproduces the localized course", () => {
    const full = fixture();
    const overlayEs = extractLocaleOverlay(full, "es");
    const base = stripCourseToLocales(full, ["en"]); // English-only base
    expect(availableLocalesFor(base)).toEqual(["en"]);

    const merged = applyLocaleOverlay(base, overlayEs);
    expect(availableLocalesFor(merged)).toEqual(["en", "es"]);
    expect(merged.translations).toEqual({ es: { title: "Demo ES" } });
    expect(merged.chapters[0].translations).toEqual({ es: { title: "Cap 1" } });
    expect(merged.chapters[0].lessons[0].translations).toEqual({
      es: { title: "Lección 1", body: "hola" },
    });
  });

  it("stacks multiple overlays onto the base", () => {
    const full = fixture();
    let merged = stripCourseToLocales(full, ["en"]);
    merged = applyLocaleOverlay(merged, extractLocaleOverlay(full, "es"));
    merged = applyLocaleOverlay(merged, extractLocaleOverlay(full, "hi"));
    expect(availableLocalesFor(merged)).toEqual(["en", "es", "hi"]);
    // English base content untouched
    expect(merged.chapters[0].lessons[0].body).toBe("hello");
    expect(merged.chapters[0].lessons[0].translations).toEqual({
      es: { title: "Lección 1", body: "hola" },
      hi: { title: "पाठ 1" },
    });
  });

  it("an overlay for a locale the course lacks is a no-op", () => {
    const full = fixture();
    const emptyOverlay = extractLocaleOverlay(full, "kr"); // kr not present
    expect(emptyOverlay.chapters).toEqual({});
    expect(emptyOverlay.lessons).toEqual({});
    const base = stripCourseToLocales(full, ["en"]);
    expect(availableLocalesFor(applyLocaleOverlay(base, emptyOverlay))).toEqual([
      "en",
    ]);
  });
});
