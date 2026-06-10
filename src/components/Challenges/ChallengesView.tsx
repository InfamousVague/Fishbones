/// Challenges — every installed challenge pack rendered as a flat,
/// scannable card grid with search.
///
/// The 3D "hyper-scroll" fly-through intro that used to precede the
/// grid was retired in the 2026-06 cleanup — the page now just shows
/// the challenges.
///
/// Trees were retired in the 2026-05 redesign; tracks are now
/// the sole "outcome-driven sequence" surface. The underlying
/// tree data (`data/trees/`) is still imported here because
/// tracks reference tree node IDs to resolve completion + lesson
/// matches — that data layer is now internal-only.

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@base/primitives/icon";
import { swords } from "@base/primitives/icon/icons/swords";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { rotateCcw } from "@base/primitives/icon/icons/rotate-ccw";
import "@base/primitives/icon/icon.css";
import type { Course } from "../../data/types";
import {
  isChallengePack,
  isExerciseTrack,
  isKoans,
  isLings,
} from "../../data/types";
import { TREES } from "../../data/trees";
import {
  trackProgressPercent,
  type LearningTrack,
} from "../../data/tracks";
import { useT } from "../../i18n/i18n";
import "./ChallengesView.css";

/// Default accent (matches the cover-art palette used elsewhere)
/// for challenge packs that don't ship a per-pack accent. Picked
/// per-pack via a stable hash of the pack id so adjacent packs
/// don't end up sharing a colour by accident.
const CHALLENGE_ACCENTS = [
  "#d4863a",
  "#7c9eff",
  "#9d7cff",
  "#5fb59c",
  "#e87a7a",
  "#e8b85f",
  "#6fb5e8",
  "#c47aff",
];

function accentForPack(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return CHALLENGE_ACCENTS[Math.abs(h) % CHALLENGE_ACCENTS.length];
}

/// Convert a challenge-pack course into a `LearningTrack`-shaped
/// object the existing carousel + grid renderers can consume
/// without any per-card refactor. Most fields map verbatim from
/// the underlying Course; `steps` is left empty because tracks-
/// proper were SkillTree node sequences and challenge packs are
/// flat lesson lists (the carousel doesn't care — it only reads
/// `steps.length` for the meta line, which we patch around via
/// the `progressOverride` prop the card now accepts).
function challengePackAsTrack(pack: Course): LearningTrack {
  const totalLessons = pack.chapters.reduce(
    (n, ch) => n + ch.lessons.length,
    0,
  );
  // Differentiate copy by pack type. Exercism-style tracks
  // (`packType: "track"`) get language-curriculum framing;
  // challenge packs (`packType: "challenges"`) keep the
  // drill-problems framing. Without this, an Exercism track
  // rendered with "drill challenges" copy that didn't match
  // its actual structure — Notion issue #b6fef5af1fa276d1.
  const isTrack = isExerciseTrack(pack);
  const isKoansPack = isKoans(pack);
  const isLingsPack = isLings(pack);
  const lang = pack.language ?? "language";
  return {
    id: pack.id,
    title: pack.title,
    short: pack.language ? pack.language.toUpperCase() : "Pack",
    description:
      pack.description ??
      (isLingsPack
        ? `A rustlings-style ${lang} course — fix the broken snippet in each exercise to make it compile + pass.`
        : isKoansPack
        ? `Classic ${lang} koans — fill-in-the-blanks exercises with inline tests.`
        : isTrack
        ? `An Exercism-style ${lang} track — concept lessons in order, plus practice exercises.`
        : "A pack of short coding challenges to drill the language."),
    accent: accentForPack(pack.id),
    // Neither variant carries an explicit difficulty; default
    // to "intermediate" so the carousel badge reads as a neutral
    // marker rather than implying "easy" or "advanced."
    difficulty: "intermediate",
    estimatedHours: Math.max(1, Math.round(totalLessons / 6)),
    outcome: isLingsPack
      ? `Fix ${totalLessons} ${lang} exercises end-to-end.`
      : isKoansPack
      ? `Meditate through ${totalLessons} ${lang} koans end-to-end.`
      : isTrack
      ? `Work through ${totalLessons} ${lang} lessons end-to-end.`
      : `Drill ${totalLessons} ${lang} challenges end-to-end.`,
    // Synthetic empty step list — the carousel only reads
    // `steps.length` for the meta-line text; we override the
    // displayed step count via the card body's meta computation
    // path below by passing in the lesson count directly.
    steps: [],
  };
}

