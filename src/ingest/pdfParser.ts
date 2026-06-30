/// Client-side PDF → Course pipeline. Mirrors the Node CLI in ingest/pdf-parser.ts
/// + ingest/cli.ts so a book imported through the app window produces the
/// same shape as `tsx cli.ts ...`.
///
/// The Tauri command `extract_pdf_text` handles the poppler call (pdftotext);
/// everything else runs in the webview so we only maintain one parser.

import type { Course, LanguageId } from "@/data/types";

export interface IngestOptions {
  courseId: string;
  title: string;
  author?: string;
  language: LanguageId;
}

export interface RawChapter {
  title: string;
  intro: string;
  sections: RawSection[];
}

export interface RawSection {
  title: string;
  body: string;
}

export function textToCourse(raw: string, opts: IngestOptions): Course {
  const chapters = splitChapters(raw);

  return {
    id: opts.courseId,
    title: opts.title,
    author: opts.author,
    description: "Ingested in-app from a PDF",
    language: opts.language,
    chapters: chapters.map((ch, i) => ({
      id: slug(ch.title, i),
      title: ch.title,
      lessons: sectionsToLessons(ch, i),
    })),
  };
}

// ---- Chapter / section splitting -------------------------------------------

export function splitChapters(text: string): RawChapter[] {
  const lines = text.split("\n");
  const tocSections = parseTocSections(lines);

  // Chapter openings come in two flavors we've seen in the wild:
  //   A) Older layout: a line beginning with a form-feed, like
  //      `\fChapter 4. Inside Reconciliation`
  //   B) Modern O'Reilly layout (Fluent React, etc): a right-aligned
  //      standalone marker `   CHAPTER 1` with the title on a later line.
  // We probe both patterns; the title-gathering logic is the same once we
  // know where the chapter starts.
  // We track the chapter number alongside the line index so we can dedupe
  // after the scan — books whose ToC wraps mid-numbering can produce a
  // false-positive Pattern-C match inside the ToC itself (a `\fN` at a page
  // break). We keep whichever hit has the highest line index, which is
  // always the body-text opening (ToC sits at the front of the document).
  const chapterHits: Array<{ n: number; title: string; lineIndex: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern A: `\fChapter N. Title` — title starts inline on the same line.
    let m = /^\fChapter\s+(\d+)\.\s+(.+?)$/.exec(line);
    if (m) {
      const n = parseInt(m[1], 10);
      let title = m[2].trim();
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) break;
        if (next.length > 60) break;
        if (/[.,:;]$/.test(next)) break;
        title += " " + next;
        if (title.length > 80) break;
      }
      chapterHits.push({ n, title, lineIndex: i });
      continue;
    }

    // Pattern B: a line containing ONLY "CHAPTER N" (with arbitrary leading
    // whitespace because O'Reilly right-aligns it). The actual chapter
    // title is typically the next non-empty short line. We anchor the regex
    // to the whole line to avoid matching prose like "Chapter 4 is…".
    m = /^\s*CHAPTER\s+(\d+)\s*$/.exec(line);
    if (m) {
      const n = parseInt(m[1], 10);
      let title = "";
      // Scan forward for the title. Skip blank lines. Break on long lines
      // (prose, not a heading) or lines ending in punctuation.
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const cand = lines[j].trim();
        if (!cand) continue;
        if (cand.length > 80) break;
        if (/[.:;,]$/.test(cand)) break;
        title = cand;
        // Gather continuation lines for multi-word titles that wrapped.
        for (let k = j + 1; k < Math.min(lines.length, j + 3); k++) {
          const cont = lines[k].trim();
          if (!cont) break;
          if (cont.length > 60) break;
          if (/[.,:;]$/.test(cont)) break;
          title += " " + cont;
          if (title.length > 100) break;
        }
        break;
      }
      if (title) {
        chapterHits.push({ n, title, lineIndex: i });
      }
      continue;
    }

    // Pattern C: No Starch Press body-chapter layout. Each chapter opens
    // on a new page with the structure:
    //   \f                            7
    //     PACKAGES, CRATES, AND MODULES
    //   <blank lines>
    //   <prose>
    // The leading `\f` is pdftotext's page-break marker and is critical for
    // disambiguating body chapter openings from the ToC — ToC entries also
    // have standalone digit+ALL-CAPS lines but lack the form-feed prefix.
    // Anchoring on `\f` gives us body chapters without ToC false positives.
    m = /^\f\s*(\d{1,2})\s*$/.exec(line);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n < 1 || n > 99) continue;
      // Scan forward for the title. The title line may have leading
      // whitespace from indentation on the chapter title page layout.
      let title = "";
      let titleLine = -1;
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const cand = lines[j].trim();
        if (!cand) continue;
        // Must be all-caps (no lowercase letters) and of heading-like length.
        if (cand.length < 4 || cand.length > 80) break;
        if (/[a-z]/.test(cand)) break;
        title = cand;
        titleLine = j;
        break;
      }
      if (!title || titleLine < 0) continue;
      // Gather continuation lines (also all-caps, short).
      for (let k = titleLine + 1; k < Math.min(lines.length, titleLine + 3); k++) {
        const cont = lines[k].trim();
        if (!cont) break;
        if (cont.length > 60) break;
        if (/[a-z]/.test(cont)) break;
        title += " " + cont;
        if (title.length > 120) break;
      }
      // Normalize to Title Case so the sidebar reads nicely (PACKAGES,
      // CRATES, AND MODULES → Packages, Crates, and Modules).
      chapterHits.push({ n, title: toTitleCase(title), lineIndex: i });
      continue;
    }
  }

  // Dedupe: when the same chapter number appears multiple times (e.g. a
  // ToC false positive + the real body opening), keep the later line index.
  // Body chapters always sit after the ToC, so "later = more correct".
  const bestByN = new Map<number, { n: number; title: string; lineIndex: number }>();
  for (const hit of chapterHits) {
    const prev = bestByN.get(hit.n);
    if (!prev || hit.lineIndex > prev.lineIndex) bestByN.set(hit.n, hit);
  }
  // Re-materialize as a sorted-by-line array so downstream slicing logic
  // (which assumes increasing lineIndex) still works.
  chapterHits.length = 0;
  for (const hit of bestByN.values()) chapterHits.push(hit);
  chapterHits.sort((a, b) => a.lineIndex - b.lineIndex);

  if (chapterHits.length === 0) {
    return [
      {
        title: "Book",
        intro: "",
        sections: [{ title: "Body", body: stripPageNoise(text) }],
      },
    ];
  }

  const out: RawChapter[] = [];
  for (let c = 0; c < chapterHits.length; c++) {
    const { title, lineIndex } = chapterHits[c];
    const end = c + 1 < chapterHits.length ? chapterHits[c + 1].lineIndex : lines.length;
    const bodyLines = lines.slice(lineIndex + 1, end);

    const sections = splitSections(bodyLines, tocSections.get(title) ?? []);
    const intro =
      sections.length > 0
        ? bodyLines.slice(0, sections[0].startIndex).join("\n")
        : bodyLines.join("\n");

    out.push({
      title,
      intro: stripPageNoise(intro).trim(),
      sections: sections.map((s) => ({
        title: s.title,
        body: stripPageNoise(s.body).trim(),
      })),
    });
  }
  return out;
}

