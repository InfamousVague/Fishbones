/// PDF → structured chapters.
///
/// Pipeline:
///   1. Shell out to `pdftotext -layout` to get a layout-preserving text dump.
///      (poppler-utils — on macOS: `brew install poppler`.)
///   2. Scan the dump for chapter openings: lines matching `^Chapter N. Title`.
///   3. Within each chapter body, split on known section titles. We derive
///      the list of section titles from the TOC (first ~60 lines of the dump)
///      so this works for any O'Reilly-style book with a flat
///      Chapter → Section → Subsection table of contents.
///
/// Doesn't do code-block extraction yet — code and prose are both emitted in
/// a single lesson body. The next iteration will use pdfjs-dist for font
/// metadata so we can detect monospace runs and wrap them in ``` fences.

import { execSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

export interface RawChapter {
  title: string;
  /** Free-form intro before the first section. */
  intro: string;
  sections: RawSection[];
}

export interface RawSection {
  title: string;
  body: string;
}

export async function parsePdf(path: string): Promise<RawChapter[]> {
  const txtPath = joinPath(tmpdir(), `fishbones-ingest-${Date.now()}.txt`);
  await mkdir(tmpdir(), { recursive: true });

  try {
    execSync(
      `pdftotext -layout ${JSON.stringify(path)} ${JSON.stringify(txtPath)}`,
      { stdio: "pipe" },
    );
  } catch (e) {
    throw new Error(
      `pdftotext failed — install poppler-utils first (e.g. 'brew install poppler'). Underlying: ${String(e)}`,
    );
  }

  const text = await readFile(txtPath, "utf8");
  await cleanup(txtPath);
  return splitChapters(text);
}

/// Discover chapter + section boundaries in the PDF text.
///
/// Chapter openings look like a bare line: `Chapter 1. Classes`.
/// Section titles are those listed in the TOC; we find them as standalone
/// lines inside the chapter body (ignoring inline cross-references).
export function splitChapters(text: string): RawChapter[] {
  const lines = text.split("\n");
  const tocSections = parseTocSections(lines);

  // Find each real chapter opening. In pdftotext output, a chapter starts on
  // a fresh page — denoted by a form-feed character ('\f') preceding the
  // "Chapter N. Title" line. Inline cross-references to "Chapter 2. ..." in
  // prose don't have a form feed, so this reliably tells them apart.
  //
  // Titles sometimes wrap across two lines (e.g. "Chapter 2. Iterators and\n
  // Generators"). We collect lines after the opening until a blank line to
  // get the full title.
  const chapterHits: Array<{ chapterNumber: number; title: string; lineIndex: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\fChapter\s+(\d+)\.\s+(.+?)$/.exec(lines[i]);
    if (!m) continue;

    let title = m[2].trim();
    // Stitch wrapped title lines (non-blank, reasonably short) onto the title.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) break;
      if (next.length > 60) break; // almost certainly prose, not a title
      if (/[.,:;]$/.test(next)) break;
      title += " " + next;
      if (title.length > 80) break;
    }

    chapterHits.push({ chapterNumber: parseInt(m[1], 10), title, lineIndex: i });
  }

  if (chapterHits.length === 0) {
    // No chapter openings — treat the whole doc as one chapter.
    return [
      {
        title: "Book",
        intro: "",
        sections: [{ title: "Body", body: stripHeaderFooter(text) }],
      },
    ];
  }

  const out: RawChapter[] = [];
  for (let c = 0; c < chapterHits.length; c++) {
    const { title, lineIndex } = chapterHits[c];
    const end = c + 1 < chapterHits.length ? chapterHits[c + 1].lineIndex : lines.length;
    const bodyLines = lines.slice(lineIndex + 1, end);

    const sections = splitSections(bodyLines, tocSections.get(title) ?? []);
    const intro = sections.length > 0
      ? bodyLines.slice(0, sections[0].startIndex).join("\n")
      : bodyLines.join("\n");

    out.push({
      title,
      intro: stripHeaderFooter(intro).trim(),
      sections: sections.map((s) => ({ title: s.title, body: stripHeaderFooter(s.body).trim() })),
    });
  }
  return out;
}

/// Walk the first chunk of lines looking for the TOC. In O'Reilly exports it's
/// a nested list like `2. 1. Classes` → chapter entry, `a. Classes and
/// Prototypes` → section entry. Returns a map of chapter title → section
/// titles in order.
function parseTocSections(lines: string[]): Map<string, string[]> {
  const tocWindow = lines.slice(0, Math.min(200, lines.length));
  const byChapter = new Map<string, string[]>();
  let currentChapter: string | null = null;

  for (const raw of tocWindow) {
    const line = raw.trim();
    if (!line) continue;

    // Chapter entry: `2. 1. Classes`  (ordinal . chapter-number . title)
    const chap = /^\d+\.\s+\d+\.\s+(.+)$/.exec(line);
    if (chap) {
      currentChapter = chap[1].trim();
      byChapter.set(currentChapter, []);
      continue;
    }
    // Section entry at depth 1: `a. Classes and Prototypes`
    const sec = /^[a-z]\.\s+(.+)$/.exec(line);
    if (sec && currentChapter) {
      byChapter.get(currentChapter)!.push(sec[1].trim());
    }
    // Stop once we've left the TOC — the preface's body starts with
    // "With Early Release ebooks" or similar long prose lines.
    if (line.length > 90) break;
  }
  return byChapter;
}

/// Inside a chapter body, split on lines that exactly match any of the known
/// section titles (so cross-references in prose don't trigger splits).
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
    const raw = bodyLines[i];
    const line = raw.trim(); // trim() strips form feeds too
    if (!titleSet.has(line)) continue;

    // If the raw line starts with a form feed, this is definitely a heading
    // (O'Reilly PDFs put section breaks on a fresh page column). Otherwise,
    // trust the exact-match against the TOC-derived title set — prose rarely
    // emits a single line that exactly matches a known title.
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

/// Rip out repeating page headers/footers. Cheap approach for V1: drop lines
/// that look like naked page numbers or URLs. A stricter pass could learn
/// the repeating strings per-book and filter those.
function stripHeaderFooter(s: string): string {
  return s
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (/^\d+$/.test(t)) return false; // page number
      return true;
    })
    .join("\n");
}

async function cleanup(path: string) {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
  } catch {
    /* ignore */
  }
}

// Silence unused warning for writeFile (kept as a sibling export for debug).
void writeFile;
