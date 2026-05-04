import type { ReadingLesson } from "../../data/types";
import { splitChapters } from "../pdfParser";
import type { ChapterBlob } from "./types";

/// Max cleaned-markdown characters we'll feed to outline_chapter or
/// generate_lesson as reference context. A concatenated multi-chunk
/// chapter can otherwise approach the cleaning input size (~720K chars
/// for a 4-chunk chapter) which busts the 200K-token input ceiling once
/// the system prompt is added. Cap at ~500K chars (~125K tokens) so the
/// API request stays under 200K with room for the system prompt and
/// the response.
export const MAX_REFERENCE_CHARS = 500_000;

/// Truncate markdown for use as reference context in downstream LLM calls.
/// Prefers cutting at a heading or blank-line boundary so sections aren't
/// chopped mid-sentence; falls back to a hard cut. Returns the original
/// string untouched when it already fits.
export function fitReference(md: string): { text: string; truncated: boolean } {
  if (md.length <= MAX_REFERENCE_CHARS) return { text: md, truncated: false };
  const window = md.slice(0, MAX_REFERENCE_CHARS);
  // Prefer a heading break; then a blank-line break; else hard cut.
  let idx = window.lastIndexOf("\n## ");
  if (idx < MAX_REFERENCE_CHARS * 0.7) idx = window.lastIndexOf("\n\n");
  if (idx < MAX_REFERENCE_CHARS * 0.7) idx = MAX_REFERENCE_CHARS;
  return {
    text:
      window.slice(0, idx) +
      `\n\n*(Reference truncated — chapter was ${Math.round(md.length / 1000)}KB, cap is ${Math.round(MAX_REFERENCE_CHARS / 1000)}KB. Later sections aren't visible to this call.)*\n`,
    truncated: true,
  };
}

/// Split a raw chapter body into chunks small enough for clean_code. Walks
/// from the end of the window backward looking for the cleanest boundary —
/// form feeds (PDF page breaks) are best, then big whitespace gaps, then
/// sentence breaks, finally a hard cut. The last-resort hard cut should
/// rarely fire; pdftotext output is peppered with form feeds.
export function splitForCleaning(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    // Only search the last quarter of the window for a boundary so chunks
    // stay roughly balanced — splitting way earlier than maxChars would
    // waste capacity and blow up the chunk count.
    const searchStart = Math.floor(maxChars * 0.75);
    const window = remaining.slice(searchStart, maxChars);
    let relIdx = -1;
    for (const boundary of ["\f", "\n\n\n", "\n\n", "\n", ". "]) {
      const idx = window.lastIndexOf(boundary);
      if (idx >= 0) {
        relIdx = idx + boundary.length;
        break;
      }
    }
    const splitAt = relIdx >= 0 ? searchStart + relIdx : maxChars;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export function splitChaptersIntoRaw(rawText: string): ChapterBlob[] {
  // Re-use the deterministic splitter from pdfParser — it's good enough at
  // partitioning the raw text into per-chapter chunks for the LLM to work on.
  // We flatten the section-level structure into a single body per chapter
  // since Stage 1 (clean_code) re-finds headings on its own.
  const fullChapters = splitChapters(rawText);
  return fullChapters.map((c) => ({
    title: c.title,
    body:
      (c.intro ? c.intro + "\n\n" : "") +
      c.sections
        .map((s) => `## ${s.title}\n\n${s.body}`)
        .join("\n\n"),
  }));
}

export function parseJson<T>(raw: string, context: string): T {
  // Fast path: well-behaved response parses directly.
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* fall through to recovery heuristics */
  }

  // Recovery 1: response is wrapped in a markdown code fence.
  //   ```json
  //   { ... }
  //   ```
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      /* fall through */
    }
  }

  // Recovery 2: Claude prefaced with prose ("Looking at the failure…") before
  // the JSON. Find the first `{` or `[` and the matching closer, then try
  // parsing that slice. This is obviously heuristic — if the prose itself
  // contains braces it could misfire — but in practice Claude's preamble
  // is pure English and the fallback is a clear error message.
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = raw.indexOf(open);
    const end = raw.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
  }

  // Give up — surface a clear error with the first chunk so the operator
  // can see what the LLM actually said.
  const snippet = raw.slice(0, 300);
  throw new Error(
    `LLM returned invalid JSON for ${context}. First 300 chars:\n${snippet}`,
  );
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "x";
}

export function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/// Substitute lesson used when Anthropic's content filter blocks generation.
/// Renders as a reading with a clear note about what happened so the
/// learner isn't staring at an unexplained gap in the course. Intentionally
/// NOT cached — leaving the cache slot empty means a future re-run can
/// retry (maybe with a different model, or after you tweak the stub).
export function buildFilteredPlaceholder(
  stub: { id: string; kind: string; title: string; intent?: string },
  chapterTitle: string,
): ReadingLesson {
  const body = [
    `## ${stub.title}`,
    "",
    "> This lesson was skipped during automated generation — Anthropic's safety filter blocked the draft response. The rest of the course imported normally.",
    "",
    stub.intent ? `**Planned intent:** ${stub.intent}` : "",
    "",
    `**Where to find it in the book:** see the "${chapterTitle}" chapter for this section.`,
    "",
    "Re-run the import from Settings → Data (Clear cache) if you want to try generation again, optionally with a different model.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    kind: "reading",
    id: stub.id,
    title: stub.title,
    body,
  };
}

/// Human-readable byte count, used in ingest progress events. Pipe output
/// like "142 MB" or "2.1 MB" reads better than the raw number — the user
/// is glancing at a log line, not counting digits.
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
