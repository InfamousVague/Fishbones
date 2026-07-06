import { useState } from "react";
import type { PipelineStats } from "@/ingest/pipeline";
import { useInterval } from "@/hooks/useInterval";
import { useT, type TFunction } from "@/i18n/i18n";
import "./StatsBar.css";

interface Props {
  stats: PipelineStats | null;
}

/// Compact dashboard above the running progress row. Five cells: elapsed,
/// chapters, lessons (by kind), tokens, cost. Null-stats render a dim
/// skeleton so the layout doesn't jump once the first event lands.
export default function StatsBar({ stats }: Props) {
  const t = useT();
  // Elapsed is derived from stats.startedAt and needs to tick independently
  // of pipeline events — Opus can happily think for 60s without firing
  // anything, and a frozen clock reads as a hung app. A 500ms interval
  // keeps the elapsed cell moving while the rest of the numbers wait on
  // the next API return.
  const [, force] = useState(0);
  useInterval(() => force((n) => n + 1), stats ? 500 : null);

  const elapsedMs = stats ? Date.now() - stats.startedAt : 0;
  const tokens = stats ? stats.inputTokens + stats.outputTokens : 0;

  return (
    <div className="libre-stats">
      <Cell
        label={t("import.statElapsed")}
        value={stats ? formatElapsed(elapsedMs) : "–"}
      />
      <Cell
        label={t("import.statChapters")}
        value={stats ? `${stats.chaptersDone}/${stats.totalChapters || "?"}` : "–"}
      />
      <Cell
        label={t("import.statLessons")}
        value={stats ? `${stats.lessonsDone}/${stats.lessonsTotal || "?"}` : "–"}
        hint={stats ? formatKinds(t, stats.lessonsByKind) : undefined}
      />
      <Cell
        label={t("import.statTokens")}
        value={stats ? `${formatCount(tokens)}` : "–"}
        hint={
          stats
            ? t("import.statInOut", {
                in: formatCount(stats.inputTokens),
                out: formatCount(stats.outputTokens),
              })
            : undefined
        }
      />
      <Cell
        label={t("import.statCost", {
          model: stats?.model.replace("claude-", "") ?? "",
        })}
        value={stats ? `$${stats.estimatedCostUsd.toFixed(3)}` : "–"}
        hint={stats && (stats.apiCalls > 0 || stats.cacheHits > 0)
          ? t(
              stats.apiCalls === 1
                ? "import.statCalls"
                : "import.statCallsPlural",
              { count: stats.apiCalls, cached: stats.cacheHits },
            )
          : undefined}
      />
      {stats && (stats.validationAttempts > 0 || stats.demotedExercises > 0) && (
        <Cell
          label={t("import.statValidate")}
          value={`${stats.validationAttempts - stats.validationFailures}/${stats.validationAttempts}`}
          hint={
            stats.demotedExercises > 0
              ? t("import.statDemoted", { count: stats.demotedExercises })
              : undefined
          }
          tone={stats.demotedExercises > 0 ? "warn" : "normal"}
        />
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "normal" | "warn";
}) {
  return (
    <div className={`libre-stats-cell libre-stats-cell--${tone}`}>
      <div className="libre-stats-label">{label}</div>
      <div className="libre-stats-value">{value}</div>
      {hint && <div className="libre-stats-hint">{hint}</div>}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/// Takes `t` as an argument (module-scope helper, no hooks here) so
/// the per-kind labels localize with the rest of the bar.
function formatKinds(t: TFunction, kinds: Record<string, number>): string {
  const order = ["reading", "exercise", "mixed", "quiz"];
  const keys: Record<string, string> = {
    reading: "import.statKindReading",
    exercise: "import.statKindExercise",
    mixed: "import.statKindMixed",
    quiz: "import.statKindQuiz",
  };
  return order
    .filter((k) => kinds[k])
    .map((k) => t(keys[k], { count: kinds[k] }))
    .join(" · ") || "";
}
