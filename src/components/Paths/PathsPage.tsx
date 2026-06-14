/// Curated learning-paths surface. Two views, one component:
///
///   - LIST: a card per path — a fanned strip of the route's book
///     covers, the title/blurb, a difficulty-range chip, and overall
///     progress. Clicking a card drills into the detail syllabus.
///   - DETAIL: a vertical, difficulty-grouped syllabus of the
///     selected path — see `PathDetail`.
///
/// Selection is local state (not an App route); `initialSelectedId`
/// lets callers (e.g. a collection's path card) deep-link straight
/// into a path's detail view. Progress is computed fresh from
/// `completed` every render via the shared `pathProgress` helpers.

import { useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { arrowRight } from "@base/primitives/icon/icons/arrow-right";
import "@base/primitives/icon/icon.css";

import { LEARNING_PATHS, flattenSteps } from "../../data/paths";
import {
  DIFFICULTY_COLOR,
  DIFFICULTY_LABEL,
  difficultyRange,
} from "../../data/courseDifficulty";
import { catalogAssetBase } from "../../lib/catalog";
import type { Course } from "../../data/types";
import { useT } from "../../i18n/i18n";
import { indexCourses, resolvePathProgress } from "./pathProgress";
import LanguageChip from "../LanguageChip/LanguageChip";
import PathDetail from "./PathDetail";
import "./PathsPage.css";

interface Props {
  /// All installed courses. Steps resolve their `courseId` against
  /// this list. Optional so the page still renders (everything as
  /// "not installed") when no list is plumbed through.
  courses?: Course[];
  /// Per-lesson completion set (keys: `${courseId}:${lessonId}`).
  completed?: Set<string>;
  /// Open / resume an INSTALLED course (parent owns "resume at
  /// which lesson").
  onOpenCourse?: (courseId: string) => void;
  /// Route to Discover so the learner can install a step's course
  /// that isn't in their library yet. Fallback only — when
  /// `onInstallCourse` is wired, not-installed steps install in place.
  onBrowseCatalog?: () => void;
  /// Install a not-yet-installed course in place (resolve id →
  /// catalog → fetch + save). Lets the learner build out a path from
  /// the path screen without hunting in Discover.
  onInstallCourse?: (courseId: string) => Promise<void> | void;
  /// Deep-link: open directly on this path's detail view (e.g. from
  /// a collection's path card). The list stays one Back away.
  initialSelectedId?: string | null;
}

/// Catalog cover for any course id — installed or not. Resolves to
/// the local extract on dev builds and the CDN in production (same
/// base the rest of the app uses).
export function pathCoverUrl(courseId: string): string {
  return `${catalogAssetBase()}/${courseId}.jpg`;
}

export default function PathsPage({
  courses = [],
  completed = new Set(),
  onOpenCourse,
  onBrowseCatalog,
  onInstallCourse,
  initialSelectedId = null,
}: Props) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );

  const byId = useMemo(() => indexCourses(courses), [courses]);

  const cards = useMemo(
    () =>
      LEARNING_PATHS.map((path) => {
        const stepIds = flattenSteps(path).map((s) => s.courseId);
        return {
          path,
          stepIds,
          range: difficultyRange(stepIds),
          progress: resolvePathProgress(path, byId, completed),
        };
      }),
    [byId, completed],
  );

  const selected = selectedId
    ? LEARNING_PATHS.find((p) => p.id === selectedId)
    : null;

  if (selected) {
    return (
      <PathDetail
        path={selected}
        byId={byId}
        completed={completed}
        onBack={() => setSelectedId(null)}
        onOpenCourse={onOpenCourse}
        onBrowseCatalog={onBrowseCatalog}
        onInstallCourse={onInstallCourse}
      />
    );
  }

  return (
    <div className="libre-paths-page">
      <header className="libre-paths-page__header">
        <h1 className="libre-paths-page__title">{t("paths.title")}</h1>
        <p className="libre-paths-page__subtitle">{t("paths.subtitle")}</p>
      </header>

      <div className="libre-paths-page__grid">
        {cards.map(({ path, stepIds, range, progress }) => (
          <button
            key={path.id}
            type="button"
            className={
              "libre-path-card" +
              (progress.allComplete ? " libre-path-card--complete" : "")
            }
            onClick={() => setSelectedId(path.id)}
            aria-label={t("paths.ariaPath", {
              title: path.title,
              pct: `${progress.pct}%`,
            })}
          >
            {/* Fanned strip of the route's first few book covers — the
                card's hero graphic. Lazy + alt-less: pure decoration,
                the text below carries the meaning. */}
            <div className="libre-path-card__covers" aria-hidden>
              {stepIds.slice(0, 5).map((id, i) => (
                // Frame clips the cover; the img inside is zoomed ~10%
                // so the art's paper-edge borders crop away.
                <span
                  key={id + i}
                  className="libre-path-card__coverframe"
                  style={{ zIndex: 10 - i }}
                >
                  <img
                    className="libre-path-card__cover"
                    src={pathCoverUrl(id)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                </span>
              ))}
              <span className="libre-path-card__covers-fade" />
            </div>

            <div className="libre-path-card__body">
              <div className="libre-path-card__head">
                <span className="libre-path-card__icon" aria-hidden>
                  <LanguageChip language={path.language} size="sm" iconOnly />
                </span>
                <h2 className="libre-path-card__title">{path.title}</h2>
                <span className="libre-path-card__open" aria-hidden>
                  <Icon icon={arrowRight} size="sm" color="currentColor" />
                </span>
              </div>
              <p className="libre-path-card__blurb">{path.blurb}</p>

              <div className="libre-path-card__chips">
                {range && (
                  <span
                    className="libre-path-chip"
                    style={
                      {
                        "--chip-accent": DIFFICULTY_COLOR[range.min],
                      } as React.CSSProperties
                    }
                  >
                    {range.min === range.max
                      ? DIFFICULTY_LABEL[range.min]
                      : `${DIFFICULTY_LABEL[range.min]} → ${DIFFICULTY_LABEL[range.max]}`}
                  </span>
                )}
                <span className="libre-path-chip libre-path-chip--muted">
                  {stepIds.length} steps
                </span>
              </div>

              <div className="libre-path-card__progress">
                <div className="libre-path-card__bar" aria-hidden>
                  <div
                    className="libre-path-card__bar-fill"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <div className="libre-path-card__progress-meta">
                  <span className="libre-path-card__pct">
                    {t("paths.percentComplete", { pct: `${progress.pct}%` })}
                  </span>
                  <span className="libre-path-card__coverage">
                    {t("paths.coursesInstalled", {
                      installed: progress.installed,
                      total: progress.count,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
