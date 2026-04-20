import { useEffect, useState } from "react";
import type { PipelineStats } from "../../ingest/pipeline";
import "./StatsBar.css";

interface Props {
  stats: PipelineStats | null;
}

/// Compact dashboard above the running progress row. Five cells: elapsed,
/// chapters, lessons (by kind), tokens, cost. Null-stats render a dim
/// skeleton so the layout doesn't jump once the first event lands.
export default function StatsBar({ stats }: Props) {
  // Elapsed is derived from stats.startedAt and needs to tick independently
  // of pipeline events — Opus can happily think for 60s without firing
  // anything, and a frozen clock reads as a hung app. A 500ms interval
  // keeps the elapsed cell moving while the rest of the numbers wait on
  // the next API return.
  const [, force] = useState(0);
  useEffect(() => {
    if (!stats) return;
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [stats?.startedAt]);

  const elapsedMs = stats ? Date.now() - stats.startedAt : 0;
  const tokens = stats ? stats.inputTokens + stats.outputTokens : 0;

  return (
    <div className="kata-stats">
      <Cell label="elapsed" value={stats ? formatElapsed(elapsedMs) : "–"} />
      <Cell
        label="chapters"
        value={stats ? `${stats.chaptersDone}/${stats.totalChapters || "?"}` : "–"}
      />
      <Cell
        label="lessons"
        value={stats ? `${stats.lessonsDone}/${stats.lessonsTotal || "?"}` : "–"}
        hint={stats ? formatKinds(stats.lessonsByKind) : undefined}
      />
      <Cell
        label="tokens"
        value={stats ? `${formatCount(tokens)}` : "–"}
        hint={
          stats
            ? `${formatCount(stats.inputTokens)} in · ${formatCount(stats.outputTokens)} out`
            : undefined
        }
      />
      <Cell
        label={`cost (${stats?.model.replace("claude-", "") ?? ""})`}
        value={stats ? `$${stats.estimatedCostUsd.toFixed(3)}` : "–"}
        hint={stats && (stats.apiCalls > 0 || stats.cacheHits > 0)
          ? `${stats.apiCalls} call${stats.apiCalls === 1 ? "" : "s"} · ${stats.cacheHits} cached`
          : undefined}
      />
      {stats && (stats.validationAttempts > 0 || stats.demotedExercises > 0) && (
        <Cell
          label="validate"
          value={`${stats.validationAttempts - stats.validationFailures}/${stats.validationAttempts}`}
          hint={stats.demotedExercises > 0 ? `${stats.demotedExercises} demoted` : undefined}
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
    <div className={`kata-stats-cell kata-stats-cell--${tone}`}>
      <div className="kata-stats-label">{label}</div>
      <div className="kata-stats-value">{value}</div>
      {hint && <div className="kata-stats-hint">{hint}</div>}
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

function formatKinds(kinds: Record<string, number>): string {
  const order = ["reading", "exercise", "mixed", "quiz"];
  return order
    .filter((k) => kinds[k])
    .map((k) => `${kinds[k]} ${k}`)
    .join(" · ") || "";
}
