import { useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { flaskConical } from "@base/primitives/icon/icons/flask-conical";
import { pencilLine } from "@base/primitives/icon/icons/pencil-line";
import { arrowDownToLine } from "@base/primitives/icon/icons/arrow-down-to-line";
import { loader } from "@base/primitives/icon/icons/loader";
import { swords } from "@base/primitives/icon/icons/swords";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import { isChallengePack } from "../../data/types";
import { useCourseCover } from "../../hooks/useCourseCover";
import FishbonesLoader from "../Shared/FishbonesLoader";
import { languageMeta } from "../../lib/languages";
import "./BookCover.css";

/// Pick a glyph that matches the editorial-pipeline metaphor for each
/// tier. Pencil = drafting (unreviewed), flask = next up, rocket =
/// final polish for launch. Exported so CourseLibrary's section
/// header can render the same glyph next to the section title.
export function releaseStatusIcon(status: ReleaseStatus): string {
  switch (status) {
    case "BETA":
      return rocket;
    case "ALPHA":
      return flaskConical;
    case "UNREVIEWED":
    default:
      return pencilLine;
  }
}

interface Props {
  course: Course;
  /// Fraction 0..1 for the thin progress bar along the bottom of the
  /// card. Parent computes it from the completed-lessons set.
  progress: number;
  /// Fires when the card is clicked (opens the course). Parent wires to
  /// the same "open course" handler the grid view uses.
  onOpen: () => void;
  /// Optional right-click affordance. Grid view's menu shows Export /
  /// Delete / Course settings — the shelf gets the same treatment.
  onContextMenu?: (e: React.MouseEvent) => void;
  /// When true, dim the cover and render a FishbonesLoader overlay —
  /// used while the course's full body is still hydrating from disk
  /// after the initial lightweight summary pull.
  loading?: boolean;
  /// When true, this card represents a remote-catalog course the
  /// user hasn't installed yet. Render semi-opaque, swap the open
  /// click for `onInstall`, and override the cover lookup to
  /// `placeholderCoverUrl` (since `useCourseCover` only knows about
  /// installed courses).
  placeholder?: boolean;
  /// In-flight install indicator — shows a spinner overlay + disables
  /// click while the parent's onInstall handler is downloading.
  installing?: boolean;
  /// Where to fetch the cover image from when `placeholder` is true.
  /// Bypasses the IPC-backed `useCourseCover` lookup.
  placeholderCoverUrl?: string;
  /// Click handler for placeholder tiles. Parent wires to the
  /// download-and-install flow. Required when `placeholder` is set;
  /// without it the tile renders inert.
  onInstall?: () => void;
  /// When true, render the "update available" badge in the bottom-
  /// right corner. Set by the parent (CourseLibrary) from the
  /// `useCourseUpdates` hook's per-course map.
  hasUpdate?: boolean;
  /// True while the sync triggered by the badge is in flight. Swaps
  /// the badge to a spinner + disables clicks so the user gets
  /// feedback during the multi-second fetch / write / hydrate cycle
  /// (without it the button looked dead and they tended to re-click
  /// expecting something to happen).
  updating?: boolean;
  /// Click handler for the update badge. Parent wires to the
  /// `syncBundledToInstalled` flow + course-list refresh. Click
  /// stops propagation so the card's `onOpen` doesn't also fire.
  onUpdate?: () => void;
}

/// Shelf-mode library card. Rendered at roughly 2:3 aspect ratio (the
/// shape of a physical paperback). When the course has an extracted
/// cover PNG, it fills the card; otherwise a solid language-tinted tile
/// with the title overlaid stands in.
///
/// The progress bar sits flush to the bottom of the card and the title
/// fades in from a dark gradient so it stays legible against any cover
/// photo. Hover nudges the card up a few pixels + deepens the shadow.
export default function BookCover({
  course,
  progress,
  onOpen,
  onContextMenu,
  loading = false,
  hasUpdate = false,
  updating = false,
  onUpdate,
  placeholder = false,
  installing = false,
  placeholderCoverUrl,
  onInstall,
}: Props) {
  // Covers are prefetched in bulk when the library mounts (see
  // `prefetchCovers` in CourseLibrary). This hook just reads from the
  // shared cache that prefetch populates — no extra IPC per card.
  // For placeholder tiles we skip the IPC lookup entirely (the
  // course isn't installed yet so there's nothing on disk) and use
  // the catalog-supplied URL directly.
  const installedCoverUrl = useCourseCover(course.id, course.coverFetchedAt);
  const coverUrl = placeholder ? placeholderCoverUrl : installedCoverUrl;
  // Track image load failures so a 404 / blocked-by-CSP / etc. on
  // the URL falls back to the language-tinted glyph tile rather
  // than rendering Safari's broken-image placeholder. Resets when
  // the URL changes (rare, but happens after a fresh cover fetch).
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    setImageError(false);
  }, [coverUrl]);
  const hasCover = !!coverUrl && !imageError;

  // Brand-coloured language badge pinned to the top-right corner of
  // every card. Shown over both real covers and the fallback tile so
  // the language is recognizable at a glance even when the cover art
  // is busy (a Python book might be a snake photo; a Rust book might
  // be all-typography). The badge uses a frosted-dark backdrop so it
  // reads against any cover.
  const langMeta = languageMeta(course.language);
  const LangIcon = langMeta.Icon;

  // Release-status banner pinned to the top-left corner. Every shipped
  // book is currently labelled PRE-RELEASE, except The Rust
  // Programming Language which is ALPHA — it's furthest along the
  // editorial pipeline of the local collection. This is intentionally
  // hardcoded right now; if/when more books move tiers we'll lift the
  // mapping into a manifest field.
  const releaseStatus = releaseStatusFor(course);

  // Whether this card is a challenge pack vs. a tutorial book —
  // surfaces a small "Challenges" chip in the corner so a learner
  // scanning the shelf can tell exercises-only packs apart from
  // long-form prose books at a glance. Read off the same `packType`
  // field the Library kindFilter uses.
  const isChallenges = isChallengePack(course);

  // Placeholder tiles route their click to the install handler
  // instead of the open handler. The card itself stays interactive
  // so the visual affordance is consistent with installed covers
  // (you can still tap anywhere to act on it) — the action just
  // changes meaning.
  const handleClick = placeholder
    ? () => {
        if (!installing && onInstall) onInstall();
      }
    : onOpen;
  return (
    <button
      type="button"
      className={`fishbones-book ${
        hasCover ? "fishbones-book--has-cover" : "fishbones-book--no-cover"
      } fishbones-book--lang-${course.language} ${
        loading ? "fishbones-book--loading" : ""
      } ${placeholder ? "fishbones-book--placeholder" : ""} ${
        installing ? "fishbones-book--installing" : ""
      }`}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      title={
        placeholder
          ? installing
            ? `Installing ${course.title}…`
            : `Tap to install ${course.title}`
          : course.title
      }
      aria-label={
        placeholder
          ? `Install ${course.title}`
          : `Open ${course.title}`
      }
      aria-busy={loading || installing || undefined}
      disabled={installing}
    >
      {/* The cover image sits absolutely behind the label stack. Using
          <img> (not background-image) so the browser caches it
          properly and shows alt text if it fails to load. */}
      {hasCover && (
        <img
          className="fishbones-book-cover"
          src={coverUrl}
          alt={`${course.title} cover`}
          loading="lazy"
          draggable={false}
          onError={() => setImageError(true)}
        />
      )}

      {/* Fallback tile — language glyph + title + author. Only visible
          when there's no cover image (a CSS class swap handles the
          transition if coverUrl arrives after the first render). */}
      {!hasCover && (
        <div className="fishbones-book-fallback">
          <div className="fishbones-book-fallback-lang" aria-hidden>
            {langGlyph(course.language)}
          </div>
          <div className="fishbones-book-fallback-title">{course.title}</div>
          {course.author && (
            <div className="fishbones-book-fallback-author">
              by {course.author}
            </div>
          )}
        </div>
      )}

      {/* Gradient-over-cover overlay. Sits above the image (below the
          label) so the title stays legible against arbitrary cover art.
          Only shown when there's a cover — fallback tiles already have
          their title baked into the flat design. */}
      {hasCover && (
        <>
          <div className="fishbones-book-shadow" aria-hidden />
          <div className="fishbones-book-label">
            <div className="fishbones-book-title">{course.title}</div>
            {course.author && (
              <div className="fishbones-book-author">{course.author}</div>
            )}
          </div>
        </>
      )}

      {/* Language badge pinned to the top-right corner. Sits above the
          cover gradient so it never gets faded out, but inset by a few
          pixels from the card edge so it reads as a tag, not a sticker
          falling off. */}
      <span
        className="fishbones-book-langbadge"
        style={{ ["--book-langbadge-color" as string]: langMeta.color }}
        title={langMeta.label}
        aria-hidden
      >
        <LangIcon />
      </span>

      {/* Release-status pill in the top-left corner. Tinted bg +
          colored text and glyph (matches the language-badge approach
          of letting brand colour do the visual work). The icon shifts
          per tier \u2014 pencil for ALPHA (drafting), flask for BETA
          (testing), rocket for PRE-RELEASE (launching). */}
      <span
        className={`fishbones-book-status fishbones-book-status--${releaseStatus.toLowerCase()}`}
        title={`${releaseStatus} \u2014 editorial tier`}
      >
        <Icon
          icon={releaseStatusIcon(releaseStatus)}
          size="xs"
          color="currentColor"
          className="fishbones-book-status-icon"
        />
        <span className="fishbones-book-status-label">{releaseStatus}</span>
      </span>

      {/* Challenge-pack tag \u2014 sits below the release-status pill and
          uses the same chip treatment with a soft violet tint so it
          sits distinct from the tier colours (amber ALPHA / emerald
          BETA / slate UNREVIEWED). The `swords` glyph echoes the
          artwork on the challenge-pack cover plates (Rust Challenges
          has a literal crossed-swords specimen drawing), so a learner
          who's seen one card recognises the family on a different one. */}
      {isChallenges && (
        <span
          className="fishbones-book-kind fishbones-book-kind--challenges"
          title="Challenge pack \u2014 exercises only, no readings"
        >
          <Icon
            icon={swords}
            size="xs"
            color="currentColor"
            className="fishbones-book-kind-icon"
          />
          <span className="fishbones-book-kind-label">Challenges</span>
        </span>
      )}

      {/* Progress bar along the very bottom edge. Doubles as the visual
          affordance for "how far you've read". Hidden entirely when
          progress is 0 so untouched books don't show a strip. */}
      {progress > 0 && (
        <div className="fishbones-book-progress" aria-hidden>
          <div
            className="fishbones-book-progress-fill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      {/* Dimmed-cover overlay with the shared Fishbones spinner. Rendered
          while the course's full body is still hydrating — gives the
          learner per-book feedback rather than a single vague app
          spinner. */}
      {loading && (
        <div className="fishbones-book-loading" aria-hidden>
          <FishbonesLoader size="sm" />
        </div>
      )}

      {/* Placeholder install affordance — replaces the update
          badge slot for catalog tiles. Big "+" icon plus
          archive-size hint so the user knows what they're about
          to download. Installing state swaps to a spinner. */}
      {placeholder && (
        <div className="fishbones-book-install" aria-hidden>
          {installing ? (
            <Icon icon={loader} size="sm" color="currentColor" />
          ) : (
            <>
              <Icon icon={arrowDownToLine} size="sm" color="currentColor" />
              <span className="fishbones-book-install-label">install</span>
              {typeof course.archiveSize === "number" && (
                <span className="fishbones-book-install-size">
                  {(course.archiveSize / 1024 / 1024).toFixed(1)} MB
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Update-available badge in the bottom-right corner. Click
          triggers the "Reapply bundled starter" flow via the
          parent's onUpdate. We wrap in a real button (not a span)
          so keyboard users can tab to it; stopPropagation keeps
          the surrounding card's onOpen from firing on the same
          click. While the parent has the sync in flight (`updating`)
          the badge swaps to a spinner + disables itself so the
          user gets feedback and can't re-fire the request. */}
      {(hasUpdate || updating) && onUpdate && (
        <button
          type="button"
          className={`fishbones-book-update ${
            updating ? "fishbones-book-update--working" : ""
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (!updating) onUpdate();
          }}
          disabled={updating}
          title={
            updating
              ? "Updating…"
              : "Update available — reapply bundled course"
          }
          aria-label={
            updating
              ? `Updating ${course.title}`
              : `Update available for ${course.title}`
          }
          aria-busy={updating || undefined}
        >
          <Icon
            icon={updating ? loader : arrowDownToLine}
            size="xs"
            color="currentColor"
          />
          <span className="fishbones-book-update-label">
            {updating ? "updating…" : "update"}
          </span>
        </button>
      )}
    </button>
  );
}

/// Release-status label for a single course tile. The editorial
/// pipeline runs `UNREVIEWED` (drafts; bottom of the library) \u2192
/// `ALPHA` (next up) \u2192 `BETA` (final polish for release; top).
/// Exported so CourseLibrary can use the same rule to group books
/// into sections.
///
/// The label is read from `course.releaseStatus` first (a per-course
/// field on the on-disk `course.json` \u2014 set it there to promote
/// or demote a book without a code change). Books with no field
/// default to `UNREVIEWED` so brand-new imports land at the bottom
/// of the library until they're editorially reviewed.
///
/// Legacy `"PRE-RELEASE"` values from before the rename normalise to
/// `"UNREVIEWED"` here so on-disk data we haven't migrated yet still
/// renders correctly.
export type ReleaseStatus = "UNREVIEWED" | "ALPHA" | "BETA";

export function releaseStatusFor(course: Pick<Course, "id" | "releaseStatus">): ReleaseStatus {
  if (course.releaseStatus === "ALPHA" || course.releaseStatus === "BETA") {
    return course.releaseStatus;
  }
  if (course.releaseStatus === "UNREVIEWED" || course.releaseStatus === "PRE-RELEASE") {
    return "UNREVIEWED";
  }
  return "UNREVIEWED";
}

/// Short identifier rendered in the fallback tile when no cover image is
/// available. We use the uppercase 2-3 letter language code since it
/// doubles as a recognizable hint about what the book teaches.
function langGlyph(lang: LanguageId): string {
  switch (lang) {
    case "javascript":
      return "JS";
    case "typescript":
      return "TS";
    case "python":
      return "PY";
    case "rust":
      return "RS";
    case "swift":
      return "SW";
    case "go":
      return "GO";
    case "web":
      return "WEB";
    case "threejs":
      return "3D";
    case "react":
      return "RX";
    case "reactnative":
      return "RN";
    case "c":
      return "C";
    case "cpp":
      return "C++";
    case "java":
      return "JV";
    case "kotlin":
      return "KT";
    case "csharp":
      return "C#";
    case "assembly":
      return "ASM";
    case "svelte":
      return "SV";
    case "solid":
      return "SO";
    case "htmx":
      return "HX";
    case "astro":
      return "AS";
    case "bun":
      return "BN";
    case "tauri":
      return "TR";
    case "solidity":
      return "SOL";
    case "vyper":
      return "VY";
    // ── 2026 expansion ───────────────────────────────────────
    // Glyphs match the LANG_GLYPHS map in extract-starter-courses.mjs
    // so the synthesised cover JPEG and the no-cover fallback tile
    // show the same abbreviation per language.
    case "ruby":
      return "RB";
    case "lua":
      return "LU";
    case "dart":
      return "DT";
    case "haskell":
      return "HS";
    case "scala":
      return "SC";
    case "sql":
      return "SQL";
    case "elixir":
      return "EX";
    case "zig":
      return "ZG";
    case "move":
      return "MV";
    case "cairo":
      return "CR";
    case "sway":
      return "SW";
  }
}