function parseTocSections(lines: string[]): Map<string, string[]> {
  const tocWindow = lines.slice(0, Math.min(200, lines.length));
  const byChapter = new Map<string, string[]>();
  let current: string | null = null;

  for (const raw of tocWindow) {
    const line = raw.trim();
    if (!line) continue;

    const chap = /^\d+\.\s+\d+\.\s+(.+)$/.exec(line);
    if (chap) {
      current = chap[1].trim();
      byChapter.set(current, []);
      continue;
    }
    const sec = /^[a-z]\.\s+(.+)$/.exec(line);
    if (sec && current) {
      byChapter.get(current)!.push(sec[1].trim());
    }
    if (line.length > 90) break;
  }
  return byChapter;
}

function splitSections(
  bodyLines: string[],
  knownSectionTitles: string[],
): Array<{ title: string; body: string; startIndex: number }> {
  if (knownSectionTitles.length === 0) {
    return [{ title: "Body", body: bodyLines.join("\n"), startIndex: 0 }];
  }

  const titleSet = new Set(knownSectionTitles);
  const hits: Array<{ title: string; lineIndex: number }> = [];

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].trim();
    if (!titleSet.has(line)) continue;
    hits.push({ title: line, lineIndex: i });
  }

  if (hits.length === 0) {
    return [{ title: "Body", body: bodyLines.join("\n"), startIndex: 0 }];
  }

  const out: Array<{ title: string; body: string; startIndex: number }> = [];
  for (let i = 0; i < hits.length; i++) {
    const { title, lineIndex } = hits[i];
    const end = i + 1 < hits.length ? hits[i + 1].lineIndex : bodyLines.length;
    const body = bodyLines.slice(lineIndex + 1, end).join("\n");
    out.push({ title, body, startIndex: lineIndex });
  }
  return out;
}

// ---- Lesson shaping --------------------------------------------------------

function sectionsToLessons(ch: RawChapter, chIndex: number) {
  const lessons: {
    id: string;
    kind: "reading";
    title: string;
    body: string;
  }[] = [];

  if (ch.intro) {
    lessons.push({
      id: slug(`${ch.title}-overview`, `${chIndex}-0`),
      kind: "reading",
      title: `${ch.title} — Overview`,
      body: ch.intro,
    });
  }

  for (const [i, s] of ch.sections.entries()) {
    if (!s.body) continue;
    lessons.push({
      id: slug(s.title, `${chIndex}-${i + 1}`),
      kind: "reading",
      title: s.title,
      body: s.body,
    });
  }

  if (lessons.length === 0) {
    lessons.push({
      id: slug(ch.title, chIndex),
      kind: "reading",
      title: ch.title,
      body: "(empty chapter)",
    });
  }
  return lessons;
}

// ---- Helpers ---------------------------------------------------------------

function stripPageNoise(s: string): string {
  return s
    .split("\n")
    .filter((l) => !/^\s*\d+\s*$/.test(l))
    .join("\n");
}

function slug(s: string, fallback: number | string = "x"): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `chapter-${fallback}`;
}

/// Convert an ALL-CAPS title to Title Case (used on No Starch chapter
/// headings like "PACKAGES, CRATES, AND MODULES" → "Packages, Crates, and
/// Modules"). Small function words stay lowercase except when they're the
/// first word.
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or",
  "the", "to", "vs", "via", "with",
]);
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      // Preserve acronyms/capitalized words we'd want to keep caps on —
      // heuristic: if the word matches a known programming acronym, keep
      // it uppercase. Rare enough we can add exceptions over time.
      if (/^(i\/o|api|ui|cli|json|yaml|xml|html|css|js|ts)$/i.test(word)) {
        return word.toUpperCase();
      }
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
