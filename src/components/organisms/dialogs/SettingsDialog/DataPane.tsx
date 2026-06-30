/// Combined "Data & storage" pane — folds together what used to be
/// three separate panes (Data, Sync, Resources) into a single
/// surface organised by storage concern:
///
///   • Sync           — manual course-sync button + cloud-side
///                      progress diff (powered by SyncDebugPanel
///                      in embedded mode).
///   • Toolchains     — installed language toolchain probes
///                      (powered by DiagnosticsPanel in embedded
///                      mode).
///
/// Each subsystem ships its own internal complexity, so we
/// compose them as embeddable subcomponents inside this pane's
/// `SettingsPage` wrapper rather than re-implementing their
/// contents inline. The `embedded` prop on each tells them to
/// skip their own `SettingsPage` chrome — this pane provides the
/// single page-level header for all three.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";

import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";
import DiagnosticsPanel from "./DiagnosticsPanel";
import SyncDebugPanel from "./SyncDebugPanel";
import type { UseLibreCloud } from "@/hooks/useLibreCloud";
import type { RealtimeSyncHandle } from "@/hooks/useRealtimeSync";
import type { Completion } from "@/hooks/useProgress";
import type { Course } from "@/data/types";
import { useT } from "@/i18n/i18n";

interface Props {
  cloud: UseLibreCloud;
  realtime?: RealtimeSyncHandle;
  history?: readonly Completion[];
  courses?: readonly Course[];
}

export default function DataPane({
  cloud,
  realtime,
  history,
  courses,
}: Props) {
  const t = useT();
  // Sync-courses state — moved here from the inline JSX that used
  // to live in SettingsDialog under `section === "data"`. The Rust
  // `refresh_bundled_courses` command re-runs the seed routine in
  // force-refresh mode (see `src-tauri/src/courses.rs`). Note: on
  // the API-only build (no bundled-packs) this returns all zeros
  // and reads as "Already up to date" — that's the correct
  // behaviour now that bundled packs are retired.
  const [syncingCourses, setSyncingCourses] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function syncCourses() {
    setSyncingCourses(true);
    setSyncResult(null);
    try {
      const report = await invoke<{
        new: number;
        refreshed: number;
        skipped_deleted: number;
      }>("refresh_bundled_courses");
      const parts: string[] = [];
      if (report.new > 0) {
        parts.push(
          t(report.new === 1 ? "settings.syncNewCourses" : "settings.syncNewCoursesPlural", {
            count: report.new,
          }),
        );
      }
      if (report.refreshed > 0) {
        parts.push(t("settings.syncRefreshedCount", { count: report.refreshed }));
      }
      const message =
        parts.length > 0
          ? t("settings.syncedReport", { parts: parts.join(", ") })
          : t("settings.alreadyUpToDate");
      setSyncResult(message);
      // Auto-clear the message after a few seconds when nothing
      // changed; reload the window when something did.
      if (report.new > 0 || report.refreshed > 0) {
        setTimeout(() => window.location.reload(), 700);
      } else {
        setTimeout(() => setSyncResult(null), 4000);
      }
    } catch (e) {
      setSyncResult(
        t("settings.syncFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setSyncingCourses(false);
    }
  }

  return (
    <SettingsPage
      title={t("settings.dataAndStorage")}
      description={t("settings.dataDescription")}
    >
      <SettingsCard title={t("settings.syncCard")}>
        <SettingsRow
          icon={rotateCcw}
          label={t("settings.syncLatestCourses")}
          sub={syncResult ?? t("settings.syncLatestCoursesBody")}
          control={
            <button
              className="libre-settings-secondary"
              onClick={syncCourses}
              disabled={syncingCourses}
            >
              {syncingCourses ? t("settings.syncing") : t("settings.syncNow")}
            </button>
          }
        />
      </SettingsCard>

      {/* Cloud sync diff + force pull/push, rendered inline below
          the manual-sync card. SyncDebugPanel owns all the heavy
          chrome (the per-row diff table, the resync controls); the
          `embedded` prop tells it to skip its own page-level
          header so it nests cleanly under THIS pane's header. */}
      {realtime ? (
        <SyncDebugPanel
          embedded
          cloud={cloud}
          realtime={realtime}
          history={history ?? []}
          describeLesson={(courseId, lessonId) => {
            const course = courses?.find((c) => c.id === courseId);
            if (!course) return `${courseId} · ${lessonId}`;
            for (const ch of course.chapters) {
              const lesson = ch.lessons.find((l) => l.id === lessonId);
              if (lesson) return `${course.title} · ${lesson.title}`;
            }
            return `${course.title} · ${lessonId}`;
          }}
        />
      ) : (
        <SettingsCard title={t("settings.cloudSyncCard")}>
          <div
            style={{
              padding: "14px 20px",
              fontSize: 'var(--libre-fs-13)',
              color: "var(--color-text-secondary)",
            }}
          >
            {t("settings.syncDiagsUnavailable")}
          </div>
        </SettingsCard>
      )}

      {/* Toolchain probes — DiagnosticsPanel renders one card per
          check category, each with rows for the individual probes.
          Embedded mode skips its own SettingsPage so the page
          header above stays the singular title for this whole
          pane. */}
      <DiagnosticsPanel embedded />
    </SettingsPage>
  );
}