/// Find the first incomplete lesson in a pack — the natural
/// "resume" target when a learner clicks a challenge card.
/// Falls back to the very first lesson when every lesson is
/// already complete (re-opening a finished pack starts at the
/// beginning so a learner can review).
function firstIncompleteLesson(
  pack: Course,
  completed: Set<string>,
): { courseId: string; lessonId: string } | null {
  for (const chapter of pack.chapters) {
    for (const lesson of chapter.lessons) {
      if (!completed.has(`${pack.id}:${lesson.id}`)) {
        return { courseId: pack.id, lessonId: lesson.id };
      }
    }
  }
  const firstChapter = pack.chapters[0];
  const firstLesson = firstChapter?.lessons[0];
  if (firstLesson) {
    return { courseId: pack.id, lessonId: firstLesson.id };
  }
  return null;
}

/// Storage key from the retired hyper-scroll intro (the 3D
/// fly-through that used to precede the grid). The page is
/// grid-only now; the key is cleaned out of both storages on
/// mount so old sessions don't carry a stale value around.
const RETIRED_TRACKS_MODE_KEY = "libre:tracks-mode";

interface Props {
  courses: readonly Course[];
  /// `${courseId}:${lessonId}` set — same shape used by the
  /// Sidebar + lesson reader for marking progress.
  completed: Set<string>;
  /// Open a specific lesson by id pair. Wired by App so clicking
  /// a step's matched lesson lands the learner inside the lesson
  /// reader / editor instead of dead-ending in the track view.
  onOpenLesson: (courseId: string, lessonId: string) => void;
  /// Wipe every completion for a course (App's
  /// `clearCourseCompletions`). When wired, right-clicking any
  /// challenge-pack card surfaces a single-item "Reset progress"
  /// floating menu — mirrors the Sidebar's per-course reset
  /// affordance so the user has the same recovery path no matter
  /// which surface they're on. Optional: omitting it just disables
  /// the right-click menu, leaving the card as plain click-to-open.
  onResetCourse?: (courseId: string) => void;
}


