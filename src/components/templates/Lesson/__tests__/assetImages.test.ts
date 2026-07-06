/// De-duplicated course images: the renderer must turn an
/// `![alt](asset://<hash> "caption")` markdown image into an
/// `<img data-asset="hash">` with NO eager src (so the browser never
/// fetches the bogus scheme), while the reader resolves it from the
/// per-course image registry at paint time. This pins that contract.

import { describe, expect, it, beforeEach } from "vitest";
import { renderMarkdown } from "../markdown";
import {
  __clearCourseImages,
  registerCourseImages,
  resolveCourseAsset,
  hasCourseImages,
} from "@/data/courseImages";

const DATA_URI = "data:image/webp;base64,UklGRhABAAA=";

describe("asset:// image rendering", () => {
  it("rewrites a standalone asset image into a figure with data-asset + no src", async () => {
    const html = await renderMarkdown(
      '![hero: A claw machine](asset://abc123def "rustup assembles your toolchain")',
    );
    // Hoisted onto data-asset; the bogus scheme never reaches src.
    expect(html).toContain('data-asset="abc123def"');
    expect(html).not.toContain("asset://");
    expect(html).not.toContain('src="asset');
    // Promoted to a figure card with the caption + lazy loading.
    expect(html).toContain("libre-figure");
    expect(html).toContain("rustup assembles your toolchain");
    expect(html).toContain('loading="lazy"');
    // Size-class prefix stripped from the visible alt.
    expect(html).toContain('alt="A claw machine"');
  });

  it("handles an inline (non-figure) asset image too", async () => {
    const html = await renderMarkdown('text before ![x](asset://deadbeef) text after');
    expect(html).toContain('data-asset="deadbeef"');
    expect(html).not.toContain("asset://");
  });

  it("leaves ordinary data: URIs untouched (un-migrated courses)", async () => {
    const html = await renderMarkdown(`![pic](${DATA_URI} "cap")`);
    expect(html).toContain(DATA_URI);
    expect(html).not.toContain("data-asset");
  });
});

describe("course image registry", () => {
  beforeEach(() => __clearCourseImages());

  it("registers + resolves by (courseId, hash)", () => {
    expect(hasCourseImages("rust")).toBe(false);
    registerCourseImages("rust", { abc123def: DATA_URI });
    expect(hasCourseImages("rust")).toBe(true);
    expect(resolveCourseAsset("rust", "abc123def")).toBe(DATA_URI);
    expect(resolveCourseAsset("rust", "missing")).toBeUndefined();
    expect(resolveCourseAsset("other", "abc123def")).toBeUndefined();
  });

  it("ignores empty / missing maps", () => {
    registerCourseImages("x", undefined);
    registerCourseImages("x", {});
    expect(hasCourseImages("x")).toBe(false);
  });
});
