/// The full ingest pipeline, run from the webview.
///
/// Stages:
///   0. extract_pdf_text (pdftotext)
///   1. clean_code (LLM per chapter)
///   2. outline_chapter (LLM per chapter)
///   3. generate_lesson (LLM per stub)
///   4. validate exercises: solution-passes + starter-fails, retry 3x
///   5. assemble Course and return it (caller decides whether to save)
///
/// Every stage caches its output via cache_read/cache_write so interrupted
/// runs resume from the last completed stage.
///
/// Each pipeline call emits progress events via an onProgress callback so
/// the UI can show what's happening and the user doesn't stare at a blank
/// window while Claude thinks.

import { invoke } from "@tauri-apps/api/core";
import { runCode, isPassing } from "../runtimes";
import type {
  Course,
  Lesson,
  LanguageId,
  ReadingLesson,
  ExerciseLesson,
} from "../data/types";
import { splitChapters } from "./pdfParser";

// Local shape for stage-1 input (per-chapter blob). Distinct from pdfParser's
// RawChapter which carries section-level metadata we flatten down.
interface ChapterBlob {
  title: string;
  body: string;
}

export interface PipelineOptions {
  pdfPath: string;
  bookId: string;       // slugified id used for cache directory + course id
  title: string;
  author?: string;
  language: LanguageId;
  /** High-level stage label for the main progress line. */
  onProgress: (stage: string, detail?: string) => void;
  /** Optional fine-grained event stream for the verbose log panel. */
  onEvent?: (event: IngestEvent) => void;
  /** Cumulative stats snapshot pushed after each material update. */
  onStats?: (stats: PipelineStats) => void;
  /**
   * When aborted, the pipeline throws at the next cancel checkpoint (between
   * stages / API calls). The per-stage cache means the user can re-run and
   * pick up right where they stopped.
   */
  signal?: AbortSignal;
}

export interface IngestEvent {
  timestamp: number;
  level: "info" | "warn" | "error" | "cache";
  stage: "extract" | "clean" | "outline" | "generate" | "validate" | "retry" | "save" | "meta";
  chapter?: number;
  lesson?: string;
  message: string;
}

/// Rolling counters rendered as a stats bar above the running progress row.
/// Frontend caches the latest value and re-renders it whenever onStats fires.
export interface PipelineStats {
  startedAt: number;        // Date.now() at pipeline start
  elapsedMs: number;
  totalChapters: number;
  chaptersDone: number;
  lessonsTotal: number;     // sum of all outlined stubs across planned chapters
  lessonsDone: number;      // lessons fully generated (and for exercises, validated)
  lessonsByKind: Record<string, number>;
  apiCalls: number;         // Anthropic calls this run (cache hits don't count)
  cacheHits: number;
  validationAttempts: number;
  validationFailures: number; // non-final failures (pre-retry)
  demotedExercises: number;   // exercises that used up all retries → reading
  inputTokens: number;
  outputTokens: number;
  /// Per-million-token cost at the selected model. Unit: USD.
  estimatedCostUsd: number;
  model: string;
}

// Pricing in USD per 1M tokens. Update if Anthropic's prices change.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-4-5":   { input: 15, output: 75 },
  "claude-haiku-4-5":  { input: 1, output: 5 },
};

function costFor(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-5"];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export class IngestAborted extends Error {
  constructor() {
    super("ingest aborted by user");
    this.name = "IngestAborted";
  }
}

/// A single Anthropic reply as returned from every LLM command in llm.rs.
interface LlmResponseTS {
  text: string;
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
}

