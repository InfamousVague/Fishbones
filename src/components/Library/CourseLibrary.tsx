import { useEffect, useMemo, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import { isChallengePack } from "../../data/types";
import BookCover from "./BookCover";
import CourseContextMenu, { useCourseMenu } from "../Shared/CourseContextMenu";
import { prefetchCovers } from "../../hooks/useCourseCover";
import { useCourseUpdates } from "../../hooks/useCourseUpdates";
import { useCatalog } from "../../hooks/useCatalog";
import { useLocalStorageState } from "../../hooks/useLocalStorageState";
import {
  placeholderCourseFromCatalog,
  coverHref,
  type CatalogEntry,
} from "../../lib/catalog";
import AddCourseButton from "./AddCourseButton";
import CourseCard from "./CourseCard";
import LibraryControls, {
  type SortKey,
  type ViewMode,
} from "./LibraryControls";
import {
  categorizeCourse,
  cryptoChain,
  dedupeChallengePacks,
  type CourseCategory,
  type CryptoChain,
} from "./categorize";
import "./CourseLibrary.css";

/// Library display mode persistence key. `shelf` = tall 2:3 book-cover
/// cards. `grid` (the default) = the information-dense card grid.
/// User's choice persists in localStorage.
///
/// Default is grid (info-dense). Users who explicitly picked shelf
/// (and persisted that pick) keep it; everyone else — first-time
/// visitors AND people who never touched the toggle — lands on grid.
/// Inverted from the original "shelf default" after user feedback that
/// the dense-info card view is more useful at a glance for someone
/// deciding what to open.
const VIEW_MODE_STORAGE_KEY = "fishbones:library-view-mode";
const VIEW_MODE_DEFAULT: ViewMode = "grid";

interface Props {
  courses: Course[];
  completed: Set<string>;
  /// Course ids whose full body is still hydrating from disk. Covers for
  /// these ids get a dimmed + spinner overlay. Optional — when omitted,
  /// no covers show a loading state.
  hydrating?: Set<string>;
  onDismiss: () => void;
  onOpen: (courseId: string) => void;
  /// Opens the PDF import wizard. Optional — hidden when the host
  /// can't run the AI-assisted ingest pipeline (e.g. the web build).
  onImport?: () => void;
  /// Opens the multi-PDF bulk import wizard — the learner can queue several
  /// books at once for unattended processing. Optional — hidden when the
  /// host app doesn't support bulk imports (e.g. web build).
  onBulkImport?: () => void;
  /// Opens the docs-site import dialog — crawl a documentation URL
  /// and generate a course from its pages. Optional; hidden when not
  /// wired by the host (keeps this component useful in tests / web
  /// previews that don't have the Tauri crawl command available).
  onDocsImport?: () => void;
  /// Opens a file picker for a previously-exported `.fishbones` (or legacy
  /// `.kata`) archive and unzips it into the courses dir. Optional — when omitted the button
  /// is hidden (e.g. in environments where the Tauri dialog plugin isn't
  /// available).
  onImportArchive?: () => void;
  onExport?: (courseId: string, courseTitle: string) => void;
  onDelete?: (courseId: string, courseTitle: string) => void;
  /// Opens the per-course settings modal. When wired, right-clicking
  /// any cover in the library (shelf or grid) surfaces a context menu
  /// with Settings / Export / Delete mirroring the sidebar UX.
  onSettings?: (courseId: string) => void;
  /// Bulk-export every course in the library to a chosen directory.
  /// When wired, renders an "Export all" button in the header next to
  /// the Import cluster. Skipped when the host doesn't offer it (e.g.
  /// the web-preview build with no filesystem access).
  onBulkExport?: () => void;
  /// Reapply the bundled `public/starter-courses/<id>.json` over the
  /// installed copy. Wired by App.tsx to `syncBundledToInstalled` +
  /// `refreshCourses`. When supplied, the library shows an "update
  /// available" badge on every course whose bundled hash differs
  /// from its `bundleSha`. Click → run this handler. Optional —
  /// hidden cleanly when the host doesn't wire it (e.g. tests).
  onUpdateCourse?: (courseId: string) => Promise<void> | void;
  /// Smart "Add course" entry point. Opens an OS file picker with
  /// all supported formats (.pdf, .epub, .fishbones, .kata, .zip,
  /// .json) and dispatches each picked file to the right pipeline.
  /// When supplied, replaces the old 4-segment Book / Bulk books /
  /// Docs site / Archive cluster with a single split button. The
  /// dropdown still surfaces the explicit options for users who
  /// want them.
  onAddCourse?: () => void;
  /// Opens the catalog browser modal — search the official Fishbones
  /// library and install courses the user doesn't have yet. Distinct
  /// from `onAddCourse` (which is for files the user already has on
  /// disk) and from `onInstallCatalogEntry` (the lower-level install
  /// primitive that the browser modal calls).
  onBrowseCatalog?: () => void;
  /// Install a remote-catalog placeholder. Wired by App.tsx to fetch
  /// the .fishbones archive (desktop) or course JSON (web), persist
  /// it via storage.saveCourse, then refresh the in-memory list so
  /// the placeholder is replaced with the real installed cover. When
  /// omitted the Library still renders catalog placeholders, but
  /// they're inert (clicking does nothing).
  onInstallCatalogEntry?: (entry: CatalogEntry) => Promise<void> | void;
  /// "modal" (default) — centered overlay with a dimmed backdrop; closed
  /// via the × button or clicking the backdrop.
  /// "inline" — renders inside the current container with no backdrop,
  /// suitable for the "no-tabs-open" empty state. The close × is hidden
  /// since there's no underlying view to return to.
  mode?: "modal" | "inline";
  /// Which slice of the catalog to render. "library" (default) shows
  /// the user's INSTALLED courses only; "discover" shows the catalog
  /// PLACEHOLDERS only (with install buttons on each tile). The
  /// component is rendered with `scope="library"` from the Library
  /// route in the sidebar and `scope="discover"` from the Discover
  /// route, so the two surfaces share filter / search / view-mode
  /// machinery without mixing their content.
  scope?: "library" | "discover";
}

/// Browse-all-courses screen. Full-pane modal with language filter chips,
/// sort dropdown, and a responsive grid of course cards. Each card shows
/// progress + lesson count and offers Open / Export / Delete via a hover
/// action row. Empty state invites the user to import their first book.
export default function CourseLibrary({
  courses,
  completed,
  hydrating,
  onDismiss,
  onOpen,
  onImport,
  onBulkImport,
  onDocsImport,
  onImportArchive,
  onExport,
  onDelete,
  onSettings,
  onBulkExport,
  onUpdateCourse,
  onAddCourse,
  onBrowseCatalog,
  onInstallCatalogEntry,
  mode = "modal",
  scope = "library",
}: Props) {
  const isInline = mode === "inline";
  const ctxMenu = useCourseMenu();
  // Top-level domain filter — All / Crypto / Programming. Sits above
  // the language pills so picking "Crypto" narrows everything below
  // to blockchain material, then language pills further refine within
  // that scope.
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | CourseCategory
  >("all");
  // Chain sub-filter, only visible when categoryFilter === "crypto".
  // Reset to "all" any time the user navigates away from Crypto.
  const [chainFilter, setChainFilter] = useState<"all" | CryptoChain>("all");
  const [langFilter, setLangFilter] = useState<"all" | LanguageId>("all");
  // Kind toggle — separate the two course archetypes the library
  // mixes today: full-length books (chapter-major prose with
  // exercises) vs handcrafted challenge packs (flat list of
  // increasing-difficulty exercises). The default is "all" so a fresh
  // visit shows everything; toggling restricts to one bucket.
  const [kindFilter, setKindFilter] = useState<"all" | "books" | "challenges">(
    "all",
  );
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>(
    VIEW_MODE_STORAGE_KEY,
    VIEW_MODE_DEFAULT,
    {
      // String values (not JSON-objects) — store/read raw so users
      // who manually peek at localStorage see `"shelf"` rather than
      // `"\"shelf\""`. Validate the read so legacy / corrupt values
      // fall back to the default rather than rendering as `undefined`.
      serialize: (v) => v,
      deserialize: (raw) => (raw === "shelf" ? "shelf" : "grid"),
    },
  );

  // Warm the module-level cover cache up front so each BookCover
  // pulls from a cache hit instead of firing its own IPC. Fire-and-
  // forget — we used to gate a full-page overlay on this resolving,
  // but the overlay flashed on every window-refocus (since the
  // effect re-ran and the prefetch resolved synchronously from the
  // cache the second+ time, briefly toggling false → true). Each
  // BookCover already has a per-card loading affordance for the
  // rare un-prefetched first paint — that's plenty.
  useEffect(() => {
    if (courses.length === 0) return;
    void prefetchCovers(
      courses.map((c) => ({ courseId: c.id, cacheBust: c.coverFetchedAt })),
    );
  }, [courses]);

  // Per-course "update available" map. Each course's bundled JSON
  // gets fetched + hashed on mount; cells with the badge fire
  // `onUpdateCourse` when clicked. The hook also exposes `recheck`
  // so we can clear the badge immediately after a successful update
  // instead of waiting for the next mount.
  const { updates, recheck } = useCourseUpdates(courses);

  // Remote-catalog entries — anything in the catalog that isn't
  // already installed gets rendered as a semi-opaque placeholder
  // tile. The catalog is fetched once per app session (cached in
  // src/lib/catalog.ts).
  const { catalog } = useCatalog();
  const installedIds = useMemo(
    () => new Set(courses.map((c) => c.id)),
    [courses],
  );
  const placeholderEntries = useMemo(
    () => catalog.filter((e) => !installedIds.has(e.id)),
    [catalog, installedIds],
  );
  const placeholderCourses = useMemo(
    () => placeholderEntries.map(placeholderCourseFromCatalog),
    [placeholderEntries],
  );
  // Map id → catalog entry for the install click handler — we need
  // the original entry (with archiveUrl, file, etc.), not just the
  // synthetic placeholder Course.
  const entryById = useMemo(() => {
    const m = new Map<string, CatalogEntry>();
    for (const e of catalog) m.set(e.id, e);
    return m;
  }, [catalog]);

  // Per-course "currently installing" tracker so the placeholder
  // tile can show a spinner + disable click while a download is in
  // flight. Mirrors the updatingIds pattern below.
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  const handleInstallClick = async (courseId: string) => {
    if (!onInstallCatalogEntry) return;
    if (installingIds.has(courseId)) return;
    const entry = entryById.get(courseId);
    if (!entry) return;
    setInstallingIds((prev) => {
      const next = new Set(prev);
      next.add(courseId);
      return next;
    });
    try {
      await onInstallCatalogEntry(entry);
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    }
  };

  // Per-course "currently updating" tracker so the cover badge can
  // render a spinner + disable clicks while a sync is in-flight.
  // Without this the user got zero feedback during the multi-second
  // fetch + write + hydrate cycle and tended to click the badge
  // again, which is a no-op (the handler ignores re-entry) but felt
  // like nothing was happening.
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const handleUpdateClick = async (courseId: string) => {
    if (!onUpdateCourse) return;
    if (updatingIds.has(courseId)) return; // re-entry guard
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.add(courseId);
      return next;
    });
    try {
      await onUpdateCourse(courseId);
      await recheck(courseId);
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    }
  };

  // Pre-compute per-course progress so sorting + display share one walk.
  // Scope-aware on purpose: in `library` scope `enriched` only carries
  // installed courses; in `discover` scope it only carries the catalog
  // placeholders. Doing the split HERE (rather than relying on a
  // downstream `.filter(scope ? ... )`) guarantees a placeholder can
  // never leak into a library render even if a later filter is
  // skipped or rewritten — a defensive belt-and-suspenders after a
  // bug report where switching Discover → Library briefly showed
  // uninstalled tiles in the library view.
  const enriched = useMemo(() => {
    if (scope === "discover") {
      return placeholderCourses.map((c) => ({
        course: c,
        total: 0,
        done: 0,
        pct: 0,
      }));
    }
    // Library-side dedupe by (language, packType) for challenge packs.
    // The auto-gen-challenges flow used to mint nanoID-suffixed packs
    // (`challenges-go-mo9kijkd`) that survived alongside the canonical
    // `challenges-go-handwritten` ones, producing visible duplicates
    // in the Library grid. Prefer the `-handwritten`-suffixed canonical
    // version when both are installed; fall back to alphabetical id
    // when neither matches the canonical naming.
    const dedupedCourses = dedupeChallengePacks(courses);
    return dedupedCourses.map((c) => {
      let total = 0;
      let done = 0;
      for (const ch of c.chapters) {
        for (const l of ch.lessons) {
          total += 1;
          if (completed.has(`${c.id}:${l.id}`)) done += 1;
        }
      }
      return {
        course: c,
        total,
        done,
        pct: total > 0 ? done / total : 0,
      };
    });
  }, [scope, courses, completed, placeholderCourses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      // Belt + suspenders: the scope-aware `enriched` above already
      // partitions installed vs placeholder, but keeping the
      // explicit filter here means an accidental future change to
      // `enriched` can't silently mix the two surfaces.
      .filter((e) =>
        scope === "discover" ? !!e.course.placeholder : !e.course.placeholder,
      )
      .filter(
        (e) =>
          categoryFilter === "all" ||
          categorizeCourse(e.course) === categoryFilter,
      )
      // Chain filter only takes effect when category is crypto —
      // there's no chain on a programming course to compare against.
      .filter(
        (e) =>
          categoryFilter !== "crypto" ||
          chainFilter === "all" ||
          cryptoChain(e.course) === chainFilter,
      )
      .filter((e) => langFilter === "all" || e.course.language === langFilter)
      .filter((e) => {
        if (kindFilter === "all") return true;
        const isPack = isChallengePack(e.course);
        return kindFilter === "challenges" ? isPack : !isPack;
      })
      .filter((e) =>
        q === ""
          ? true
          : e.course.title.toLowerCase().includes(q) ||
            (e.course.author ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => {
        switch (sortBy) {
          case "progress":
            return b.pct - a.pct;
          case "lessons":
            return b.total - a.total;
          case "name":
          default:
            return a.course.title.localeCompare(b.course.title);
        }
      });
  }, [
    enriched,
    scope,
    categoryFilter,
    chainFilter,
    langFilter,
    kindFilter,
    sortBy,
    query,
  ]);

  // Group filtered courses by KIND — "Books" (chapter-major prose
  // with exercises) up top, "Challenges" (flat list of
  // increasing-difficulty exercises) at the bottom. The split is
  // visual + structural: a learner browsing the library sees
  // courses-they-will-read first, code-katas second. We dropped the
  // earlier release-status bucketing (BETA / ALPHA / UNREVIEWED)
  // here — that's editorial chrome, not reader-facing structure.
  const sections = useMemo(() => {
    const books: typeof filtered = [];
    const challenges: typeof filtered = [];
    for (const e of filtered) {
      if (isChallengePack(e.course)) challenges.push(e);
      else books.push(e);
    }
    const out: Array<{ key: string; label: string; blurb: string; rows: typeof filtered }> = [];
    if (books.length > 0) {
      out.push({
        key: "books",
        label: "Books",
        blurb: "Long-form courses with chapters and exercises.",
        rows: books,
      });
    }
    if (challenges.length > 0) {
      out.push({
        key: "challenges",
        label: "Challenges",
        blurb: "Per-language exercise packs — short coding problems sorted easy → hard.",
        rows: challenges,
      });
    }
    return out;
  }, [filtered]);

  // Count courses per category so the top-level toggle can show
  // badges. Always uses the full enriched set — the badge needs to
  // tell you "how many crypto courses TOTAL exist", regardless of
  // the lang/kind narrowing further down.
  const categoryCounts = useMemo(() => {
    let crypto = 0;
    let programming = 0;
    for (const e of enriched) {
      if (categorizeCourse(e.course) === "crypto") crypto += 1;
      else programming += 1;
    }
    return { crypto, programming, all: crypto + programming };
  }, [enriched]);

  // Count courses per chain WITHIN the crypto subset. Used to render
  // the chain pills (Bitcoin / Ethereum / Solana / Other). Always
  // ignores the chain filter itself — otherwise picking "Bitcoin"
  // would zero out every other pill's count.
  const chainCounts = useMemo(() => {
    const m = new Map<CryptoChain, number>();
    let total = 0;
    for (const e of enriched) {
      if (categorizeCourse(e.course) !== "crypto") continue;
      const chain = cryptoChain(e.course);
      m.set(chain, (m.get(chain) ?? 0) + 1);
      total += 1;
    }
    return { byChain: m, all: total };
  }, [enriched]);

  // Count courses per language so the filter chips can show badges and
  // hide languages with zero courses (unless they're the active filter).
  // Counts are scoped to the active category + chain — picking
  // "Crypto > Ethereum" hides Python (since no Ethereum-Python course
  // exists), keeps Solidity / TypeScript visible.
  const countByLang = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of enriched) {
      if (
        categoryFilter !== "all" &&
        categorizeCourse(e.course) !== categoryFilter
      ) {
        continue;
      }
      if (
        categoryFilter === "crypto" &&
        chainFilter !== "all" &&
        cryptoChain(e.course) !== chainFilter
      ) {
        continue;
      }
      m.set(e.course.language, (m.get(e.course.language) ?? 0) + 1);
    }
    return m;
  }, [enriched, categoryFilter, chainFilter]);

  // Count books vs challenges so the kind toggle can show badges. Only
  // counts within the current category + chain + language filters so
  // the numbers track what's actually visible after upstream filters
  // narrow the set.
  const kindCounts = useMemo(() => {
    let books = 0;
    let challenges = 0;
    for (const e of enriched) {
      if (
        categoryFilter !== "all" &&
        categorizeCourse(e.course) !== categoryFilter
      ) {
        continue;
      }
      if (
        categoryFilter === "crypto" &&
        chainFilter !== "all" &&
        cryptoChain(e.course) !== chainFilter
      ) {
        continue;
      }
      if (langFilter !== "all" && e.course.language !== langFilter) continue;
      if (isChallengePack(e.course)) challenges += 1;
      else books += 1;
    }
    return { books, challenges, all: books + challenges };
  }, [enriched, categoryFilter, chainFilter, langFilter]);

  // The panel content is identical in both modes; only the wrapper differs:
  // modal wraps with a full-viewport backdrop, inline just renders in place.
  const panel = (
    <div
      className={`fishbones-library-panel ${isInline ? "fishbones-library-panel--inline" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="fishbones-library-header">
          <div className="fishbones-library-titleblock">
            <span className="fishbones-library-title">
              {scope === "discover" ? "Discover" : "Library"}
            </span>
            <span className="fishbones-library-subtitle">
              {scope === "discover"
                ? `${placeholderCourses.length} book${placeholderCourses.length === 1 ? "" : "s"} available to install`
                : `${courses.length} course${courses.length === 1 ? "" : "s"} on this machine`}
            </span>
          </div>
          <div className="fishbones-library-header-actions">
            {/* Single "Import" label + a segmented cluster of destinations.
                Beats repeating "Import from PDF…", "Import archive…",
                "Bulk import…" three times — the label answers "what do
                these buttons do" once; each segment is just the NAME of
                the thing being imported. */}
            {/* Single "Add course" split button replaces the old
                four-button cluster. The smart-pick path covers PDFs,
                EPUBs, archives and JSON exports; the dropdown caret
                surfaces the explicit alternatives (bulk wizard,
                docs URL, archive picker) for users who want them. */}
            {onAddCourse && (
              <AddCourseButton
                onSmartPick={onAddCourse}
                onBulkPdfs={onBulkImport}
                onDocsUrl={onDocsImport}
                onArchive={onImportArchive}
                onBrowseCatalog={onBrowseCatalog}
              />
            )}
            {/* On web (no onAddCourse), still surface the catalog
                browser as a standalone button — web users can't
                import files from disk, but they should still be
                able to add catalog books. */}
            {!onAddCourse && onBrowseCatalog && (
              <button
                type="button"
                className="fishbones-library-import"
                onClick={onBrowseCatalog}
              >
                Browse catalog
              </button>
            )}
            {/* Fallback: when the host hasn't wired the new
                onAddCourse handler (e.g. on web build, or in
                tests), fall back to the legacy "Book" button so
                the library still has a visible import entry. */}
            {!onAddCourse && onImport && (
              <button
                className="fishbones-library-import-seg fishbones-library-import-seg--primary"
                onClick={onImport}
                title="Run the AI pipeline on a PDF or EPUB to generate a course"
              >
                Import book…
              </button>
            )}
            {onBulkExport && (
              <button
                className="fishbones-library-bulk-export"
                onClick={onBulkExport}
                disabled={filtered.length === 0 && courses.length === 0}
                title="Export every course in the library as .fishbones archives to a folder of your choice"
              >
                Export all
              </button>
            )}
            {!isInline && (
              <button className="fishbones-library-close" onClick={onDismiss} aria-label="Close">
                ×
              </button>
            )}
          </div>
        </div>

        {courses.length > 0 && (
          <LibraryControls
            // ── filter state ──
            categoryFilter={categoryFilter}
            chainFilter={chainFilter}
            langFilter={langFilter}
            kindFilter={kindFilter}
            // ── filter setters (each clears downstream as needed) ──
            onSetCategory={(c) => {
              setCategoryFilter(c);
              setChainFilter("all");
              setLangFilter("all");
            }}
            onSetChain={(c) => {
              setChainFilter(c);
              setLangFilter("all");
            }}
            onSetLang={setLangFilter}
            onSetKind={setKindFilter}
            // ── counts (drive both badges and visibility rules) ──
            categoryCounts={categoryCounts}
            chainCounts={chainCounts}
            countByLang={countByLang}
            kindCounts={kindCounts}
            totalCourses={courses.length}
            // ── tools ──
            query={query}
            onSetQuery={setQuery}
            sortBy={sortBy}
            onSetSort={setSortBy}
            viewMode={viewMode}
            onSetViewMode={setViewMode}
          />
        )}

        {/*
          "Update all" banner. Surfaces above the grid when one or more
          installed courses have a pending update (the same condition
          that makes individual book covers show their per-tile Update
          badge). Sums the badges into a single click so a learner who
          launches after a long break doesn't have to update each book
          one-at-a-time.

          Pending updates are computed from the same `updates` map the
          per-cover badges read, minus anything already in flight via
          `updatingIds`. This avoids re-firing in-flight syncs and
          gives the banner a real-time count as updates complete.
        */}
        <div className="fishbones-library-body">
          {/* Update-all banner. Rendered INSIDE the body (not as a
              sibling above) so its absolute positioning anchors to
              the scroll container — that lets the banner float
              over the first card row without pushing the grid down,
              which the user wants ("floats on top of the library
              without the background"). The body already has
              position: relative for similar reasons. */}
          {(() => {
            const pendingIds = Object.entries(updates)
              .filter(([id, hasUpdate]) => hasUpdate && !updatingIds.has(id))
              .map(([id]) => id);
            const inflightCount = courses.filter((c) => updatingIds.has(c.id)).length;
            if (pendingIds.length === 0 && inflightCount === 0) return null;
            const allBusy = pendingIds.length === 0 && inflightCount > 0;
            // Update sequentially so we don't hammer the disk + render
            // path with N parallel writes; the per-book sync also reads
            // a fresh disk snapshot which serial cadence keeps simple.
            const updateAll = async () => {
              for (const id of pendingIds) {
                await handleUpdateClick(id);
              }
            };
            return (
              <div
                className="fishbones-library-update-banner"
                role="status"
                aria-live="polite"
              >
                <div className="fishbones-library-update-banner-text">
                  {allBusy
                    ? `Updating ${inflightCount} ${inflightCount === 1 ? "book" : "books"}…`
                    : `${pendingIds.length} ${pendingIds.length === 1 ? "book has" : "books have"} updates available${inflightCount > 0 ? ` · ${inflightCount} in progress` : ""}`}
                </div>
                <button
                  type="button"
                  className="fishbones-library-update-banner-btn"
                  onClick={updateAll}
                  disabled={allBusy || pendingIds.length === 0}
                  title="Re-sync each updated book against its bundled source"
                >
                  {allBusy ? "Updating…" : `Update all (${pendingIds.length})`}
                </button>
              </div>
            );
          })()}

          {courses.length === 0 ? (
            <div className="fishbones-library-empty">
              <div className="fishbones-library-empty-glyph" aria-hidden>
                <Icon icon={libraryBig} size="2xl" color="currentColor" weight="light" />
              </div>
              <div className="fishbones-library-empty-title">No courses yet</div>
              <div className="fishbones-library-empty-blurb">
                {onImport
                  ? "Import your first book to get started. Fishbones splits a PDF or EPUB into lessons and generates exercises with the Claude API, or you can import a `.fishbones` course someone else shared."
                  : "Sign in to sync courses from another device, or grab the desktop app to ingest your own books."}
              </div>
              <div className="fishbones-library-empty-actions">
                {onImport ? (
                  <button className="fishbones-library-empty-primary" onClick={onImport}>
                    Import a book…
                  </button>
                ) : (
                  <a
                    className="fishbones-library-empty-primary"
                    href="https://github.com/InfamousVague/Kata/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get the desktop app
                  </a>
                )}
                {onImportArchive && (
                  <button
                    className="fishbones-library-empty-secondary"
                    onClick={onImportArchive}
                  >
                    Import .fishbones archive…
                  </button>
                )}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="fishbones-library-empty">
              <div className="fishbones-library-empty-title">No matches</div>
              <div className="fishbones-library-empty-blurb">
                Try clearing the filter or searching for a different title.
              </div>
            </div>
          ) : viewMode === "shelf" ? (
            // Shelf mode — each release-status tier gets its own
            // labelled section. Section heading + blurb sit above the
            // cover grid; the inner .fishbones-library-shelf keeps its
            // original layout so card sizing is unchanged.
            <div className="fishbones-library-sections">
              {sections.map((sec) => (
                <section
                  key={sec.key}
                  className={`fishbones-library-section fishbones-library-section--${sec.key}`}
                  aria-label={sec.label}
                >
                  <header className="fishbones-library-section-head">
                    <h2 className="fishbones-library-section-title">
                      {sec.label}
                    </h2>
                    <span className="fishbones-library-section-count">
                      {sec.rows.length}
                    </span>
                    <span className="fishbones-library-section-blurb">
                      {sec.blurb}
                    </span>
                  </header>
                  <div className="fishbones-library-shelf">
                    {sec.rows.map((e) => (
                      <BookCover
                        key={e.course.id}
                        course={e.course}
                        progress={e.pct}
                        loading={hydrating?.has(e.course.id)}
                        onOpen={() => onOpen(e.course.id)}
                        onContextMenu={
                          // Placeholders have no installed-course
                          // context menu (Export / Delete / Settings
                          // need an installed copy on disk).
                          !e.course.placeholder &&
                          (onExport || onDelete || onSettings)
                            ? (ev) => ctxMenu.show(e.course, ev)
                            : undefined
                        }
                        hasUpdate={
                          !e.course.placeholder &&
                          !!onUpdateCourse &&
                          !!updates[e.course.id]
                        }
                        updating={updatingIds.has(e.course.id)}
                        onUpdate={
                          !e.course.placeholder && onUpdateCourse
                            ? () => void handleUpdateClick(e.course.id)
                            : undefined
                        }
                        placeholder={e.course.placeholder}
                        installing={installingIds.has(e.course.id)}
                        placeholderCoverUrl={
                          e.course.placeholder
                            ? coverHref(entryById.get(e.course.id)!)
                            : undefined
                        }
                        onInstall={
                          e.course.placeholder && onInstallCatalogEntry
                            ? () => void handleInstallClick(e.course.id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            // Grid mode — same sectioning rule, different inner layout.
            <div className="fishbones-library-sections">
              {sections.map((sec) => (
                <section
                  key={sec.key}
                  className={`fishbones-library-section fishbones-library-section--${sec.key}`}
                  aria-label={sec.label}
                >
                  <header className="fishbones-library-section-head">
                    <h2 className="fishbones-library-section-title">
                      {sec.label}
                    </h2>
                    <span className="fishbones-library-section-count">
                      {sec.rows.length}
                    </span>
                    <span className="fishbones-library-section-blurb">
                      {sec.blurb}
                    </span>
                  </header>
                  <div className="fishbones-library-grid">
                    {sec.rows.map((e) => (
                      <CourseCard
                        key={e.course.id}
                        course={e.course}
                        total={e.total}
                        done={e.done}
                        pct={e.pct}
                        onOpen={() => onOpen(e.course.id)}
                        onExport={
                          onExport
                            ? () => onExport(e.course.id, e.course.title)
                            : undefined
                        }
                        onDelete={
                          onDelete
                            ? () => onDelete(e.course.id, e.course.title)
                            : undefined
                        }
                        onContextMenu={
                          onExport || onDelete || onSettings
                            ? (ev) => ctxMenu.show(e.course, ev)
                            : undefined
                        }
                        // Discover-mode: install affordance per
                        // tile. Mirrors the BookCover treatment in
                        // book view so both view modes can install
                        // a catalog entry without bouncing through
                        // the modal.
                        placeholder={e.course.placeholder}
                        installing={installingIds.has(e.course.id)}
                        onInstall={
                          e.course.placeholder && onInstallCatalogEntry
                            ? () => void handleInstallClick(e.course.id)
                            : undefined
                        }
                        // Library-mode: always-on reinstall (re-extract
                        // bundled archive). Same handler as the
                        // BookCover update badge — onUpdateCourse —
                        // surfaced explicitly as a button so users
                        // don't have to wait for an upstream-changed
                        // signal to re-apply.
                        hasUpdate={
                          !e.course.placeholder &&
                          !!onUpdateCourse &&
                          !!updates[e.course.id]
                        }
                        updating={updatingIds.has(e.course.id)}
                        onReinstall={
                          !e.course.placeholder && onUpdateCourse
                            ? () => void handleUpdateClick(e.course.id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        <CourseContextMenu
          menu={ctxMenu.menu}
          onDismiss={ctxMenu.close}
          onSettings={onSettings}
          onExport={onExport}
          onDelete={onDelete}
        />
    </div>
  );

  // In inline mode, render just the panel so it flows in its parent
  // container. In modal mode, wrap in a backdrop and intercept clicks.
  if (isInline) return panel;
  return (
    <div className="fishbones-library-backdrop" onClick={onDismiss}>
      {panel}
    </div>
  );
}

