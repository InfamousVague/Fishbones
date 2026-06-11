import { memo, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { rocket } from "@base/primitives/icon/icons/rocket";
import { flaskConical } from "@base/primitives/icon/icons/flask-conical";
import { pencilLine } from "@base/primitives/icon/icons/pencil-line";
import { badgeCheck } from "@base/primitives/icon/icons/badge-check";
import { arrowDownToLine } from "@base/primitives/icon/icons/arrow-down-to-line";
import { loader } from "@base/primitives/icon/icons/loader";
import { swords } from "@base/primitives/icon/icons/swords";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import {
  isChallengePack,
  isExerciseTrack,
  isKoans,
  isLings,
} from "../../data/types";
import { useCourseCover } from "../../hooks/useCourseCover";
import LibreLoader from "../Shared/LibreLoader";
import Hologram from "../Shared/Hologram";
import { languageMeta } from "../../lib/languages";
import "./BookCover.css";

/// Deterministic "random" placement for the 100% clear stamp, seeded by
/// the course id. Each book's seal lands at a stable jittered spot near
/// the middle with its own tilt — so it reads as hand-stamped rather than
/// rigidly centred, but never jumps between renders. Returns CSS-ready
/// offsets (% of the cover) + a rotation.
function stampPlacement(id: string): { x: string; y: string; rot: string } {
  // FNV-1a hash → xorshift draws for a few independent 0..1 values.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return (h % 10000) / 10000;
  };
  const x = (unit() * 2 - 1) * 15; // -15%..+15% of cover width
  const y = (unit() * 2 - 1) * 12; // -12%..+12% of cover height
  const rot = (unit() * 2 - 1) * 20; // -20deg..+20deg
  return { x: `${x.toFixed(1)}%`, y: `${y.toFixed(1)}%`, rot: `${rot.toFixed(1)}deg` };
}