export default function ChallengesView({
  courses,
  completed,
  onOpenLesson,
  onResetCourse,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  /// Right-click context-menu state. Mirrors the Sidebar's pattern:
  /// a single floating menu portalled to body, positioned at the
  /// cursor, dismissed by click-outside / Escape / scroll. Only
  /// surfaces "Reset progress" since that's the one action the
  /// Challenges grid is missing today; if more actions ever land
  /// here (export, settings, delete) extract `ContextMenu` into a
  /// shared component first.
  const [packMenu, setPackMenu] = useState<{
    courseId: string;
    courseTitle: string;
    x: number;
    y: number;
  } | null>(null);

  /// Dismiss the pack menu on any outside click, Escape, or scroll.
  /// Same UX contract as the Sidebar's per-course menu — keeping
  /// them consistent matters because both menus reach into the same
  /// `clearCourseCompletions` action; a learner who used one knows
  /// what the other does.
  useEffect(() => {
    if (!packMenu) return;
    const dismiss = () => setPackMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [packMenu]);

  /// Single entry-point the card renderers call when they see a
  /// right-click. Only opens for real packs (synthetic curated
  /// tracks have no `courseId` to reset) AND only when the host
  /// wired `onResetCourse` — otherwise the menu would render
  /// empty.
  const openPackMenu = onResetCourse
    ? (courseId: string, e: React.MouseEvent) => {
        const pack = courses.find((c) => c.id === courseId);
        if (!pack) return;
        e.preventDefault();
        setPackMenu({
          courseId,
          courseTitle: pack.title,
          x: e.clientX,
          y: e.clientY,
        });
      }
    : undefined;

  // One-shot cleanup of the retired hyper-intro mode key (older
  // builds wrote localStorage, newer ones sessionStorage).
  // Harmless when absent.
  useEffect(() => {
    try {
      localStorage.removeItem(RETIRED_TRACKS_MODE_KEY);
      sessionStorage.removeItem(RETIRED_TRACKS_MODE_KEY);
    } catch {
      /* private-browsing — no-op */
    }
  }, []);

  // Source list: every installed challenge-pack course, mapped
  // onto the `LearningTrack` shape the carousel renderers
  // expect. The old curated `TRACKS` data has been retired —
  // each card now represents a real challenge pack the learner
  // already has installed, and clicking a card drops them into
  // the pack's first incomplete lesson instead of a separate
  // "track detail" landing page. Kept on a memo keyed by the
  // courses list so re-renders during scroll don't re-allocate
  // the synthetic track objects each frame.
  // Tracks rail surfaces BOTH `packType: "challenges"` (per-language
  // exercise packs) AND `packType: "track"` (Exercism-style
  // curriculums) — Notion issue #b6fef5af1fa276d1 flagged that the
  // Exercism track was missing from this view. The `challengePackAsTrack`
  // adapter is shape-agnostic (it only reads pack.id / title /
  // chapters), so both pack types feed it cleanly.
  const challengeTracks = useMemo<readonly LearningTrack[]>(() => {
    // Featured languages for the In-house Challenges section
    // (Notion follow-up: "rework the default challenges to
    // support some for JS, Rust, Zig and Go in the default").
    // These four sort to the head of the challenges bucket; the
    // rest follow alphabetically. Exercism tracks sort
    // alphabetically among themselves and follow the entire
    // challenges block — the order is: featured challenges →
    // non-featured challenges → Exercism tracks. Applying the
    // sort once at the source keeps the hyper-view intro
    // (first 8 cards) and the grid sections agreeing on order.
    const FEATURED_LANGS = ["javascript", "rust", "zig", "go"] as const;
    const featuredRank = (lang: string | undefined | null): number => {
      const l = (lang ?? "").toLowerCase();
      const idx = FEATURED_LANGS.indexOf(
        l as (typeof FEATURED_LANGS)[number],
      );
      return idx >= 0 ? idx : FEATURED_LANGS.length;
    };
    const adapted = courses
      .filter(
        (c) =>
          isChallengePack(c) ||
          isExerciseTrack(c) ||
          isKoans(c) ||
          isLings(c),
      )
      .map((pack) => ({
        track: challengePackAsTrack(pack),
        kind: (isChallengePack(pack)
          ? "challenges"
          : isLings(pack)
          ? "lings"
          : isKoans(pack)
          ? "koans"
          : "track") as "challenges" | "track" | "koans" | "lings",
        language: pack.language ?? null,
      }));
    // Four-bucket ordering: Exercism tracks first (curated, the
    // historical headline of this page), then the famous *lings
    // family, then koans (both sequential fix-it / fill-in exercise
    // paths), then in-house challenge packs. Reordered from the
    // prior three-bucket layout when the V28 *lings relocation
    // landed.
    const kindRank = {
      track: 0,
      lings: 1,
      koans: 2,
      challenges: 3,
    } as const;
    adapted.sort((a, b) => {
      if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind];
      if (a.kind === "challenges") {
        const ra = featuredRank(a.language);
        const rb = featuredRank(b.language);
        if (ra !== rb) return ra - rb;
      }
      return a.track.title.localeCompare(b.track.title);
    });
    return adapted.map((row) => row.track);
  }, [courses]);
  // Side-table from track id → pack kind so the grid renderer can
  // split its output into two sections ("In-house challenges" vs
  // "Exercism tracks") without having to drag the original Course
  // object through every level. `LearningTrack` itself stays clean —
  // the shape is shared with the curated `TRACKS` data and we don't
  // want a kind discriminator leaking out there.
  const trackKindById = useMemo(() => {
    const map = new Map<string, "challenges" | "track" | "koans" | "lings">();
    for (const c of courses) {
      if (isChallengePack(c)) map.set(c.id, "challenges");
      else if (isLings(c)) map.set(c.id, "lings");
      else if (isKoans(c)) map.set(c.id, "koans");
      else if (isExerciseTrack(c)) map.set(c.id, "track");
    }
    return map;
  }, [courses]);

  // Per-pack progress (0..1). Computed once per render and passed
  // into the card body via `progressOverride` so the card can
  // display the right fill without trying to walk SkillTree nodes
  // — the synthetic tracks have an empty `steps` array and the
  // tree-walking path would always return 0.
  const packProgress = useMemo(() => {
    const map = new Map<string, number>();
    for (const pack of courses) {
      // Mirror the filter in `challengeTracks` above — keep
      // progress in sync across challenges, Exercism tracks,
      // koans, and *lings.
      if (
        !isChallengePack(pack) &&
        !isExerciseTrack(pack) &&
        !isKoans(pack) &&
        !isLings(pack)
      )
        continue;
      let total = 0;
      let done = 0;
      for (const ch of pack.chapters) {
        for (const lesson of ch.lessons) {
          total += 1;
          if (completed.has(`${pack.id}:${lesson.id}`)) done += 1;
        }
      }
      map.set(pack.id, total === 0 ? 0 : done / total);
    }
    return map;
  }, [courses, completed]);

  // Filter the challenge-pack carousel by the search input. The
  // match runs over title / short / outcome / description /
  // difficulty so a query like "rust" finds the Rust pack,
  // "challenge" or any common token still matches every pack.
  // Falls through to the full list when empty.
  const visibleTracks = useMemo<readonly LearningTrack[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return challengeTracks;
    return challengeTracks.filter((t) => {
      const hay = [
        t.title,
        t.short,
        t.outcome,
        t.description,
        t.difficulty,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, challengeTracks]);

  // Open a challenge pack by id — find the first incomplete
  // lesson in that pack and hand off to App's lesson router.
  // No TrackDetail intermediate page any more; challenge packs
  // are flat lesson lists and a learner clicking a card wants
  // to start the next problem, not read a curated description.
  const handleOpenPack = (id: string) => {
    const pack = courses.find((c) => c.id === id);
    if (!pack) return;
    const next = firstIncompleteLesson(pack, completed);
    if (next) onOpenLesson(next.courseId, next.lessonId);
  };

  return (
    <div className="libre-challenges libre-challenges--grid">
      <TracksHeader query={query} onQueryChange={setQuery} />
      {/* Content wrapper — flex: 1 so the inner grid-wrap's
          `flex: 1` resolves against a flex parent. Without it the
          grid stretched to its natural content height and appeared
          zoomed-in / clipped. */}
      <div className="libre-challenges__content">
        <ChallengesGrid
          tracks={visibleTracks}
          completed={completed}
          onOpenTrack={handleOpenPack}
          progressOverrides={packProgress}
          kindByTrackId={trackKindById}
          onContextMenuTrack={openPackMenu}
        />
      </div>

      {/* Pack-card right-click menu. Reuses the Sidebar's
          `libre__context-menu` styles (Sidebar.css is loaded
          globally since the rail is always mounted alongside
          this view) so the affordance reads identically across
          surfaces. Portalled to body so the Challenges grid's
          overflow / transform stack can't clip it. */}
      {packMenu && onResetCourse && createPortal(
        <div
          className="libre__context-menu"
          style={{ left: packMenu.x, top: packMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="libre__context-menu-label">
            {packMenu.courseTitle}
          </div>
          <button
            type="button"
            className="libre__context-menu-item"
            onClick={() => {
              onResetCourse(packMenu.courseId);
              setPackMenu(null);
            }}
          >
            <span className="libre__context-menu-icon" aria-hidden>
              <Icon icon={rotateCcw} size="xs" color="currentColor" />
            </span>
            {t("sidebar.ctxResetProgress")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/// Top strip: title + blurb + search input above the card grid.
/// The search input is the only interactive element up here —
/// the title block is decorative.
function TracksHeader({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const t = useT();
  return (
    <header className="libre-challenges__header">
      <div className="libre-challenges__header-text">
        <h1 className="libre-challenges__title">{t("challenges.title")}</h1>
        <p className="libre-challenges__blurb">{t("challenges.blurbGrid")}</p>
      </div>
      <div className="libre-challenges__search">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("challenges.searchPlaceholder")}
          aria-label={t("challenges.ariaSearch")}
          className="libre-challenges__search-input"
        />
        {query && (
          <button
            type="button"
            className="libre-challenges__search-clear"
            onClick={() => onQueryChange("")}
            aria-label={t("challenges.ariaClear")}
          >
            <Icon icon={xIcon} size="xs" color="currentColor" />
          </button>
        )}
      </div>
    </header>
  );
}

/// The actual card visual — head / body / foot / progress.
/// Shared between hyper mode (where it's wrapped in a slot
/// that gets per-frame `translate3d` writes) and grid mode
/// (where it sits directly in a CSS grid cell). `variant`
/// drives one CSS modifier so the card can opt out of the
/// 3D-centric `translate(-50%, -50%)` baseline when it's
/// being laid out by a normal flow.
function TrackCardBody({
  track,
  index,
  completed,
  onOpen,
  onContextMenu,
  variant,
  progressOverride,
}: {
  track: LearningTrack;
  index: number;
  completed: Set<string>;
  onOpen: () => void;
  /// Right-click handler — host opens its pack-actions menu at
  /// the cursor. Optional; when absent the card is plain
  /// click-to-open with no menu (preserves the previous behaviour
  /// for callers that haven't wired the new pathway).
  onContextMenu?: (e: React.MouseEvent) => void;
  variant: "hyper" | "grid";
  /// Optional 0..1 progress fraction supplied by the caller.
  /// When present, the card uses it verbatim instead of running
  /// the SkillTree-based `trackProgressPercent` resolver. This
  /// is the path challenge-pack cards take — their synthetic
  /// LearningTrack has no `steps`, so the resolver would read 0.
  progressOverride?: number;
}) {
  const pct =
    progressOverride != null
      ? Math.round(Math.max(0, Math.min(1, progressOverride)) * 100)
      : trackProgressPercent(track, TREES, completed);
  const stepCount = track.steps.length;
  // `stepCount === 0` is the synthetic-track case (challenge packs)
  // — suppress the misleading "0 steps" cell entirely rather than
  // render it. The card body's outcome line already mentions the
  // lesson count for those packs.
  const meta = [
    stepCount > 0
      ? `${stepCount} step${stepCount === 1 ? "" : "s"}`
      : null,
    track.estimatedHours ? `~${track.estimatedHours}h` : null,
    track.difficulty,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className={`libre-challenges__card libre-challenges__card--${variant}`}
      style={{ "--track-accent": track.accent } as CSSProperties}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="libre-challenges__card-head">
        <span className="libre-challenges__card-tag">
          <span aria-hidden className="libre-challenges__card-tag-icon">
            <Icon
              icon={swords}
              size="xs"
              color="currentColor"
              weight="bold"
            />
          </span>
          <span>{track.short}</span>
        </span>
        <span className="libre-challenges__card-index">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="libre-challenges__card-body">
        <h2 className="libre-challenges__card-title">{track.title}</h2>
        <p className="libre-challenges__card-outcome">{track.outcome}</p>
        <p className="libre-challenges__card-desc">{track.description}</p>
      </div>
      <div className="libre-challenges__card-foot">
        <span className="libre-challenges__card-meta">{meta.join(" · ")}</span>
        <span className="libre-challenges__card-pct">{pct}%</span>
      </div>
      <div className="libre-challenges__card-progress" aria-hidden>
        <span
          className="libre-challenges__card-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}

/// Grid mode — a CSS grid of TrackCardBodys. No physics, no rAF
/// loop, no perspective. Renders once the learner has finished
/// the hyper tour (or on subsequent loads after the
/// `libre:tracks-mode` flag flipped to "grid"). The grid uses
/// `repeat(auto-fill, minmax(320px, 1fr))` so the layout adapts
/// to whatever main-pane width the learner happens to have —
/// 3 columns on a wide window, 1 on a narrow sidebar-collapsed
/// view. Each card animates in with a staggered fade so the
/// transition from the hyper view doesn't feel abrupt.
///
/// The grid splits its cards into FOUR labelled sections when
/// `kindByTrackId` is provided:
///   1. Exercism tracks (`packType: "track"`)
///   2. *lings (`packType: "lings"`)
///   3. Koans (`packType: "koans"`)
///   4. In-house challenges (`packType: "challenges"`)
///
/// Without the map (e.g. legacy callers using the curated
/// `TRACKS` data) the grid renders as one unsectioned flow.
function ChallengesGrid({
  tracks,
  completed,
  onOpenTrack,
  onContextMenuTrack,
  progressOverrides,
  kindByTrackId,
}: {
  tracks: readonly LearningTrack[];
  completed: Set<string>;
  onOpenTrack: (id: string) => void;
  /// Right-click on a card → host opens the pack-actions menu at
  /// the cursor. Optional; when absent the cards are plain
  /// click-to-open with no menu.
  onContextMenuTrack?: (courseId: string, e: React.MouseEvent) => void;
  /// Per-card progress overrides keyed by `track.id` (0..1) —
  /// challenge packs ride this rail because their synthetic
  /// LearningTrack has no `steps` for the tree-walker to count.
  progressOverrides?: ReadonlyMap<string, number>;
  /// Optional pack-kind discriminator. When present, the grid
  /// splits its output into four labelled sections (Exercism
  /// tracks, *lings, koans, in-house challenges). When absent /
  /// empty, the grid renders one flat section.
  kindByTrackId?: ReadonlyMap<
    string,
    "challenges" | "track" | "koans" | "lings"
  >;
}) {
  if (tracks.length === 0) {
    return (
      <div className="libre-challenges__empty">
        <p>No challenges match this search.</p>
      </div>
    );
  }
  // Bucket the tracks. The incoming `tracks` array is already
  // sorted at the source (`ChallengesView.challengeTracks`) — Exercism
  // tracks alphabetically, koans alphabetically, then in-house
  // challenges (featured langs first, rest alphabetical). We just
  // split into kind-buckets here without re-sorting.
  // When `kindByTrackId` isn't supplied (curated TRACKS data, or a
  // sparse search result), fall back to a single unlabelled bucket.
  const challenges: LearningTrack[] = [];
  const exercism: LearningTrack[] = [];
  const lings: LearningTrack[] = [];
  const koans: LearningTrack[] = [];
  const unknown: LearningTrack[] = [];
  for (const t of tracks) {
    const kind = kindByTrackId?.get(t.id);
    if (kind === "challenges") challenges.push(t);
    else if (kind === "track") exercism.push(t);
    else if (kind === "lings") lings.push(t);
    else if (kind === "koans") koans.push(t);
    else unknown.push(t);
  }
  const sections: Array<{ key: string; label: string | null; rows: LearningTrack[] }> = [];
  // Section order: Exercism tracks → *lings → Koans → in-house
  // challenges. Mirrors the source-sort order in
  // `ChallengesView.challengeTracks`.
  if (exercism.length > 0) {
    sections.push({
      key: "exercism",
      label: "Exercism tracks",
      rows: exercism,
    });
  }
  if (lings.length > 0) {
    sections.push({
      key: "lings",
      label: "*lings",
      rows: lings,
    });
  }
  if (koans.length > 0) {
    sections.push({
      key: "koans",
      label: "Koans",
      rows: koans,
    });
  }
  if (challenges.length > 0) {
    sections.push({
      key: "challenges",
      label: "In-house challenges",
      rows: challenges,
    });
  }
  if (unknown.length > 0) {
    // Legacy / curated tracks with no kind annotation. Render
    // unlabelled at the end so they still surface but don't fight
    // the labelled sections for the title row.
    sections.push({ key: "unknown", label: null, rows: unknown });
  }
  // Continuous stagger index across all sections so the
  // "materialise in a wave" effect doesn't reset at each section
  // boundary.
  let staggerIdx = 0;
  return (
    <div className="libre-challenges__grid-wrap">
      {sections.map((sec) => (
        <section key={sec.key} className="libre-challenges__grid-section">
          {sec.label && (
            <h2 className="libre-challenges__grid-section-title">{sec.label}</h2>
          )}
          <div className="libre-challenges__grid">
            {sec.rows.map((track) => {
              const cellIdx = staggerIdx++;
              return (
                <div
                  key={track.id}
                  className="libre-challenges__grid-cell"
                  // Staggered mount delay so the grid materialises
                  // in a wave rather than all-at-once — softens the
                  // hand-off from the hyper view.
                  style={
                    {
                      animationDelay: `${Math.min(cellIdx, 16) * 35}ms`,
                    } as CSSProperties
                  }
                >
                  <TrackCardBody
                    track={track}
                    index={cellIdx}
                    completed={completed}
                    onOpen={() => onOpenTrack(track.id)}
                    onContextMenu={
                      onContextMenuTrack
                        ? (e) => onContextMenuTrack(track.id, e)
                        : undefined
                    }
                    variant="grid"
                    progressOverride={progressOverrides?.get(track.id)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
