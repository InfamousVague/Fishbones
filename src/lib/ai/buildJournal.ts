/// Build Journal — turns a finished agent build into a worked
/// example with a learning path.
///
/// The novel idea: when the AI builds a project WITH the learner,
/// the build shouldn't vanish into a folder of files. It should
/// become a navigable artifact that explains itself — what each
/// file is for, which programming CONCEPTS the build uses, and
/// exactly which lessons in the learner's installed courses teach
/// each concept (with "new to you" ones flagged). That's the
/// "explain how the project is built + guide them through courses"
/// half of the brief, made deterministic so it ALWAYS appears even
/// when a small local model is too terse to narrate well.
///
/// Pure module: the host (the agent panel) loads the project's
/// files from disk and feeds their contents in; this module does
/// the concept detection + coverage analysis + per-file role
/// inference. The model's own prose narration renders alongside —
/// but the journal's spine is computed, not generated.

import type { Course } from "../../data/types";
import type { ToolResult } from "../aiTools/types";
import { analyzeBuildState, type BuildStage } from "./buildState";
import {
  analyzeConceptCoverage,
  conceptLangFor,
  detectConceptsInCode,
  type Concept,
  type ConceptWithLessons,
} from "./concepts";

export interface JournalFile {
  path: string;
  language: string;
  /// Heuristic one-line role ("Entry point", "Component",
  /// "Logic module", "Styles", "Config").
  purpose: string;
  /// Concepts detected in this specific file.
  concepts: Concept[];
}

export interface BuildJournal {
  stage: BuildStage;
  projectId: string | null;
  /// Per-file breakdown, ordered by a sensible reading order
  /// (entry points first, styles/config last).
  files: JournalFile[];
  /// Every concept the build uses, paired with teaching lessons +
  /// a learned/not-learned flag. Unlearned + harder concepts lead.
  concepts: ConceptWithLessons[];
  /// The subset of `concepts` the learner likely hasn't learned —
  /// the "here's what's new, want to go deeper?" list.
  newToYou: ConceptWithLessons[];
  /// True when there's anything worth showing (files + concepts).
  hasContent: boolean;
}

export interface JournalInput {
  /// The project's files (loaded from disk by the host).
  files: ReadonlyArray<{ path: string; content: string; language: string }>;
  /// The run's tool timeline — drives the build stage.
  timeline: readonly ToolResult[];
  courses: readonly Course[];
  completed: ReadonlySet<string>;
  /// The course the learner is currently studying — biases lesson
  /// links toward it on near-ties.
  currentCourseId?: string;
  /// Project language fallback when a file's own language is
  /// missing/ambiguous (e.g. the create call's language).
  projectLanguage?: string;
}

/// Assemble the journal. Pure + cheap — safe to recompute on
/// render whenever the timeline / files change.
export function buildBuildJournal(input: JournalInput): BuildJournal {
  const state = analyzeBuildState(input.timeline);

  // Per-file concept detection + role inference.
  const journalFiles: JournalFile[] = input.files
    .filter((f) => f.content && f.content.trim().length > 0)
    .map((f) => {
      const language = effectiveLanguage(f, input.projectLanguage);
      const hits = detectConceptsInCode(f.content, language);
      return {
        path: f.path,
        language,
        purpose: inferPurpose(f.path, language),
        concepts: dedupeConcepts(hits.map((h) => h.concept)),
      };
    })
    .sort((a, b) => readingRank(a.path) - readingRank(b.path));

  // Union of concepts across the whole build (dedup by id).
  const unionConcepts = dedupeConcepts(
    journalFiles.flatMap((f) => f.concepts),
  );

  const coverage = analyzeConceptCoverage(
    unionConcepts,
    input.courses,
    input.completed,
    input.currentCourseId,
  );
  const newToYou = coverage.filter((c) => !c.learned);

  return {
    stage: state.stage,
    projectId: state.projectId,
    files: journalFiles,
    concepts: coverage,
    newToYou,
    hasContent: journalFiles.length > 0 && unionConcepts.length > 0,
  };
}

// ── helpers ─────────────────────────────────────────────────

function effectiveLanguage(
  f: { path: string; language: string },
  projectLanguage?: string,
): string {
  if (f.language && conceptLangFor(f.language)) return f.language;
  const byExt = languageFromPath(f.path);
  if (byExt) return byExt;
  return projectLanguage ?? f.language ?? "";
}

function languageFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs"))
    return "javascript";
  return null;
}

/// One-line role from filename conventions. Conservative — falls
/// back to a neutral "Source file" so we never assert a wrong
/// purpose.
function inferPurpose(path: string, language: string): string {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  if (/\.(css|scss|sass)$/.test(base)) return "Styles";
  if (base === "index.html" || base.endsWith(".html")) return "Page shell";
  if (/(package\.json|cargo\.toml|tsconfig|vite\.config|\.toml|\.yaml|\.yml)$/.test(base))
    return "Config";
  if (/(^|[/.])(main|index|app|mod)\.(rs|py|js|jsx|ts|tsx)$/.test(lower) || base.startsWith("main.") || base.startsWith("app."))
    return "Entry point";
  if (lower.includes("/components/") || /^[A-Z]\w*\.(jsx|tsx)$/.test(path.split("/").pop() ?? ""))
    return "Component";
  // src/ lib/ utils/ as a path segment — match at the start
  // (`src/counter.rs`) or mid-path (`crate/src/counter.rs`).
  if (/(^|\/)(src|lib|utils)\//.test(lower)) return "Logic module";
  if (/test|spec/.test(base)) return "Tests";
  return language ? `${capitalize(language)} source` : "Source file";
}

/// Reading order: entry points first, then components/logic, then
/// styles + config last (you read what runs first, chrome last).
function readingRank(path: string): number {
  const purpose = inferPurpose(path, "");
  switch (purpose) {
    case "Entry point":
      return 0;
    case "Page shell":
      return 1;
    case "Component":
      return 2;
    case "Logic module":
      return 3;
    case "Tests":
      return 4;
    case "Styles":
      return 5;
    case "Config":
      return 6;
    default:
      return 3;
  }
}

function dedupeConcepts(concepts: readonly Concept[]): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const c of concepts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
