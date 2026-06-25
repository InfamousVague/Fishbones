/// Vertical syllabus view for a single learning path.
///
/// The route reads top-to-bottom as an ordered reading list: numbered
/// step rows with the book's cover art, the step note, a difficulty
/// badge, and live progress. A level divider appears whenever the
/// difficulty tier steps up (Beginner → Intermediate → Advanced), so
/// the path visibly climbs. A `fork` stage renders as a labeled set
/// of branch lanes — alternative endings, each its own mini-list.
///
/// The page is the vertical scroll-owner (flex:1 / min-height:0 /
/// overflow-y:auto — the contract every direct child of the
/// overflow:hidden `.libre__main` must honour).

import { useState } from "react";
import { Icon } from "@base/primitives/icon";
import { arrowLeft } from "@base/primitives/icon/icons/arrow-left";
import { download } from "@base/primitives/icon/icons/download";
import { circleCheck } from "@base/primitives/icon/icons/circle-check";
import { circleDashed } from "@base/primitives/icon/icons/circle-dashed";
import { circle } from "@base/primitives/icon/icons/circle";
import { plus } from "@base/primitives/icon/icons/plus";
import "@base/primitives/icon/icon.css";

import type { LearningPath } from "../../data/paths";
import { languageMeta } from "../../lib/languages";
import { flattenSteps } from "../../data/paths";
import {
  courseDifficulty,
  DIFFICULTY_COLOR,
  DIFFICULTY_LABEL,
  difficultyRange,
  type CourseDifficulty,
} from "../../data/courseDifficulty";
import type { Course } from "../../data/types";
import { useT } from "../../i18n/i18n";
import {
  aggregate,
  resolveBranch,
  resolveStep,
  type ResolvedStep,
  type StepState,
} from "./pathProgress";
import { pathCoverUrl } from "./PathsPage";
import "./PathsPage.css";
import LanguageChip from "../LanguageChip/LanguageChip";

interface Props {
  path: LearningPath;
  /// id→Course index, built once by the parent (PathsPage).
  byId: Map<string, Course>;
  completed: Set<string>;
  onBack: () => void;
  onOpenCourse?: (courseId: string) => void;
  onBrowseCatalog?: () => void;
  /// Install a not-yet-installed course in place. When wired, a
  /// not-installed step installs on click (and an "Install all" button
  /// appears) instead of bouncing to Discover.
  onInstallCourse?: (courseId: string) => Promise<void> | void;
}

const STEP_ICON: Record<StepState, string> = {
  complete: circleCheck,
  "in-progress": circleDashed,
  "not-started": circle,
  "not-installed": plus,
};

