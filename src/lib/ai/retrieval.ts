/// Course retrieval v2 — chunk-level lexical search over installed
/// course content so AI answers ground themselves in the learner's
/// actual material and cite it with clickable libre:// links.
///
/// v1 scored whole lesson bodies with bag-of-words overlap. Good
/// enough to find "the borrowing lesson", but snippets centred on
/// the FIRST occurrence of one token (often a throwaway mention)
/// and multi-word concepts ("borrow checker", "interior
/// mutability") scored no better than the same words scattered
/// across unrelated paragraphs. v2 fixes both:
///
///   - Bodies split into paragraph-merged CHUNKS (~150-600 chars);
///     each chunk scores independently and the best chunk IS the
///     snippet — so the excerpt shown to the model is the densest
///     matching passage, not the lesson's opening sentence.
///   - Adjacent query-token BIGRAMS matched as phrases earn a
///     bonus: a chunk containing "borrow checker" outranks one
///     containing "borrow" in paragraph 1 and "checker" in
///     paragraph 9.
///   - Optional `currentCourseId` affinity boost: a question asked
///     from inside Rustlings prefers Rustlings + same-language
///     material when scores are close, without hard-filtering
///     cross-course gems.
///
/// Still purely lexical, zero dependencies, microsecond-fast on a
/// few hundred lessons. An embedding index can slot in behind the
/// same signature if the corpus ever outgrows this.

import type { Course } from "@/data/types";

export interface RetrievalHit {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  /// The best-matching chunk of the lesson body.
  snippet: string;
  /// Relative score — only meaningful within one query's results.
  score: number;
  /// Clickable in-app deep link (`libre://lesson/<c>/<l>`).
  link: string;
}

export interface RetrievalOptions {
  /// Course the learner is currently inside — same-course hits get
  /// a mild multiplicative boost (ties break toward "the material
  /// you're already studying").
  currentCourseId?: string;
}

/// Tokens too common to carry signal. Tiny on purpose — code
/// identifiers ("mut", "impl", "use") are real signal in a
/// programming corpus, so we only drop genuine English glue.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in",
  "on", "at", "and", "or", "it", "its", "this", "that", "with",
  "for", "do", "does", "how", "what", "why", "when", "where",
  "can", "i", "my", "me", "you", "your", "we", "be", "as", "by",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/// Split a body into scoring chunks: paragraphs merged forward
/// until ~150 chars minimum, hard-split past ~600 so one giant
/// paragraph can't hide multiple concepts in a single score.
export function chunkBody(body: string): string[] {
  if (!body.trim()) return [];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    buf = buf ? `${buf} ${p}` : p;
    if (buf.length >= 150) {
      // Hard-split oversize buffers at sentence-ish boundaries.
      while (buf.length > 600) {
        const cut = findSplit(buf, 600);
        chunks.push(buf.slice(0, cut).trim());
        buf = buf.slice(cut).trim();
      }
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/// Best split point at/before `max`: sentence end > word break.
function findSplit(text: string, max: number): number {
  for (let i = max; i > max - 200 && i > 0; i--) {
    if (/[.!?]/.test(text[i]) && /\s/.test(text[i + 1] ?? " ")) return i + 1;
  }
  for (let i = max; i > 0; i--) {
    if (/\s/.test(text[i])) return i;
  }
  return max;
}

/// Score one chunk against the query's unigrams + adjacent
/// bigram phrases.
function scoreChunk(
  chunkLower: string,
  qTokens: readonly string[],
  bigrams: readonly string[],
): number {
  let score = 0;
  for (const t of qTokens) {
    const count = countOccurrences(chunkLower, t);
    if (count > 0) score += 1 + Math.log2(1 + Math.min(count, 8));
  }
  for (const bg of bigrams) {
    if (chunkLower.includes(bg)) score += 2.5;
  }
  return score;
}

/// Search every lesson of every course. Returns top `k` hits
/// sorted by score desc.
export function searchCourseContent(
  courses: readonly Course[],
  query: string,
  k = 3,
  options: RetrievalOptions = {},
): RetrievalHit[] {
  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0) return [];
  // Adjacent-pair phrases from the ORIGINAL token order (dedup
  // breaks order, so re-tokenize without dedup for bigram pairs).
  const ordered = tokenize(query);
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i] !== ordered[i + 1]) {
      bigrams.push(`${ordered[i]} ${ordered[i + 1]}`);
    }
  }

  const hits: RetrievalHit[] = [];
  for (const course of courses) {
    const affinity =
      options.currentCourseId && course.id === options.currentCourseId
        ? 1.25
        : 1;
    for (const chapter of course.chapters) {
      for (const lesson of chapter.lessons) {
        const titleTokens = new Set(
          tokenize(`${lesson.title} ${chapter.title}`),
        );
        let titleScore = 0;
        for (const qt of qTokens) {
          if (titleTokens.has(qt)) titleScore += 3;
        }

        const chunks = chunkBody(lesson.body ?? "");
        let best = 0;
        let second = 0;
        let bestChunk = "";
        for (const chunk of chunks) {
          const s = scoreChunk(chunk.toLowerCase(), qTokens, bigrams);
          if (s > best) {
            second = best;
            best = s;
            bestChunk = chunk;
          } else if (s > second) {
            second = s;
          }
        }

        const raw = titleScore + best + 0.3 * second;
        if (raw <= 0) continue;
        hits.push({
          courseId: course.id,
          courseTitle: course.title,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          snippet: trimSnippet(bestChunk || firstProse(lesson.body ?? "")),
          score: raw * affinity,
          link: `libre://lesson/${course.id}/${lesson.id}`,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(0, k));
}

/// Render hits as the grounding block appended to prompts.
export function formatRetrievalBlock(hits: readonly RetrievalHit[]): string {
  if (hits.length === 0) return "";
  const items = hits
    .map(
      (h) =>
        `### ${h.courseTitle} — ${h.lessonTitle}\nLink: ${h.link}\n> ${h.snippet.replace(/\n/g, "\n> ")}`,
    )
    .join("\n\n");
  return [
    "## Related material from the learner's installed courses",
    "Cite these with their libre:// links when your answer draws on them — the links are clickable and open the lesson.",
    "",
    items,
  ].join("\n");
}

function countOccurrences(haystackLower: string, tokenLower: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystackLower.indexOf(tokenLower, idx)) !== -1) {
    count += 1;
    idx += tokenLower.length;
    if (count >= 50) break;
  }
  return count;
}

function trimSnippet(chunk: string): string {
  const clean = chunk.replace(/\s+/g, " ").trim();
  if (clean.length <= 300) return clean;
  let end = 300;
  while (end > 220 && /\S/.test(clean[end])) end -= 1;
  return `${clean.slice(0, end).trim()}…`;
}

function firstProse(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}
