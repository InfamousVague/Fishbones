/// React-side bridge for the file-streaming pipeline.
///
/// The pure planner in `lib/aiAgent/fileStream.ts` owns the
/// fenced-block parsing + diff logic. This hook wires it up to:
///   - The `libre:sandbox-focus` event (gives us the active
///     project + currently-focused file path)
///   - The streaming content from the agent (passed as the
///     `streamingContent` prop)
///   - The Tauri `sandbox_load_project` / `sandbox_save_project`
///     commands (so the writes hit disk)
///   - The `libre:agent-file-write` event (so the agent panel's
///     per-file chip UI can render progress)
///
/// On every streamingContent change we ask the planner what writes
/// are needed, flush them in a single project-load + project-save
/// roundtrip, then fire focus + file-write events for the host UI.

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_PLANNER_STATE,
  planStreamWrites,
  type PlannedWrite,
  type StreamPlannerState,
} from "../../lib/aiAgent/fileStream";

interface SandboxProject {
  id: string;
  name: string;
  language: string;
  files: Array<{ name: string; content: string; language: string }>;
}

export function useSandboxStreamWriter(
  streamingContent: string,
  /// Only stream-write for TOOL-NATIVE models. An emulated model
  /// (no native tool calls) streams its tool-call JSON as TEXT, which
  /// the fence parser would mis-read as `lang:path` file blocks and
  /// spray junk files. Builds on emulated models are blocked upstream;
  /// this flag is the hard gate so the planner never sees that text.
  enabled = true,
): void {
  // Single mutable state object that the planner threads through
  // each tick. We use a ref (not state) because the writes are
  // side-effects on disk — there's no need to trigger a React
  // re-render when the projectId or last-content cache changes,
  // and a ref keeps the planner's idempotence accurate across
  // rapid streaming-content updates (state would batch).
  const stateRef = useRef<StreamPlannerState>({
    ...EMPTY_PLANNER_STATE,
    lastContent: new Map(),
  });

  // Tracks the previous `enabled` value so we can detect a false→true
  // edge. The writer is latched to the model that STARTED the run, but
  // a fresh run (e.g. switch to a native model, then build) flips this
  // back on — at which point any text the planner accumulated while
  // disabled must be dropped, or we'd replay a stale diff against the
  // new run's first chunk and mis-write files.
  const prevEnabledRef = useRef(enabled);

  useEffect(() => {
    const onFocus = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId?: string; path?: string }>)
        .detail;
      if (detail?.projectId) stateRef.current.projectId = detail.projectId;
      if (detail?.path) stateRef.current.focusedPath = detail.path;
    };
    window.addEventListener("libre:sandbox-focus", onFocus);
    return () => window.removeEventListener("libre:sandbox-focus", onFocus);
  }, []);

  useEffect(() => {
    if (!enabled) {
      prevEnabledRef.current = false;
      return;
    }
    // Re-enabled (false→true): forget anything buffered while off so a
    // stale diff isn't replayed against the new run's first chunk.
    if (!prevEnabledRef.current) {
      stateRef.current = { ...EMPTY_PLANNER_STATE, lastContent: new Map() };
    }
    prevEnabledRef.current = true;
    const prior = stateRef.current;
    const { writes, state } = planStreamWrites(prior, streamingContent);
    stateRef.current = state;
    // If the planner adopted a sniffed projectId (prior was null,
    // state is non-null), echo a focus event so the rest of the
    // app (sandbox view, agent panel) picks it up. The event is
    // self-emitted; the hook's own listener captures the id but
    // we already wrote it, so no double-store.
    if (!prior.projectId && state.projectId) {
      window.dispatchEvent(
        new CustomEvent("libre:sandbox-focus", {
          detail: { projectId: state.projectId },
        }),
      );
    }
    if (writes.length === 0) return;
    void flushWrites(writes);
  }, [streamingContent, enabled]);
}

/// Apply a batch of planned writes. Loads the project once,
/// mutates the file list, saves once, then fires the
/// `libre:sandbox-refresh` + per-write `libre:agent-file-write`
/// events for the UI.
async function flushWrites(writes: PlannedWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const projectId = writes[0].projectId;
  let project: SandboxProject;
  try {
    project = (await invoke("sandbox_load_project", {
      id: projectId,
    })) as SandboxProject;
  } catch {
    return;
  }

  for (const w of writes) {
    const idx = project.files.findIndex((f) => f.name === w.path);
    if (idx < 0) {
      project.files.push({
        name: w.path,
        content: w.content,
        language: w.language,
      });
    } else {
      project.files[idx] = {
        ...project.files[idx],
        content: w.content,
        language: project.files[idx].language || w.language,
      };
    }
  }

  try {
    await invoke("sandbox_save_project", { project });
  } catch {
    return;
  }

  window.dispatchEvent(new CustomEvent("libre:sandbox-refresh"));
  // Focus the LAST file in the write batch — when the agent
  // streams content for multiple files in alternation, focus
  // hops would flicker between them every chunk. Notion issue
  // #9204dd042d84454b ("UI jitters and doesn't stream code to
  // files as expected, flickers between two screenshots…
  // should instead focus a file and start writing output
  // immediately"). Previously only `w.isNew` writes fired focus
  // — meaning UPDATES to an already-created file never pulled
  // the editor over, so the learner could be staring at a
  // stale file while new content streamed into a different
  // one. Always firing focus, on every batch, on the file
  // that's actively being written keeps the editor on the
  // freshest stream and eliminates the in-between flicker.
  const focusTarget = writes[writes.length - 1];
  if (focusTarget) {
    window.dispatchEvent(
      new CustomEvent("libre:sandbox-focus", {
        detail: { projectId: focusTarget.projectId, path: focusTarget.path },
      }),
    );
  }
  for (const w of writes) {
    window.dispatchEvent(
      new CustomEvent("libre:agent-file-write", {
        detail: {
          projectId: w.projectId,
          path: w.path,
          bytes: w.bytes,
          closed: w.closed,
          language: w.rawLang || w.language,
        },
      }),
    );
  }
}