/// Pick a glyph that matches the editorial-pipeline metaphor for each
/// tier. Pencil = drafting (unreviewed), flask = next up, rocket =
/// final polish for launch. Exported so CourseLibrary's section
/// header can render the same glyph next to the section title.
export function releaseStatusIcon(status: ReleaseStatus): string {
  switch (status) {
    case "VERIFIED":
      return badgeCheck;
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
  /// When true, dim the cover and render a LibreLoader overlay —
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
  /// Optional inline style — used by CourseLibrary to set the
  /// `--libre-ripple-i` custom property per card so the mount-time
  /// ripple animation staggers across the shelf in index order.
  /// Spread onto the root button; the library's CSS reads the
  /// custom property as `animation-delay`.
  style?: React.CSSProperties;
}

/// Shelf-mode library card. Rendered at roughly 2:3 aspect ratio (the
/// shape of a physical paperback). When the course has an extracted
/// cover PNG, it fills the card; otherwise a solid language-tinted tile
/// with the title overlaid stands in.
///
/// The progress bar sits flush to the bottom of the card and the title
/// fades in from a dark gradient so it stays legible against any cover
/// photo. Hover nudges the card up a few pixels + deepens the shadow.
function BookCoverImpl({
  course,
  progress,
  onOpen,
  onContextMenu,
  loading = false,
  // `hasUpdate` is accepted for backwards-compat with callers but
  // no longer rendered as an inline badge — the indicator + action
  // both live in the right-click context menu now. Suppressed to
  // avoid the unused-variable warning while keeping the prop in the
  // public API.
  hasUpdate: _hasUpdate = false,
  updating = false,
  onUpdate,
  placeholder = false,
  installing = false,
  placeholderCoverUrl,
  onInstall,
  style,
}: Props) {
  // Covers are prefetched in bulk when the library mounts (see
  // `prefetchCovers` in CourseLibrary). This hook reads from the
  // shared cache that prefetch populates — no extra IPC per card.
  //
  // Both installed and placeholder tiles route through useCourseCover.
  // The desktop IPC (`load_course_cover`) falls back to extracting
  // cover.png from the bundled `.libre` archive when the course
  // isn't installed yet, so a Discover placeholder gets the same
  // cover its installed twin would. Web hosts skip the IPC and use
  // the catalog-supplied URL directly via `placeholderCoverUrl`.
  const hookCoverUrl = useCourseCover(course.id, course.coverFetchedAt);
  const coverUrl = hookCoverUrl ?? placeholderCoverUrl;
  // Track image load failures so a 404 / blocked-by-CSP / etc. on
  // the URL falls back to the language-tinted glyph tile rather
  // than rendering Safari's broken-image placeholder. Resets when
  // the URL changes (rare, but happens after a fresh cover fetch).
  const [imageError, setImageError] = useState(false);
  // Progressive blur-up: covers start blurred + dimmed and crisp-fade
  // in once the bytes finish landing. The "loaded" state is committed
  // in the layout-effect below — there's NO separate reset effect
  // because keying both reset + cache-probe on the same dependency
  // produced a stomp where the regular useEffect flipped the value
  // back to false after the layout effect's cache-hit set it true.
  const [imageLoaded, setImageLoaded] = useState(false);

  // Combined reset + cached-image probe.
  //
  // Cached-image edge case: when the browser already has the JPEG in
  // its image cache (after prefetchCovers populated it on app boot,
  // after a previous mount of this card, or after the same URL was
  // visible elsewhere on the page), the <img>'s `load` event fires
  // SYNCHRONOUSLY during the render commit — before React attaches
  // its synthetic onLoad listener. The prop's handler never fires,
  // imageLoaded stays false, and the cover stays at the loading-
  // state CSS (filter: blur(16px) + scale(1.05) + opacity 0.65) for
  // the lifetime of the component.
  //
  // Fix: probe `img.complete` (the DOM property that reports "the
  // image's data is already there") via useLayoutEffect — runs
  // post-DOM-mutate, pre-paint, so we commit the correct state
  // before the first paint. Also subsumes the URL-change reset
  // (cold-load path sets imageLoaded=false here) so we never have
  // two effects fighting over the same flag.
  //
  // Why this bug surfaced now: I added a CDN-fallback path in
  // useCourseCover so placeholder books point at HTTPS URLs the
  // browser caches aggressively. On first launch, prefetchCovers
  // primes the cache while the splash is up; by the time Library
  // mounts BookCover, the GETs return synchronously from cache and
  // React loses the load-event race.
  const imgRef = useRef<HTMLImageElement | null>(null);
  useLayoutEffect(() => {
    setImageError(false);
    if (!coverUrl) {
      setImageLoaded(false);
      return;
    }
    const img = imgRef.current;
    if (!img) {
      // <img> hasn't rendered yet (initial mount with hasCover
      // false, etc.). Cold-load state — onLoad will fire when the
      // element materialises.
      setImageLoaded(false);
      return;
    }
    if (img.complete && img.naturalWidth > 0) {
      // Already decoded. Skip the blur-up — running a one-shot
      // CSS transition on an image that's already on screen reads
      // as latency on a cold launch when the JPEG was ready
      // instantly.
      setImageLoaded(true);
    } else if (img.complete && img.naturalWidth === 0) {
      // `complete` is true but no pixels = decode failure (404,
      // CSP block, malformed). Match the onError fallback path.
      setImageError(true);
      setImageLoaded(false);
    } else {
      // Cold load — start blurry. onLoad will crisp-fade.
      setImageLoaded(false);
    }
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

  // 100%-cleared books get a hand-stamped holographic seal. Compute its
  // seeded placement once per render (cheap; stable per course id).
  const stamp = progress >= 1 ? stampPlacement(course.id) : null;

  // Whether this card is a challenge pack vs. a tutorial book —
  // surfaces a small "Challenges" chip in the corner so a learner
  // scanning the shelf can tell exercises-only packs apart from
  // long-form prose books at a glance. Read off the same `packType`
  // field the Library kindFilter uses.
  const isChallenges = isChallengePack(course);

  // Practice packs (challenge packs, Exercism tracks, koans, *lings)
  // render as SQUARE tiles instead of 2:3 paperbacks — their cover
  // art is authored 1:1 (mission-patch / badge style) so a learner
  // can tell drill packs from prose books by silhouette alone. The
  // class only changes the aspect ratio; all the chrome (status
  // banner, language badge, kind chip, progress) lays out the same.
  const isSquarePack =
    isChallenges ||
    isExerciseTrack(course) ||
    isKoans(course) ||
    isLings(course);

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
      style={style}
      className={`libre-book ${
        hasCover ? "libre-book--has-cover" : "libre-book--no-cover"
      } libre-book--lang-${course.language} ${
        loading ? "libre-book--loading" : ""
      } ${placeholder ? "libre-book--placeholder" : ""} ${
        installing ? "libre-book--installing" : ""
      } ${isSquarePack ? "libre-book--square" : ""}`}
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
          ref={imgRef}
          className={`libre-book-cover ${
            imageLoaded ? "libre-book-cover--loaded" : "libre-book-cover--loading"
          }`}
          src={coverUrl}
          alt={`${course.title} cover`}
          loading="lazy"
          // `decoding="async"` lets the browser decode off the main
          // thread, so a 1MB JPEG doesn't block paint while it parses.
          // Combined with the blur-up CSS this yields the iOS
          // Photos-style "appears blurry, sharpens in" effect for free.
          decoding="async"
          draggable={false}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      )}

      {/* Fallback tile — language glyph + title + author. Only visible
          when there's no cover image (a CSS class swap handles the
          transition if coverUrl arrives after the first render). */}
      {!hasCover && (
        <div className="libre-book-fallback">
          <div className="libre-book-fallback-lang" aria-hidden>
            {langGlyph(course.language)}
          </div>
          <div className="libre-book-fallback-title">{course.title}</div>
          {course.author && (
            <div className="libre-book-fallback-author">
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
          <div className="libre-book-shadow" aria-hidden />
          <div className="libre-book-label">
            <div className="libre-book-title">{course.title}</div>
            {course.author && (
              <div className="libre-book-author">{course.author}</div>
            )}
          </div>
        </>
      )}

      {/* Language badge pinned to the top-right corner. Sits above the
          cover gradient so it never gets faded out, but inset by a few
          pixels from the card edge so it reads as a tag, not a sticker
          falling off. */}
      <span
        className="libre-book-langbadge"
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
        className={`libre-book-status libre-book-status--${releaseStatus.toLowerCase()}`}
        title={`${releaseStatus} \u2014 editorial tier`}
      >
        <Icon
          icon={releaseStatusIcon(releaseStatus)}
          size="xs"
          color="currentColor"
          className="libre-book-status-icon"
        />
        <span className="libre-book-status-label">{releaseStatus}</span>
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
          className="libre-book-kind libre-book-kind--challenges"
          title="Challenge pack \u2014 exercises only, no readings"
        >
          <Icon
            icon={swords}
            size="xs"
            color="currentColor"
            className="libre-book-kind-icon"
          />
          <span className="libre-book-kind-label">Challenges</span>
        </span>
      )}

      {/* Holographic "100%" clear stamp — a white snake-foil seal
          slapped on the cover once every lesson is complete. Seeded
          jitter (position + rotation per book) reads as hand-stamped;
          the snake iridescence drifts on the white base while the
          "100%" stays static black for legibility. */}
      {stamp && (
        <div
          className="libre-book-clear-stamp"
          style={{
            ["--stamp-x" as string]: stamp.x,
            ["--stamp-y" as string]: stamp.y,
            ["--stamp-rot" as string]: stamp.rot,
          }}
          aria-label="100% cleared"
        >
          <Hologram
            surface="light"
            intensity="vivid"
            sparkle="snake"
            size="sm"
            ambient
          />
          <span className="libre-book-clear-stamp__pct">100%</span>
        </div>
      )}

      {/* Progress bar along the very bottom edge. Doubles as the visual
          affordance for "how far you've read". Hidden entirely when
          progress is 0 so untouched books don't show a strip. */}
      {progress > 0 && (
        <div className="libre-book-progress" aria-hidden>
          <div
            className="libre-book-progress-fill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}

      {/* Dimmed-cover overlay with the shared Libre spinner. Rendered
          while the course's full body is still hydrating — gives the
          learner per-book feedback rather than a single vague app
          spinner. */}
      {loading && (
        <div className="libre-book-loading" aria-hidden>
          <LibreLoader size="sm" />
        </div>
      )}

      {/* Placeholder install affordance — replaces the update
          badge slot for catalog tiles. Big "+" icon plus
          archive-size hint so the user knows what they're about
          to download. Installing state swaps to a spinner. */}
      {placeholder && (
        <div className="libre-book-install" aria-hidden>
          {installing ? (
            <Icon icon={loader} size="sm" color="currentColor" />
          ) : (
            <>
              <Icon icon={arrowDownToLine} size="sm" color="currentColor" />
              <span className="libre-book-install-label">install</span>
              {typeof course.archiveSize === "number" && (
                <span className="libre-book-install-size">
                  {(course.archiveSize / 1024 / 1024).toFixed(1)} MB
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Reinstall / update affordance moved to the right-click
          context menu (`CourseContextMenu`). Pre-fix every installed
          tile carried a small "reinstall" button bottom-right; the
          button competed with the cover art and was visible even when
          there was nothing meaningful to do (idempotent re-extract).
          The context menu now hosts both the manual reinstall and the
          "update available" reapply, with the menu item label
          switching based on `hasUpdate`. */}
      {!placeholder && onUpdate && updating && (
        /* Mid-update overlay — small spinner pinned bottom-right so
           the learner knows the chain is busy. Stays visible because
           there's no cover-level alternative once the menu has
           dismissed. */
        <span
          className="libre-book-update libre-book-update--working"
          aria-busy="true"
          aria-label={`Updating ${course.title}`}
        >
          <Icon icon={loader} size="xs" color="currentColor" />
          <span className="libre-book-update-label">updating…</span>
        </span>
      )}
    </button>
  );
}

/// Memo-wrapped — the library re-renders BookCovers for every shelf
/// row on every filter / sort / search keystroke. Without this each
/// pass walks every cover's render function (which touches a few
/// stateful pieces — image-load, ribbon hover, etc.) even when the
/// course props haven't changed.
const BookCover = memo(BookCoverImpl);
export default BookCover;

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
export type ReleaseStatus = "VERIFIED" | "UNREVIEWED" | "ALPHA" | "BETA";

export function releaseStatusFor(course: Pick<Course, "id" | "releaseStatus">): ReleaseStatus {
  if (
    course.releaseStatus === "VERIFIED" ||
    course.releaseStatus === "ALPHA" ||
    course.releaseStatus === "BETA"
  ) {
    return course.releaseStatus;
  }
  if (course.releaseStatus === "UNREVIEWED" || course.releaseStatus === "PRE-RELEASE") {
    return "UNREVIEWED";
  }
  return "UNREVIEWED";
}

/// Status rank for the library's "Status" sort — higher wins (floats
/// to the top). VERIFIED is the ceiling so verified books lead the
/// shelf; UNREVIEWED drafts sink to the bottom.
export const RELEASE_STATUS_RANK: Record<ReleaseStatus, number> = {
  VERIFIED: 3,
  BETA: 2,
  ALPHA: 1,
  UNREVIEWED: 0,
};

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
    case "clojure":
      return "CLJ";
    case "fsharp":
      return "F#";
  }
}
