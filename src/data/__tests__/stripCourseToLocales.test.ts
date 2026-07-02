/// `stripCourseToLocales` powers the "choose languages on install" flow:
/// after the learner picks which translations to keep, we prune the fetched
/// course to exactly those before persisting. These pin the pruning shape —
/// selected locales survive at every level, the rest vanish, and English
/// base content is never touched.

import { describe, expect, it } from "vitest";
import { availableLocalesFor, stripCourseToLocales } from "@/data/localize";
import type { Course } from "@/data/types";

function fixture(): Course {
  return {
    id: "demo",
    title: "Demo",
    language: "rust",
    translations: {
      es: { title: "Demo ES" },
      hi: { title: "Demo HI" },
      kr: { title: "Demo KR" },
    },
    chapters: [
      {
        id: "ch1",
        title: "Chapter 1",
        translations: { es: { title: "Cap 1" }, hi: { title: "अध्याय 1" } },
        lessons: [
          {
            kind: "reading",
            id: "l1",
            title: "Lesson 1",
            body: "hello",
            translations: {
              es: { title: "Lección 1", body: "hola" },
              hi: { title: "पाठ 1" },
              kr: { title: "레슨 1" },
            },
          },
          {
            kind: "reading",
            id: "l2",
            title: "Lesson 2",
            body: "world",
            translations: { es: { body: "mundo" } },
          },
        ],
      },
    ],
  };
}

describe("stripCourseToLocales", () => {
  it("keeps only the requested locales and drops the rest", () => {
    const out = stripCourseToLocales(fixture(), ["en", "es"]);
    expect(availableLocalesFor(out)).toEqual(["en", "es"]);
    expect(out.translations).toEqual({ es: { title: "Demo ES" } });
    expect(out.chapters[0].translations).toEqual({ es: { title: "Cap 1" } });
    expect(out.chapters[0].lessons[0].translations).toEqual({
      es: { title: "Lección 1", body: "hola" },
    });
    expect(out.chapters[0].lessons[1].translations).toEqual({
      es: { body: "mundo" },
    });
  });

  it("drops the translations field entirely when only English is kept", () => {
    const out = stripCourseToLocales(fixture(), ["en"]);
    expect(availableLocalesFor(out)).toEqual(["en"]);
    expect(out.translations).toBeUndefined();
    expect(out.chapters[0].translations).toBeUndefined();
    expect(out.chapters[0].lessons[0].translations).toBeUndefined();
    expect(out.chapters[0].lessons[1].translations).toBeUndefined();
  });

  it("leaves English base content untouched", () => {
    const out = stripCourseToLocales(fixture(), ["en", "hi"]);
    expect(out.title).toBe("Demo");
    expect(out.chapters[0].title).toBe("Chapter 1");
    expect(out.chapters[0].lessons[0].title).toBe("Lesson 1");
    expect(out.chapters[0].lessons[0].body).toBe("hello");
    expect(availableLocalesFor(out)).toEqual(["en", "hi"]);
  });

  it("keeps everything when all present locales are requested", () => {
    const out = stripCourseToLocales(fixture(), ["en", "es", "hi", "kr"]);
    expect(availableLocalesFor(out)).toEqual(["en", "es", "hi", "kr"]);
  });

  it("does not mutate the input course", () => {
    const c = fixture();
    stripCourseToLocales(c, ["en"]);
    expect(availableLocalesFor(c)).toEqual(["en", "es", "hi", "kr"]);
  });
});
