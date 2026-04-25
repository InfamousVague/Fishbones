import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  runPipeline,
  IngestAborted,
  type IngestEvent,
  type PipelineStats,
} from "../ingest/pipeline";
import {
  regenerateExercises,
  RegenAborted,
} from "../ingest/regenExercises";
import {
  generateChallengePack,
  ChallengePackAborted,
  type GenerateChallengePackOptions,
} from "../ingest/generateChallengePack";
import { enrichCourse, EnrichAborted } from "../ingest/enrichCourse";
import { retryLesson, RetryAborted } from "../ingest/retryLesson";
import {
  ingestDocsSite,
  DocsIngestAborted,
  type DocsIngestOptions,
} from "../ingest/ingestDocsSite";
import type { LanguageId } from "../data/types";

export type IngestStatus = "idle" | "running" | "success" | "error" | "aborted";

export interface IngestRunState {
  status: IngestStatus;
  bookId: string;
  title: string;
  stage: string;
  detail: string;
  events: IngestEvent[];
  stats: PipelineStats | null;
  error: string | null;
  /// Set on status transitions so the floating panel can decide whether to
  /// show the "view course" CTA, error message, etc.
  startedAt: number;
  finishedAt: number | null;
  /// Populated when `startBulk` drives a multi-book queue. Lets the
  /// FloatingIngestPanel render "Book 3 of 5" alongside the normal
  /// per-book stats. `null` for single-ingest runs.
  queue?: QueueState | null;
}

export interface QueueState {
  total: number;
  /// 0-based index of the currently-running book. `currentIndex === total`
  /// means the queue just finished.
  currentIndex: number;
  /// Cumulative counts across the queue so the panel can show something
  /// like "2 succeeded · 1 failed · 2 remaining" at a glance.
  succeeded: number;
  failed: number;
}

export interface StartIngestOpts {
  pdfPath: string;
  bookId: string;
  title: string;
  author?: string;
  language: LanguageId;
}

const INITIAL: IngestRunState = {
  status: "idle",
  bookId: "",
  title: "",
  stage: "",
  detail: "",
  events: [],
  stats: null,
  error: null,
  startedAt: 0,
  finishedAt: null,
};