export async function runPipeline(opts: PipelineOptions): Promise<Course> {
  const { pdfPath, bookId, title, author, language, onProgress, onEvent, onStats, signal } = opts;

  // Detect the model we're currently running under so stats can cost it out.
  let currentModel = "claude-sonnet-4-5";
  try {
    const s = await invoke<{ anthropic_model?: string }>("load_settings");
    if (s.anthropic_model) currentModel = s.anthropic_model;
  } catch { /* not in Tauri — keep default */ }

  const stats: PipelineStats = {
    startedAt: Date.now(),
    elapsedMs: 0,
    totalChapters: 0,
    chaptersDone: 0,
    lessonsTotal: 0,
    lessonsDone: 0,
    lessonsByKind: {},
    apiCalls: 0,
    cacheHits: 0,
    validationAttempts: 0,
    validationFailures: 0,
    demotedExercises: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    model: currentModel,
  };

  const pushStats = () => {
    stats.elapsedMs = Date.now() - stats.startedAt;
    stats.estimatedCostUsd = costFor(stats.model, stats.inputTokens, stats.outputTokens);
    onStats?.({ ...stats, lessonsByKind: { ...stats.lessonsByKind } });
  };

  // Local helpers that know about the abort signal + event sink.
  const emit = (e: Omit<IngestEvent, "timestamp">) => {
    onEvent?.({ ...e, timestamp: Date.now() });
  };
  const checkAbort = () => {
    if (signal?.aborted) throw new IngestAborted();
  };

  /// Raw Tauri invoke wrapper with cancel checkpoint + event logging. Use for
  /// non-LLM commands (extract_pdf_text, cache_*). LLM commands use `callLlm`.
  const timedInvoke = async <T,>(
    cmd: string,
    args: Record<string, unknown>,
    label: string,
    ctx: { stage: IngestEvent["stage"]; chapter?: number; lesson?: string },
  ): Promise<T> => {
    checkAbort();
    emit({ level: "info", ...ctx, message: `start: ${label}` });
    const t0 = Date.now();
    const result = await invoke<T>(cmd, args);
    emit({
      level: "info",
      ...ctx,
      message: `done: ${label} (${Date.now() - t0}ms)`,
    });
    checkAbort();
    return result;
  };

  /// Invoke an LLM command and accumulate its token usage into `stats`.
  const callLlm = async (
    cmd: string,
    args: Record<string, unknown>,
    label: string,
    ctx: { stage: IngestEvent["stage"]; chapter?: number; lesson?: string },
  ): Promise<string> => {
    checkAbort();
    emit({ level: "info", ...ctx, message: `start: ${label}` });
    const resp = await invoke<LlmResponseTS>(cmd, args);
    stats.apiCalls += 1;
    stats.inputTokens += resp.input_tokens;
    stats.outputTokens += resp.output_tokens;
    emit({
      level: "info",
      ...ctx,
      message: `done: ${label} (${resp.elapsed_ms}ms · ${resp.input_tokens} in / ${resp.output_tokens} out)`,
    });
    pushStats();
    checkAbort();
    return resp.text;
  };

  emit({ level: "info", stage: "meta", message: `book=${bookId} lang=${language} model=${currentModel}` });
  pushStats();

  // ---- Stage 0: extract raw text -----------------------------------------
  // PDF extraction is a single blocking subprocess call from Rust — we can't
  // stream progress from pdftotext, so we bookend it with events so the user
  // sees scale going in ("reading 142 MB PDF") and a sanity check coming out
  // ("extracted 2.1M chars in 34s") instead of a long silence.
  onProgress("Reading PDF…", pdfPath);
  emit({
    level: "info",
    stage: "extract",
    message: `source: ${pdfPath}`,
  });
  let rawText = await cacheRead(bookId, "raw.txt");
  if (rawText) {
    emit({
      level: "cache",
      stage: "extract",
      message: `hit — reusing extracted text (${formatBytes(rawText.length)})`,
    });
    stats.cacheHits += 1;
    pushStats();
  } else {
    // Report the source size up front so the user knows roughly how long
    // to expect. Defensive — if stat_file fails or isn't registered yet
    // we just skip the size line rather than failing the whole run.
    const isEpub = /\.epub$/i.test(pdfPath);
    const tool = isEpub ? "epub" : "pdftotext";
    try {
      const info = await invoke<{ bytes: number }>("stat_file", { path: pdfPath });
      emit({
        level: "info",
        stage: "extract",
        message: `${isEpub ? "EPUB" : "PDF"} size: ${formatBytes(info.bytes)} · running ${tool}…`,
      });
      onProgress(
        `Reading ${isEpub ? "EPUB" : "PDF"}…`,
        `${formatBytes(info.bytes)} · extracting text`,
      );
    } catch {
      emit({ level: "info", stage: "extract", message: `running ${tool}…` });
    }
    const extractStart = Date.now();
    const res = await timedInvoke<{ text: string; error: string | null }>(
      "extract_source_text",
      { path: pdfPath },
      tool,
      { stage: "extract" },
    );
    if (res.error) throw new Error(res.error);
    rawText = res.text;
    const extractSecs = Math.round((Date.now() - extractStart) / 1000);
    emit({
      level: "info",
      stage: "extract",
      message: `extracted ${formatBytes(rawText.length)} in ${extractSecs}s`,
    });
    await cacheWrite(bookId, "raw.txt", rawText);
  }

  // ---- Stage 0.5: extract images (poppler pdfimages) -------------------
  // PDF-only — EPUBs already reference their images relatively from the
  // XHTML spine items, so a separate image-dump pass would just duplicate
  // bytes we already have in the book file. Skip cleanly for epub sources.
  // Non-fatal — if pdfimages is missing or the PDF has no embedded images,
  // we just skip. Authors can still reference figure placeholders in the
  // cleaned markdown and re-run with poppler installed later.
  if (/\.epub$/i.test(pdfPath)) {
    emit({
      level: "info",
      stage: "extract",
      message: "skipping pdfimages — source is EPUB",
    });
  } else try {
    const res = await invoke<{
      images: string[];
      dir: string;
      error: string | null;
    }>("extract_pdf_images", {
      path: pdfPath,
      bookId,
    });
    if (res.error) {
      emit({
        level: "warn",
        stage: "extract",
        message: `image extraction skipped: ${res.error}`,
      });
    } else {
      emit({
        level: "info",
        stage: "extract",
        message: `extracted ${res.images.length} image${res.images.length === 1 ? "" : "s"} to ${res.dir}`,
      });
    }
  } catch (e) {
    emit({
      level: "warn",
      stage: "extract",
      message: `image extraction threw: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // ---- Stage 1: split into raw chapters, then clean each with Claude ----
  onProgress("Detecting chapters…");
  emit({ level: "info", stage: "meta", message: "splitting raw text by chapter headings" });
  const rawChapters = splitChaptersIntoRaw(rawText);
  if (rawChapters.length === 0) throw new Error("No chapters detected in PDF.");
  emit({
    level: "info",
    stage: "meta",
    message: `detected ${rawChapters.length} chapter(s): ${rawChapters
      .map((c, i) => `${i + 1}. "${c.title}" (${formatBytes(c.body.length)})`)
      .join(" · ")}`,
  });
  onProgress(`Found ${rawChapters.length} chapter(s).`);
  stats.totalChapters = rawChapters.length;
  pushStats();

  const cleaned: Array<{ title: string; markdown: string }> = [];
  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i];
    const cacheKey = `clean/chapter-${pad(i + 1)}.md`;
    onProgress(
      `Cleaning + fencing code: chapter ${i + 1}/${rawChapters.length}`,
      ch.title,
    );
    let md = await cacheRead(bookId, cacheKey);
    if (md) {
      emit({
        level: "cache",
        stage: "clean",
        chapter: i + 1,
        message: `hit — skip clean for "${ch.title}"`,
      });
      stats.cacheHits += 1;
      pushStats();
    } else {
      // Anthropic caps input at 200K tokens (~800K chars). For big books a
      // single chapter can blow past that. Split into chunks at safe
      // boundaries (page breaks first, then section / paragraph breaks) so
      // each clean_code call stays well under the ceiling with room for
      // system prompt and output. We cache each chunk individually so a
      // re-run doesn't redo finished chunks.
      const chunks = splitForCleaning(ch.body, MAX_CLEAN_CHARS);
      if (chunks.length === 1) {
        md = await cleanChunkWithFallback(ch.body, ch.title, i + 1);
      } else {
        emit({
          level: "info",
          stage: "clean",
          chapter: i + 1,
          message: `chapter too large for one call — splitting into ${chunks.length} chunks`,
        });
        const parts: string[] = [];
        for (let pi = 0; pi < chunks.length; pi++) {
          const partKey = `clean/chapter-${pad(i + 1)}-part-${pad(pi + 1)}.md`;
          let partMd = await cacheRead(bookId, partKey);
          if (partMd) {
            emit({
              level: "cache",
              stage: "clean",
              chapter: i + 1,
              message: `hit — skip part ${pi + 1}/${chunks.length}`,
            });
            stats.cacheHits += 1;
            pushStats();
          } else {
            onProgress(
              `Cleaning chapter ${i + 1}/${rawChapters.length} (part ${pi + 1}/${chunks.length})`,
              ch.title,
            );
            partMd = await cleanChunkWithFallback(
              chunks[pi],
              ch.title,
              i + 1,
              `${pi + 1}/${chunks.length}`,
            );
            await cacheWrite(bookId, partKey, partMd);
          }
          parts.push(partMd);
        }
        // Concatenate with double-newline so adjacent chunks don't run
        // together mid-paragraph. If the LLM repeated the chapter heading
        // at the top of each part, that's harmless — outline/generate
        // stages don't rely on a single top-level heading.
        md = parts.join("\n\n");
      }
      await cacheWrite(bookId, cacheKey, md);
    }
    cleaned.push({ title: ch.title, markdown: md });
  }

  /// Call clean_code for one chunk. On Anthropic content-filter block, fall
  /// back to the raw PDF text — we lose the Claude-driven cleanup for that
  /// section (code fences might be missing, headings might be noisier) but
  /// downstream stages still have material to outline + generate from
  /// rather than aborting the whole ingest.
  async function cleanChunkWithFallback(
    text: string,
    title: string,
    chapterIdx: number,
    partLabel?: string,
  ): Promise<string> {
    const label = partLabel
      ? `clean_code ${title} [${partLabel}]`
      : `clean_code ${title}`;
    try {
      return await callLlm(
        "clean_code",
        { chapterTitle: title, rawText: text },
        label,
        { stage: "clean", chapter: chapterIdx },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("CONTENT_FILTERED")) throw e;
      emit({
        level: "warn",
        stage: "clean",
        chapter: chapterIdx,
        message: `content filter blocked clean_code${
          partLabel ? ` [${partLabel}]` : ""
        } — using raw text as-is`,
      });
      // Prepend a placeholder heading so the outline stage has something to
      // anchor to, then dump the raw text. Not ideal but keeps the pipeline
      // flowing.
      return `# ${title}${partLabel ? ` (part ${partLabel})` : ""}\n\n${text}`;
    }
  }

  // ---- Stage 2: outline each chapter ------------------------------------
  const outlines: Array<{ title: string; stubs: LessonStub[] }> = [];
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const cacheKey = `outlines/chapter-${pad(i + 1)}.json`;
    onProgress(
      `Outlining lessons: chapter ${i + 1}/${cleaned.length}`,
      ch.title,
    );
    let raw = await cacheRead(bookId, cacheKey);
    if (raw) {
      emit({
        level: "cache",
        stage: "outline",
        chapter: i + 1,
        message: `hit — skip outline for "${ch.title}"`,
      });
      stats.cacheHits += 1;
      pushStats();
    } else {
      try {
        // Guard against over-long chapters busting the 200K input token
        // ceiling. Cleaned markdown from a multi-chunk chapter can exceed
        // the cap even after clean_code chunking.
        const { text: referenceMd, truncated } = fitReference(ch.markdown);
        if (truncated) {
          emit({
            level: "warn",
            stage: "outline",
            chapter: i + 1,
            message: `chapter markdown ${Math.round(ch.markdown.length / 1000)}KB exceeds ${Math.round(MAX_REFERENCE_CHARS / 1000)}KB input cap — truncating reference for outline`,
          });
        }
        raw = await callLlm(
          "outline_chapter",
          {
            chapterTitle: ch.title,
            cleanedMarkdown: referenceMd,
            language,
          },
          `outline_chapter ${ch.title}`,
          { stage: "outline", chapter: i + 1 },
        );
        await cacheWrite(bookId, cacheKey, raw);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("CONTENT_FILTERED")) throw e;
        // Content-filter block on the outline. Synthesize a minimal outline
        // so the chapter still becomes SOMETHING rather than dropping the
        // whole thing. One reading lesson with the cleaned markdown as body
        // — the learner gets the raw material; they can request
        // regeneration later if we build that feature.
        emit({
          level: "warn",
          stage: "outline",
          chapter: i + 1,
          message: `content filter blocked outline for "${ch.title}" — substituting single reading stub`,
        });
        const fallbackStubs = [
          {
            id: slug(ch.title),
            kind: "reading" as const,
            title: ch.title,
            intent: `Full chapter content (outline synthesis was blocked by the content filter).`,
          },
        ];
        raw = JSON.stringify(fallbackStubs);
        // Don't cache — a re-run should retry the LLM outline with whatever
        // the user switches to (different model, cleared cache, etc.)
      }
    }
    const stubs = parseJson<LessonStub[]>(raw, `outline of ${ch.title}`);
    emit({
      level: "info",
      stage: "outline",
      chapter: i + 1,
      message: `planned ${stubs.length} lessons (${stubs.map((s) => s.kind).join(", ")})`,
    });
    outlines.push({ title: ch.title, stubs });
    stats.lessonsTotal += stubs.length;
    pushStats();
  }

  // ---- Stage 3: generate each lesson, Stage 4 validate exercises ---------
  const chapters: Course["chapters"] = [];
  for (let ci = 0; ci < outlines.length; ci++) {
    const ch = outlines[ci];
    const lessons: Lesson[] = [];

    // Section-scoped progressive exercises: remember the most recent solution
    // from this chapter so the next exercise's starter can be the previous
    // solution if the LLM wants progression. Reset at chapter boundaries.
    let priorSolution: string | undefined;

    for (let li = 0; li < ch.stubs.length; li++) {
      const stub = ch.stubs[li];
      const cacheKey = `lessons/chapter-${pad(ci + 1)}/${slug(stub.id)}.json`;
      onProgress(
        `Generating lesson ${li + 1}/${ch.stubs.length} of chapter ${ci + 1}`,
        `${stub.title} (${stub.kind})`,
      );

      // Try cache first. If the cached value no longer parses (e.g. truncated
      // from a previous run before MAX_TOKENS was raised), invalidate and
      // re-request.
      const cached = await cacheRead(bookId, cacheKey);
      let lesson: Lesson;
      let skippedByFilter = false;
      if (cached) {
        try {
          lesson = parseJson<Lesson>(cached, `lesson ${stub.id} (cached)`);
          emit({
            level: "cache",
            stage: "generate",
            chapter: ci + 1,
            lesson: stub.id,
            message: `hit — skip generate for "${stub.title}"`,
          });
          stats.cacheHits += 1;
          pushStats();
        } catch {
          lesson = await regenerateOrPlaceholder();
        }
      } else {
        lesson = await regenerateOrPlaceholder();
      }

      async function regenerateOrPlaceholder(): Promise<Lesson> {
        try {
          return await regenerateLesson();
        } catch (e) {
          // Anthropic content-filter block. Skip this one lesson rather
          // than aborting the whole ingest: emit a loud warning, substitute
          // a placeholder reading with a pointer to the source section, and
          // let the pipeline continue. The cache stays empty for this
          // stub so a re-run can retry (maybe after adjusting the stub
          // intent, or switching models).
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("CONTENT_FILTERED")) {
            skippedByFilter = true;
            emit({
              level: "warn",
              stage: "generate",
              chapter: ci + 1,
              lesson: stub.id,
              message: `content filter blocked "${stub.title}" — substituting placeholder reading`,
            });
            return buildFilteredPlaceholder(stub, ch.title);
          }
          throw e;
        }
      }

      async function regenerateLesson(): Promise<Lesson> {
        const { text: referenceMd } = fitReference(cleaned[ci].markdown);

        // Claude occasionally returns JSON with an unescaped control char,
        // an un-closed string mid-code-sample, or (when hitting the output
        // cap) a truncated response. Re-rolling usually fixes it — the
        // model's output isn't fully deterministic. We retry up to 2 extra
        // times on parse failure before giving up and substituting a
        // placeholder (same fallback CONTENT_FILTERED uses).
        const JSON_RETRIES = 2;
        let lastRaw = "";
        let lastError: unknown = null;
        for (let attempt = 0; attempt <= JSON_RETRIES; attempt++) {
          const raw = await callLlm(
            "generate_lesson",
            {
              chapterTitle: ch.title,
              cleanedMarkdown: referenceMd,
              language,
              stub: JSON.stringify(stub),
              priorSolution: priorSolution ?? null,
            },
            `generate_lesson ${stub.id} (${stub.kind})${
              attempt > 0 ? ` retry ${attempt}` : ""
            }`,
            { stage: "generate", chapter: ci + 1, lesson: stub.id },
          );
          lastRaw = raw;
          try {
            const parsed = parseJson<Lesson>(raw, `lesson ${stub.id}`);
            await cacheWrite(bookId, cacheKey, raw);
            return parsed;
          } catch (e) {
            lastError = e;
            emit({
              level: "warn",
              stage: "generate",
              chapter: ci + 1,
              lesson: stub.id,
              message: `parse failed on attempt ${attempt + 1}/${JSON_RETRIES + 1}${
                attempt < JSON_RETRIES ? " — retrying" : ""
              }: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
            });
          }
        }

        // All retries exhausted — dump the last bad raw to the cache dir so
        // the user can inspect it (ingest-cache/<book>/debug/<lesson>.bad.txt)
        // and substitute a placeholder reading so the pipeline keeps going.
        try {
          await cacheWrite(bookId, `debug/${slug(stub.id)}.bad.txt`, lastRaw);
          emit({
            level: "error",
            stage: "generate",
            chapter: ci + 1,
            lesson: stub.id,
            message: `${JSON_RETRIES + 1} parse failures for "${stub.title}" — raw dumped to debug/${slug(stub.id)}.bad.txt, substituting placeholder`,
          });
        } catch {
          /* ignore dump failure */
        }
        skippedByFilter = true;
        void lastError;
        return buildFilteredPlaceholder(stub, ch.title);
      }

      // Stage 4: validate exercises — skip for the placeholder we made
      // when the content filter blocked generation, since it has no tests.
      if (!skippedByFilter && (lesson.kind === "exercise" || lesson.kind === "mixed")) {
        const validated = await validateExerciseWithRetry(
          lesson as ExerciseLesson,
          {
            bookId,
            chapterIndex: ci,
            stubId: stub.id,
            onProgress,
            emit,
            checkAbort,
            stats,
            pushStats,
            callLlm,
          },
        );
        lesson = validated;
        if (lesson.kind === "exercise") priorSolution = lesson.solution;
      }

      emit({
        level: "info",
        stage: "generate",
        chapter: ci + 1,
        lesson: stub.id,
        message: `done: lesson "${lesson.title}" (${lesson.kind})`,
      });
      lessons.push(lesson);
      stats.lessonsDone += 1;
      stats.lessonsByKind[lesson.kind] = (stats.lessonsByKind[lesson.kind] ?? 0) + 1;
      pushStats();

      // Per-lesson incremental save. The snapshot includes every completed
      // chapter + the current chapter's partial lessons so far, so a crash
      // mid-chapter still leaves the learner with everything up to the most
      // recent ✓ lesson. save_course is a full overwrite so repeat calls
      // are cheap; at ~50ms per write for a 100-lesson course, this is
      // negligible compared to the LLM latency of each generation call.
      //
      // Preserve author/description from any existing on-disk course so
      // manual edits (or a prior import that set author) don't get
      // overwritten by a later ingest whose options didn't re-specify them.
      const snapshotChapters = [
        ...chapters,
        { id: slug(ch.title), title: ch.title, lessons: [...lessons] },
      ];
      let existingAuthor: string | undefined;
      try {
        const existing = await invoke<{ author?: string }>("load_course", {
          courseId: bookId,
        });
        existingAuthor = existing?.author;
      } catch {
        /* first save — no existing course yet */
      }
      try {
        await invoke("save_course", {
          courseId: bookId,
          body: {
            id: bookId,
            title,
            author: author ?? existingAuthor,
            description: "Auto-generated by Fishbones' AI pipeline (in progress)",
            language,
            chapters: snapshotChapters,
          },
        });
        emit({
          level: "info",
          stage: "save",
          chapter: ci + 1,
          lesson: stub.id,
          message: `saved (${stats.lessonsDone}/${stats.lessonsTotal || "?"} lessons)`,
        });
      } catch (e) {
        emit({
          level: "warn",
          stage: "save",
          chapter: ci + 1,
          lesson: stub.id,
          message: `per-lesson save failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    chapters.push({ id: slug(ch.title), title: ch.title, lessons });
    stats.chaptersDone += 1;
    pushStats();

    // Incremental save: commit everything so far to disk after each chapter
    // completes. If a later chapter crashes the pipeline or the user quits,
    // the sidebar will at least show the chapters we finished. save_course
    // is idempotent so overwriting on each chapter is safe. We only emit
    // a `save` event at warn level on failure — success is expected and
    // noisy.
    try {
      await invoke("save_course", {
        courseId: bookId,
        body: {
          id: bookId,
          title,
          author,
          description: "Auto-generated by Fishbones' AI pipeline (in progress)",
          language,
          chapters,
        },
      });
      emit({
        level: "info",
        stage: "save",
        chapter: ci + 1,
        message: `checkpoint saved (${chapters.length}/${outlines.length} chapter${
          outlines.length === 1 ? "" : "s"
        })`,
      });
    } catch (e) {
      emit({
        level: "warn",
        stage: "save",
        chapter: ci + 1,
        message: `incremental save failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // ---- Assemble final course --------------------------------------------
  return {
    id: bookId,
    title,
    author,
    description: "Auto-generated by Fishbones' AI pipeline",
    language,
    chapters,
  };
}

// ---- Stage 4 helper --------------------------------------------------------

const MAX_RETRIES = 3;

async function validateExerciseWithRetry(
  lesson: ExerciseLesson,
  ctx: {
    bookId: string;
    chapterIndex: number;
    stubId: string;
    onProgress: PipelineOptions["onProgress"];
    emit: (e: Omit<IngestEvent, "timestamp">) => void;
    checkAbort: () => void;
    stats: PipelineStats;
    pushStats: () => void;
    callLlm: (
      cmd: string,
      args: Record<string, unknown>,
      label: string,
      ectx: { stage: IngestEvent["stage"]; chapter?: number; lesson?: string },
    ) => Promise<string>;
  },
): Promise<Lesson> {
  let current = lesson;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ctx.checkAbort();
    ctx.stats.validationAttempts += 1;
    ctx.pushStats();
    ctx.onProgress(
      `Validating exercise (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
      current.title,
    );

    const failure = await validateOnce(current);
    if (!failure) {
      ctx.emit({
        level: "info",
        stage: "validate",
        chapter: ctx.chapterIndex + 1,
        lesson: ctx.stubId,
        message: `done: validated "${current.title}"`,
      });
      return current;
    }

    ctx.stats.validationFailures += 1;
    ctx.pushStats();
    ctx.emit({
      level: "warn",
      stage: "validate",
      chapter: ctx.chapterIndex + 1,
      lesson: ctx.stubId,
      message: `fail attempt ${attempt + 1}: ${failure}`,
    });

    if (attempt === MAX_RETRIES) {
      ctx.onProgress(
        `warn: exercise couldn't be validated, demoting to reading`,
        current.title,
      );
      ctx.stats.demotedExercises += 1;
      ctx.pushStats();
      ctx.emit({
        level: "error",
        stage: "validate",
        chapter: ctx.chapterIndex + 1,
        lesson: ctx.stubId,
        message: `demoted to reading after ${MAX_RETRIES} failures`,
      });
      return demoteToReading(current, failure);
    }

    // Ask the LLM to fix it. Parse BEFORE caching so a truncated or malformed
    // retry doesn't become a permanent bad cache entry.
    const retryKey = `lessons/chapter-${pad(ctx.chapterIndex + 1)}/${slug(
      ctx.stubId,
    )}.retry-${attempt + 1}.json`;
    const rawFixed = await ctx.callLlm(
      "retry_exercise",
      {
        originalLesson: JSON.stringify(current),
        failureReason: failure,
      },
      `retry_exercise attempt ${attempt + 1}`,
      { stage: "retry", chapter: ctx.chapterIndex + 1, lesson: ctx.stubId },
    );
    current = parseJson<ExerciseLesson>(rawFixed, `${current.id} retry ${attempt + 1}`);
    await cacheWrite(ctx.bookId, retryKey, rawFixed);
  }

  return current;
}

/// Returns null if the exercise passes BOTH gates (solution passes every test,
/// starter fails at least one). Otherwise returns a human-readable reason.
async function validateOnce(lesson: ExerciseLesson): Promise<string | null> {
  // Non-JS/TS/Python exercises can't run in-browser for full validation yet.
  // Trust the LLM on those for now; Rust uses the Playground and Swift is
  // run-only. Validation is still a huge quality lift for the languages we
  // *can* run.
  const runnable =
    lesson.language === "javascript" ||
    lesson.language === "typescript" ||
    lesson.language === "python";
  if (!runnable) return null;

  // Gate 1: solution must pass every test.
  const solRes = await runCode(lesson.language, lesson.solution, lesson.tests);
  if (!isPassing(solRes)) {
    const failingTests = solRes.tests?.filter((t) => !t.passed) ?? [];
    const first = failingTests[0];
    const errText = solRes.error ? ` [runtime error] ${solRes.error}` : "";
    const testText = first
      ? ` [first failing test] "${first.name}": ${first.error ?? "(no message)"}`
      : "";
    return `Reference solution failed validation.${errText}${testText}`;
  }

  // Gate 2: starter must fail at least one test (otherwise the task is trivial).
  const startRes = await runCode(lesson.language, lesson.starter, lesson.tests);
  if (isPassing(startRes)) {
    return "Starter code already passes every test — there's nothing for the user to solve. Add TODOs to the starter.";
  }

  return null;
}

function demoteToReading(lesson: ExerciseLesson, reason: string): ReadingLesson {
  return {
    id: lesson.id,
    kind: "reading",
    title: lesson.title + " (demoted)",
    body:
      lesson.body +
      `\n\n---\n\n*(This exercise was demoted to a reading lesson after ${MAX_RETRIES} validation failures: ${reason})*` +
      "\n\n## Reference solution\n\n```" +
      lesson.language +
      "\n" +
      lesson.solution +
      "\n```",
  };
}

// ---- Helpers ---------------------------------------------------------------

interface LessonStub {
  id: string;
  kind: "reading" | "exercise" | "quiz" | "mixed";
  title: string;
  intent: string;
}

/// Max raw-text characters per clean_code call. Anthropic's 200K input-token
/// ceiling is ~800K chars of English, but clean_code also has to fit the
/// system prompt AND produce a cleaned markdown output (which can be nearly
/// as long as the input). Keeping each chunk at ~180K chars (~45K input
/// tokens) leaves comfortable headroom on both sides and keeps individual
/// calls fast enough to retry on 429s without losing much progress.
const MAX_CLEAN_CHARS = 180_000;

/// Max cleaned-markdown characters we'll feed to outline_chapter or
/// generate_lesson as reference context. A concatenated multi-chunk
/// chapter can otherwise approach the cleaning input size (~720K chars
/// for a 4-chunk chapter) which busts the 200K-token input ceiling once
/// the system prompt is added. Cap at ~500K chars (~125K tokens) so the
/// API request stays under 200K with room for the system prompt and
/// the response.
const MAX_REFERENCE_CHARS = 500_000;

/// Truncate markdown for use as reference context in downstream LLM calls.
/// Prefers cutting at a heading or blank-line boundary so sections aren't
/// chopped mid-sentence; falls back to a hard cut. Returns the original
/// string untouched when it already fits.
function fitReference(md: string): { text: string; truncated: boolean } {
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
function splitForCleaning(text: string, maxChars: number): string[] {
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

function splitChaptersIntoRaw(rawText: string): ChapterBlob[] {
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

function parseJson<T>(raw: string, context: string): T {
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "x";
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/// Substitute lesson used when Anthropic's content filter blocks generation.
/// Renders as a reading with a clear note about what happened so the
/// learner isn't staring at an unexplained gap in the course. Intentionally
/// NOT cached — leaving the cache slot empty means a future re-run can
/// retry (maybe with a different model, or after you tweak the stub).
function buildFilteredPlaceholder(
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
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function cacheRead(bookId: string, key: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("cache_read", { bookId, key });
    return v ?? null;
  } catch {
    return null;
  }
}

async function cacheWrite(bookId: string, key: string, contents: string): Promise<void> {
  try {
    await invoke("cache_write", { bookId, key, contents });
  } catch {
    /* ignore — cache is best-effort */
  }
}