export default function PathDetail({
  path,
  byId,
  completed,
  onBack,
  onOpenCourse,
  onBrowseCatalog,
  onInstallCourse,
}: Props) {
  const t = useT();

  // Per-course in-flight install state, so a clicked row (and the
  // "Install all" button) can show a spinner + ignore repeat clicks.
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  const installOne = async (courseId: string) => {
    if (!onInstallCourse || installing.has(courseId)) return;
    setInstalling((prev) => new Set(prev).add(courseId));
    try {
      await onInstallCourse(courseId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[paths] install failed:", courseId, e);
      // A handful of path courses aren't published as catalog entries
      // (e.g. bundled-only books). If the in-place install can't resolve
      // one, fall back to Discover so the learner still has a path
      // forward instead of a silent no-op.
      onBrowseCatalog?.();
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    }
  };

  // Header rollup across trunk + branches.
  const allResolved: ResolvedStep[] = [];
  for (const stage of path.stages) {
    if (stage.kind === "step") {
      allResolved.push(resolveStep(stage.step, byId, completed));
    } else {
      for (const b of stage.branches) {
        for (const s of b.steps) {
          allResolved.push(resolveStep(s, byId, completed));
        }
      }
    }
  }
  const overall = aggregate(allResolved);
  const range = difficultyRange(flattenSteps(path).map((s) => s.courseId));

  // Distinct not-yet-installed course ids, in path order — drives the
  // "Install all" button + lets us know whether to offer in-place
  // install at all.
  const notInstalledIds = [
    ...new Set(
      allResolved.filter((s) => s.state === "not-installed").map((s) => s.courseId),
    ),
  ];
  const canInstall = !!onInstallCourse;
  const anyInstalling = installing.size > 0;

  const installAll = async () => {
    if (!onInstallCourse) return;
    // Sequential so we don't hammer the catalog/host with N parallel
    // fetches; each refreshes the library as it lands.
    for (const id of notInstalledIds) {
      // eslint-disable-next-line no-await-in-loop
      await installOne(id);
    }
  };

  const openStep = (s: ResolvedStep) => {
    if (s.state === "not-installed") {
      if (canInstall) void installOne(s.courseId);
      else onBrowseCatalog?.();
      return;
    }
    onOpenCourse?.(s.courseId);
  };

  const diffChip = (d: CourseDifficulty | undefined) =>
    d ? (
      <span
        className="libre-path-chip libre-path-chip--level"
        style={{ "--chip-accent": DIFFICULTY_COLOR[d] } as React.CSSProperties}
      >
        {DIFFICULTY_LABEL[d]}
      </span>
    ) : null;

  const renderRow = (s: ResolvedStep, num: number | null, key: string) => {
    const installed = s.state !== "not-installed";
    const isInstalling = installing.has(s.courseId);
    const d = courseDifficulty(s.courseId);
    return (
      <button
        key={key}
        type="button"
        className={
          `libre-path-row libre-path-row--${s.state}` +
          (isInstalling ? " is-installing" : "")
        }
        onClick={() => openStep(s)}
        disabled={isInstalling}
        title={
          installed
            ? t("paths.openCourse", { title: s.title })
            : isInstalling
              ? t("paths.installing", { title: s.title })
              : canInstall
                ? t("paths.installCourse", { title: s.title })
                : t("paths.findInDiscover", { title: s.title })
        }
      >
        {num !== null && (
          <span className="libre-path-row__num" aria-hidden>
            {String(num).padStart(2, "0")}
          </span>
        )}
        <span className="libre-path-row__coverwrap" aria-hidden>
          <img
            className="libre-path-row__cover"
            src={pathCoverUrl(s.courseId)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility =
                "hidden";
            }}
          />
        </span>
        <span className="libre-path-row__text">
          <span className="libre-path-row__title-line">
            <span className="libre-path-row__title">{s.title}</span>
            {diffChip(d)}
          </span>
          <span className="libre-path-row__note">{s.note}</span>
        </span>
        <span className="libre-path-row__status">
          <span
            className={`libre-path-row__state libre-path-row__state--${s.state}`}
            aria-hidden
          >
            <Icon icon={STEP_ICON[s.state]} size="sm" color="currentColor" />
          </span>
          <span className="libre-path-row__state-label">
            {isInstalling
              ? t("paths.installingShort")
              : s.state === "complete"
                ? "Done"
                : s.state === "in-progress"
                  ? `${s.done}/${s.total}`
                  : s.state === "not-started"
                    ? "Start"
                    : "Install"}
          </span>
        </span>
      </button>
    );
  };

  // Trunk rows with level dividers wherever the difficulty tier
  // changes; forks render after the trunk as branch lanes.
  let lastLevel: CourseDifficulty | undefined;
  let stepNum = 0;
  const body: React.ReactNode[] = [];
  for (const [si, stage] of path.stages.entries()) {
    if (stage.kind === "step") {
      const d = courseDifficulty(stage.step.courseId);
      if (d && d !== lastLevel) {
        lastLevel = d;
        body.push(
          <div
            className="libre-path-level"
            key={`lvl:${si}`}
            style={
              { "--chip-accent": DIFFICULTY_COLOR[d] } as React.CSSProperties
            }
          >
            <span className="libre-path-level__label">
              {DIFFICULTY_LABEL[d]}
            </span>
            <span className="libre-path-level__rule" aria-hidden />
          </div>,
        );
      }
      stepNum += 1;
      body.push(
        renderRow(
          resolveStep(stage.step, byId, completed),
          stepNum,
          `s:${si}`,
        ),
      );
    } else {
      body.push(
        <div className="libre-path-fork" key={`f:${si}`}>
          {stage.label && (
            <div className="libre-path-fork__label">{stage.label}</div>
          )}
          <div className="libre-path-fork__branches">
            {stage.branches.map((branch) => {
              const { steps, progress } = resolveBranch(
                branch,
                byId,
                completed,
              );
              return (
                <div className="libre-path-branch" key={branch.id}>
                  <div className="libre-path-branch__head">
                    <span className="libre-path-branch__label">
                      {branch.label}
                    </span>
                    <span className="libre-path-branch__pct">
                      {progress.pct}%
                    </span>
                  </div>
                  {steps.map((s, i) =>
                    renderRow(s, null, `b:${branch.id}:${i}`),
                  )}
                </div>
              );
            })}
          </div>
        </div>,
      );
    }
  }

  return (
    <div className="libre-path-detail">
      <header className="libre-path-detail__header">
        <button
          type="button"
          className="libre-path-detail__back"
          onClick={onBack}
          aria-label={t("paths.back")}
        >
          <Icon icon={arrowLeft} size="sm" color="currentColor" />
          <span>{t("paths.back")}</span>
        </button>

        <div className="libre-path-detail__head-row">
          <LanguageChip language={path.language} size="xl" iconOnly/>
          <div className="libre-path-detail__head-text">
            <h1 className="libre-path-detail__title">{path.title}</h1>
            <p className="libre-path-detail__blurb">{path.blurb}</p>
            {range && (
              <div className="libre-path-detail__chips">
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
                <span className="libre-path-chip libre-path-chip--muted">
                  {overall.count} steps
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="libre-path-detail__progress">
          <div className="libre-path-detail__bar" aria-hidden>
            <div
              className="libre-path-detail__bar-fill"
              // Language-brand fill — matches the path card + library colours.
              style={{
                width: `${overall.pct}%`,
                background: path.language
                  ? languageMeta(path.language).color
                  : undefined,
              }}
            />
          </div>
          <div className="libre-path-detail__progress-meta">
            <span className="libre-path-detail__pct">
              {t("paths.percentComplete", { pct: `${overall.pct}%` })}
            </span>
            <span>
              {t("paths.coursesInstalled", {
                installed: overall.installed,
                total: overall.count,
              })}
            </span>
          </div>
        </div>

        {canInstall && notInstalledIds.length > 0 && (
          <button
            type="button"
            className="libre-path-detail__install-all"
            onClick={installAll}
            disabled={anyInstalling}
          >
            <Icon icon={download} size="sm" color="currentColor" />
            <span>
              {anyInstalling
                ? t("paths.installingShort")
                : t("paths.installAll", { count: notInstalledIds.length })}
            </span>
          </button>
        )}
      </header>

      <div
        className="libre-path-detail__list"
        role="group"
        aria-label={t("paths.flowAria", { title: path.title })}
      >
        {body}
        <div className="libre-path-end" aria-hidden>
          <span className="libre-path-end__flag">
            {overall.allComplete ? t("paths.endDone") : t("paths.endGoal")}
          </span>
        </div>
      </div>
    </div>
  );
}