/// Single-run ingest manager lifted to App.tsx level. Unlike the old
/// pipeline-inside-ImportDialog flow, this keeps running even after the
/// ImportDialog is dismissed — the FloatingIngestPanel reads this state
/// and renders the live progress. Per-lesson saves land as the pipeline
/// runs, so the sidebar fills in progressively.
///
/// We only support one run at a time; starting a new ingest while one is
/// already running returns the existing controller so the caller can wire
/// it up. In practice the UI only lets you start an import from one place
/// anyway.
export function useIngestRun(opts: {
  onCourseSaved?: () => void;
}) {
  const [run, setRun] = useState<IngestRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const lastEventAtRef = useRef<number>(0);

  const onCourseSaved = opts.onCourseSaved;

  const start = useCallback(
    async (args: StartIngestOpts) => {
      if (abortRef.current) {
        // Already running — ignore. UI should guard against this by
        // disabling the Import button while status === "running".
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        status: "running",
        bookId: args.bookId,
        title: args.title,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });

      try {
        await runPipeline({
          pdfPath: args.pdfPath,
          bookId: args.bookId,
          title: args.title,
          author: args.author,
          language: args.language,
          signal: controller.signal,
          onProgress: (stage, detail) => {
            setRun((r) => ({ ...r, stage, detail: detail ?? "" }));
          },
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              // Cap at 500 entries so long runs don't balloon memory.
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            // The pipeline saves per-lesson; when any "save" event lands,
            // nudge the caller to refresh its course list so the sidebar
            // gets new lessons in real time.
            if (ev.stage === "save" && ev.level === "info") {
              onCourseSaved?.();
            }
          },
          onStats: (stats) => {
            setRun((r) => ({ ...r, stats }));
          },
        });
        // Pipeline returns the final course, but per-lesson save already
        // committed it to disk — we just mark the run as successful.
        setRun((r) => ({
          ...r,
          status: "success",
          finishedAt: Date.now(),
        }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof IngestAborted) {
          setRun((r) => ({
            ...r,
            status: "aborted",
            finishedAt: Date.now(),
          }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          // Even on error, the per-lesson saves up to the crash point are
          // already on disk. Nudge the caller to show them.
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    // Also wake the in-flight Anthropic request so cancel is instant even
    // mid-LLM-call. Separate from the frontend AbortController — that only
    // affects the pipeline loop at checkpoints.
    invoke("cancel_ingest").catch(() => {
      /* not in Tauri or no in-flight — safe to ignore */
    });
  }, []);

  const dismiss = useCallback(() => {
    // Only dismissible from terminal states. Running runs must be cancelled
    // explicitly so the user doesn't accidentally lose their progress view
    // with a misclick.
    setRun((r) =>
      r.status === "running" ? r : INITIAL,
    );
  }, []);

  /// Start a targeted regeneration of just the exercise/mixed lessons of a
  /// course. Reuses the same state shape (and floating panel UI) as a full
  /// pipeline run — from the learner's POV it's another background job
  /// with progress events and stats.
  const startRegenExercises = useCallback(
    async (bookId: string, title: string) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        status: "running",
        bookId,
        title: `${title} — regenerating exercises`,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      try {
        await regenerateExercises({
          bookId,
          signal: controller.signal,
          onProgress: (stage, detail) =>
            setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            if (ev.stage === "save" && ev.level === "info") onCourseSaved?.();
          },
          onStats: (stats) => setRun((r) => ({ ...r, stats })),
        });
        setRun((r) => ({ ...r, status: "success", finishedAt: Date.now() }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof RegenAborted) {
          setRun((r) => ({ ...r, status: "aborted", finishedAt: Date.now() }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  /// Generate a brand-new challenge pack from scratch. Mirrors the
  /// regen + start entry points: same state shape, same floating panel,
  /// same cancel wiring. Takes the options the dialog collects — a
  /// language, a count, and an optional model override.
  const startGenerateChallengePack = useCallback(
    async (args: Pick<GenerateChallengePackOptions, "language" | "count" | "model">) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const title = `${args.language.replace(/^\w/, (c) => c.toUpperCase())} — Challenge Pack`;
      setRun({
        status: "running",
        bookId: "",
        title,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      try {
        const course = await generateChallengePack({
          language: args.language,
          count: args.count,
          model: args.model,
          signal: controller.signal,
          onProgress: (stage, detail) =>
            setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            if (ev.stage === "save" && ev.level === "info") onCourseSaved?.();
          },
          onStats: (stats) => setRun((r) => ({ ...r, stats })),
        });
        // `bookId` is populated once we know the pack's course id so the
        // "view course" CTA in the floating panel can open it directly.
        setRun((r) => ({
          ...r,
          bookId: course.id,
          status: "success",
          finishedAt: Date.now(),
        }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof ChallengePackAborted) {
          setRun((r) => ({ ...r, status: "aborted", finishedAt: Date.now() }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  /// Doc-site ingest. Crawls a documentation URL, groups pages into
  /// chapters by URL path, and generates a lesson per page via the
  /// `generate_lesson_from_docs_page` LLM call. Same IngestRunState
  /// shape as the PDF pipeline — FloatingIngestPanel renders it
  /// identically.
  const startDocsIngest = useCallback(
    async (
      args: Pick<
        DocsIngestOptions,
        | "bookId"
        | "title"
        | "language"
        | "startUrl"
        | "maxPages"
        | "maxDepth"
        | "requestDelayMs"
        | "embedImages"
        | "modelOverride"
      >,
    ) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        status: "running",
        bookId: args.bookId,
        title: args.title,
        stage: "Starting crawl…",
        detail: args.startUrl,
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      try {
        await ingestDocsSite({
          ...args,
          signal: controller.signal,
          onProgress: (stage, detail) =>
            setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            if (ev.stage === "save" && ev.level === "info") onCourseSaved?.();
          },
          onStats: (stats) => setRun((r) => ({ ...r, stats })),
        });
        setRun((r) => ({ ...r, status: "success", finishedAt: Date.now() }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof DocsIngestAborted) {
          setRun((r) => ({ ...r, status: "aborted", finishedAt: Date.now() }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  /// Enrichment pass for an existing course — populates `objectives` +
  /// `enrichment` on every non-quiz lesson. Lighter than regen: only the
  /// reading-aid fields change, the body/starter/solution/tests are
  /// untouched. Idempotent and resumable.
  const startEnrichCourse = useCallback(
    async (bookId: string, title: string) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        status: "running",
        bookId,
        title: `${title} — enriching lessons`,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      try {
        await enrichCourse({
          bookId,
          signal: controller.signal,
          onProgress: (stage, detail) =>
            setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            if (ev.stage === "save" && ev.level === "info") onCourseSaved?.();
          },
          onStats: (stats) => setRun((r) => ({ ...r, stats })),
        });
        setRun((r) => ({ ...r, status: "success", finishedAt: Date.now() }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof EnrichAborted) {
          setRun((r) => ({ ...r, status: "aborted", finishedAt: Date.now() }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  /// Bulk import — runs `start` on each item sequentially, one after the
  /// other, without resetting the "running" state between books. Designed
  /// for unattended overnight batches: set it up, go to bed, review the
  /// results in the morning.
  ///
  /// Failure handling: a single book's failure doesn't halt the queue.
  /// We log it to the event stream and move on to the next. The final
  /// status reflects whether the overall run completed ("success" even
  /// if some individual books failed), aborted, or hit a fatal error.
  ///
  /// Queue state surfaces via `run.queue` so FloatingIngestPanel can
  /// render "Book 3 of 5 · 2 succeeded · 0 failed" at a glance.
  const startBulk = useCallback(
    async (items: StartIngestOpts[]) => {
      if (abortRef.current) return;
      if (items.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;

      const total = items.length;
      setRun({
        status: "running",
        bookId: items[0].bookId,
        title: `${items[0].title} (1/${total})`,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
        queue: {
          total,
          currentIndex: 0,
          succeeded: 0,
          failed: 0,
        },
      });

      let succeeded = 0;
      let failed = 0;

      try {
        for (let i = 0; i < items.length; i++) {
          if (controller.signal.aborted) throw new IngestAborted();
          const item = items[i];
          // Reset per-book state. We keep the queue meta + status so the
          // panel stays in its "running" mode across the whole batch;
          // only the title / stage / events / stats swap to the new book.
          setRun((r) => ({
            ...r,
            bookId: item.bookId,
            title: `${item.title} (${i + 1}/${total})`,
            stage: "Starting…",
            detail: "",
            events: [
              {
                timestamp: Date.now(),
                level: "info",
                stage: "meta",
                message: `▶ ${item.title}`,
              },
            ],
            stats: null,
            error: null,
            queue: {
              total,
              currentIndex: i,
              succeeded,
              failed,
            },
          }));

          try {
            await runPipeline({
              pdfPath: item.pdfPath,
              bookId: item.bookId,
              title: item.title,
              author: item.author,
              language: item.language,
              signal: controller.signal,
              onProgress: (stage, detail) =>
                setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
              onEvent: (ev) => {
                lastEventAtRef.current = ev.timestamp;
                setRun((r) => {
                  const next =
                    r.events.length >= 500
                      ? r.events.slice(-499)
                      : r.events.slice();
                  next.push(ev);
                  return { ...r, events: next };
                });
                if (ev.stage === "save" && ev.level === "info") {
                  onCourseSaved?.();
                }
              },
              onStats: (stats) => setRun((r) => ({ ...r, stats })),
            });
            succeeded++;
            onCourseSaved?.();
          } catch (e) {
            if (e instanceof IngestAborted) throw e;
            failed++;
            const msg = e instanceof Error ? e.message : String(e);
            // Log but continue — the whole point of the queue is unattended.
            setRun((r) => {
              const next =
                r.events.length >= 500
                  ? r.events.slice(-499)
                  : r.events.slice();
              next.push({
                timestamp: Date.now(),
                level: "error",
                stage: "meta",
                message: `fail: ${item.title} — ${msg.slice(0, 200)}`,
              });
              return { ...r, events: next };
            });
            onCourseSaved?.();
          }
        }
        // Queue drained cleanly.
        setRun((r) => ({
          ...r,
          status: "success",
          finishedAt: Date.now(),
          title: `Bulk import complete · ${succeeded} succeeded${failed > 0 ? ` · ${failed} failed` : ""}`,
          queue: { total, currentIndex: total, succeeded, failed },
        }));
      } catch (e) {
        if (e instanceof IngestAborted) {
          setRun((r) => ({
            ...r,
            status: "aborted",
            finishedAt: Date.now(),
            queue: { total, currentIndex: r.queue?.currentIndex ?? 0, succeeded, failed },
          }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
            queue: { total, currentIndex: r.queue?.currentIndex ?? 0, succeeded, failed },
          }));
        }
        onCourseSaved?.();
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  /// Retry a single demoted lesson — drives the inline "Retry this
  /// exercise" button in the reader. Reuses the same `IngestRunState`
  /// shape so the FloatingIngestPanel shows progress, but the operation
  /// is scoped to one lesson (one LLM call, one save) rather than a
  /// whole chapter or course.
  const startRetryLesson = useCallback(
    async (bookId: string, lessonId: string, lessonTitle: string) => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRun({
        status: "running",
        bookId,
        title: `Retrying "${lessonTitle}"`,
        stage: "Starting…",
        detail: "",
        events: [],
        stats: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      });
      try {
        await retryLesson({
          bookId,
          lessonId,
          signal: controller.signal,
          onProgress: (stage, detail) =>
            setRun((r) => ({ ...r, stage, detail: detail ?? "" })),
          onEvent: (ev) => {
            lastEventAtRef.current = ev.timestamp;
            setRun((r) => {
              const next =
                r.events.length >= 500 ? r.events.slice(-499) : r.events.slice();
              next.push(ev);
              return { ...r, events: next };
            });
            if (ev.stage === "save" && ev.level === "info") onCourseSaved?.();
          },
          onStats: (stats) => setRun((r) => ({ ...r, stats })),
        });
        setRun((r) => ({ ...r, status: "success", finishedAt: Date.now() }));
        onCourseSaved?.();
      } catch (e) {
        if (e instanceof RetryAborted) {
          setRun((r) => ({ ...r, status: "aborted", finishedAt: Date.now() }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setRun((r) => ({
            ...r,
            status: "error",
            error: msg,
            finishedAt: Date.now(),
          }));
          onCourseSaved?.();
        }
      } finally {
        abortRef.current = null;
      }
    },
    [onCourseSaved],
  );

  return {
    run,
    start,
    startBulk,
    startRegenExercises,
    startGenerateChallengePack,
    startDocsIngest,
    startEnrichCourse,
    startRetryLesson,
    cancel,
    dismiss,
    lastEventAtRef,
  };
}
