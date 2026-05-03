import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "@base/primitives/icon";
import { libraryBig } from "@base/primitives/icon/icons/library-big";
import { filter as filterIcon } from "@base/primitives/icon/icons/filter";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import { arrowUpDown } from "@base/primitives/icon/icons/arrow-up-down";
import { layoutGrid } from "@base/primitives/icon/icons/layout-grid";
import { rows3 } from "@base/primitives/icon/icons/rows-3";
import "@base/primitives/icon/icon.css";
import type { Course, LanguageId } from "../../data/types";
import { isChallengePack } from "../../data/types";
import BookCover from "./BookCover";
import CourseContextMenu, { useCourseMenu } from "../Shared/CourseContextMenu";
import LanguageChip from "../LanguageChip/LanguageChip";
import { prefetchCovers } from "../../hooks/useCourseCover";
import { useCourseUpdates } from "../../hooks/useCourseUpdates";
import { useCatalog } from "../../hooks/useCatalog";
import {
  placeholderCourseFromCatalog,
  coverHref,
  type CatalogEntry,
} from "../../lib/catalog";
import AddCourseButton from "./AddCourseButton";
import "./CourseLibrary.css";

/// Library display mode. `shelf` = tall 2:3 book-cover cards (the new
/// default). `grid` = the information-dense card grid that was the
/// original layout. User's choice persists in localStorage.
type ViewMode = "shelf" | "grid";
const VIEW_MODE_STORAGE_KEY = "fishbones:library-view-mode";

function loadInitialViewMode(): ViewMode {
  if (typeof localStorage === "undefined") return "shelf";
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "grid" ? "grid" : "shelf";
}

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
}

type SortKey = "name" | "progress" | "lessons";

/// Top-level "what kind of book is this" split. Library-wide filter
/// that lives above the language pills so a learner can scope the
/// whole grid to crypto material (Bitcoin, Ethereum, Solana, the
/// Solidity/Vyper/Cairo/Move/Sway-based challenge packs, viem-ethers,
/// cryptography-fundamentals) or to plain programming material
/// (everything else).
type CourseCategory = "crypto" | "programming";

/// Within crypto, which chain/protocol the course is teaching. `other`
/// catches material that's chain-agnostic (cryptography-fundamentals)
/// or about an alt-L1 we don't yet split out (Cairo/Starknet, Move,
/// Sway). Adding a new dedicated chain pill = add an entry here, add
/// a regex/lang rule in `cryptoChain()`, add a label in CHAIN_PILLS.
type CryptoChain = "bitcoin" | "ethereum" | "solana" | "other";

/// Languages that exist primarily for blockchain work — every course
/// in one of these languages is automatically categorized as crypto.
const CRYPTO_LANGUAGES: ReadonlySet<string> = new Set([
  "solidity",
  "vyper",
  "cairo",
  "move",
  "sway",
]);

/// Course-id patterns that mark a course as crypto even when the
/// language is general-purpose (Mastering Bitcoin uses JavaScript,
/// Programming Bitcoin uses Python, etc.). Order doesn't matter — any
/// match wins. Tweak this when adding a new crypto book that doesn't
/// fall under a crypto-specific language.
const CRYPTO_ID_PATTERNS: readonly RegExp[] = [
  /\bbitcoin\b/i,
  /\bethereum\b/i,
  /\bsolana\b/i,
  /\blightning\b/i,
  /\bblockchain\b/i,
  /\bweb3\b/i,
  /\bdefi\b/i,
  /^crypto/i, // catches cryptography-fundamentals; books about /encryption/
  /^viem-/i, // viem-ethers (Ethereum tooling tutorial)
];

/// Classify a course as crypto or programming. Default is programming
/// — only courses that match a crypto language or id pattern get
/// flagged crypto. Pure language-tutorial books (the-rust-programming-
/// language, learning-go, you-dont-know-js-yet, …) stay programming
/// even if a learner uses them later for crypto work.
function categorizeCourse(course: Course): CourseCategory {
  if (CRYPTO_LANGUAGES.has(course.language)) return "crypto";
  if (CRYPTO_ID_PATTERNS.some((re) => re.test(course.id))) return "crypto";
  return "programming";
}

/// Returns true when the chain-pill row should render — at least two
/// distinct chains are present in the crypto subset. With only one
/// chain there's nothing to switch between, so the row hides.
function chainCountsHasMultiple(byChain: Map<CryptoChain, number>): boolean {
  let nonEmpty = 0;
  for (const count of byChain.values()) {
    if (count > 0) nonEmpty += 1;
    if (nonEmpty >= 2) return true;
  }
  return false;
}

/// Map a crypto course to its chain. Only meaningful when
/// categorizeCourse() already returned "crypto"; for non-crypto
/// courses the result is undefined behavior (caller's responsibility
/// to gate). Lightning is rolled up under bitcoin since it's a
/// Bitcoin L2. Solidity/Vyper/viem all imply Ethereum.
function cryptoChain(course: Course): CryptoChain {
  const id = course.id;
  if (/\bbitcoin\b|\blightning\b/i.test(id)) return "bitcoin";
  if (
    /\bethereum\b|^viem-/i.test(id) ||
    course.language === "solidity" ||
    course.language === "vyper"
  ) {
    return "ethereum";
  }
  if (/\bsolana\b/i.test(id)) return "solana";
  return "other";
}

const CATEGORY_PILLS: ReadonlyArray<{
  id: "all" | CourseCategory;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "programming", label: "Programming" },
];

/// Sub-pills shown as a second row when the user has selected the
/// Crypto category. Pills with a zero count auto-hide (except `all`
/// and the active selection) so the row collapses to whatever's
/// actually present in the library.
const CHAIN_PILLS: ReadonlyArray<{
  id: "all" | CryptoChain;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "bitcoin", label: "Bitcoin" },
  { id: "ethereum", label: "Ethereum" },
  { id: "solana", label: "Solana" },
  { id: "other", label: "Other" },
];

// Every LanguageId we support. Each pill is hidden at render time when
// there are zero courses for that language (see the `countByLang` filter
// below), so this full list is safe to carry around even on a library
// with just two or three languages — the user only sees pills for the
// languages they actually have courses in, PLUS whatever's currently
// selected as the active filter. Adding a new language elsewhere in the
// app (e.g. extending `LanguageId` in `data/types.ts`) requires adding
// it here too, otherwise its courses would silently become unfilterable.
const LANG_PILLS: Array<{ id: "all" | LanguageId; label: string }> = [
  { id: "all", label: "All" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "csharp", label: "C#" },
  { id: "assembly", label: "Assembly" },
  { id: "web", label: "Web" },
  { id: "threejs", label: "Three.js" },
  { id: "reactnative", label: "React Native" },
];

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
  onInstallCatalogEntry,
  mode = "modal",
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
  const [viewMode, setViewMode] = useState<ViewMode>(loadInitialViewMode);
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    }
  }, [viewMode]);

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
  const enriched = useMemo(() => {
    // Installed courses contribute real progress numbers from the
    // user's completion set. Placeholders contribute 0 across the
    // board — they have no installed lessons to count yet.
    const installedRows = courses.map((c) => {
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
    const placeholderRows = placeholderCourses.map((c) => ({
      course: c,
      total: 0,
      done: 0,
      pct: 0,
    }));
    return [...installedRows, ...placeholderRows];
  }, [courses, completed, placeholderCourses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
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
            <span className="fishbones-library-title">Library</span>
            <span className="fishbones-library-subtitle">
              {courses.length} course{courses.length === 1 ? "" : "s"} on this machine
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
              />
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

function CourseCard({
  course,
  total,
  done,
  pct,
  onOpen,
  onExport,
  onDelete,
  onContextMenu,
}: {
  course: Course;
  total: number;
  done: number;
  pct: number;
  onOpen: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const chapters = course.chapters.length;
  const status =
    pct === 0
      ? "not started"
      : pct === 1
      ? "completed"
      : `${Math.round(pct * 100)}%`;

  return (
    <div className="fishbones-library-card" onContextMenu={onContextMenu}>
      <button className="fishbones-library-card-main" onClick={onOpen}>
        <div className="fishbones-library-card-header">
          <LanguageChip language={course.language} size="sm" />
          <span className="fishbones-library-card-status">{status}</span>
        </div>
        <div className="fishbones-library-card-title">{course.title}</div>
        {course.author && (
          <div className="fishbones-library-card-author">by {course.author}</div>
        )}
        <div className="fishbones-library-card-progress" aria-hidden>
          <div
            className="fishbones-library-card-progress-fill"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        <div className="fishbones-library-card-meta">
          {done}/{total} lessons · {chapters} chapter{chapters === 1 ? "" : "s"}
        </div>
      </button>
      <div className="fishbones-library-card-actions">
        {onExport && (
          <button
            className="fishbones-library-card-action"
            onClick={(e) => {
              e.stopPropagation();
              onExport();
            }}
            title="Export as .fishbones archive"
          >
            Export
          </button>
        )}
        {onDelete && (
          <button
            className="fishbones-library-card-action fishbones-library-card-action--danger"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete this course from disk"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LibraryControls — single-row filter chips + popover + tools.
//
// Replaces the earlier 4-row stack of pill bars (category / chain /
// language / kind) plus tools row. The same filtering surface is now:
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ [Crypto×] [Bitcoin×] [⚙ Filter]   🔍search   ⤓sort  ▦ ▤   │
//   └────────────────────────────────────────────────────────────┘
//
// Active filters render as removable chips. The "Filter" button opens
// a popover with sectioned options for every dimension (Category /
// Chain / Language / Kind). All sections that have nothing to choose
// (e.g. Chain when not in Crypto, or only-one-kind libraries) auto-
// hide — same visibility rules the old pill-bar version had.
// ─────────────────────────────────────────────────────────────────────

interface ChainCountsShape {
  byChain: Map<CryptoChain, number>;
  all: number;
}
interface CategoryCountsShape {
  crypto: number;
  programming: number;
  all: number;
}
interface KindCountsShape {
  books: number;
  challenges: number;
  all: number;
}

interface LibraryControlsProps {
  categoryFilter: "all" | CourseCategory;
  chainFilter: "all" | CryptoChain;
  langFilter: "all" | LanguageId;
  kindFilter: "all" | "books" | "challenges";
  onSetCategory: (c: "all" | CourseCategory) => void;
  onSetChain: (c: "all" | CryptoChain) => void;
  onSetLang: (l: "all" | LanguageId) => void;
  onSetKind: (k: "all" | "books" | "challenges") => void;
  categoryCounts: CategoryCountsShape;
  chainCounts: ChainCountsShape;
  countByLang: Map<string, number>;
  kindCounts: KindCountsShape;
  totalCourses: number;
  query: string;
  onSetQuery: (q: string) => void;
  sortBy: SortKey;
  onSetSort: (s: SortKey) => void;
  viewMode: ViewMode;
  onSetViewMode: (v: ViewMode) => void;
}

function LibraryControls(p: LibraryControlsProps): ReactElement {
  const [filterOpen, setFilterOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside / Escape closes the popover. Only registers the
  // listeners while open so we don't leak them per render.
  useEffect(() => {
    if (!filterOpen) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      setFilterOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFilterOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  // ── Active-filter chip strip ─────────────────────────────────────
  // Build a flat list of "this filter is active" entries so the
  // header can render them as removable chips. Order goes from
  // broadest (category) → narrowest (kind) so a user reading left-
  // to-right sees the hierarchy that produced the current grid.
  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (p.categoryFilter !== "all") {
    activeChips.push({
      key: "cat",
      label: p.categoryFilter === "crypto" ? "Crypto" : "Programming",
      clear: () => p.onSetCategory("all"),
    });
  }
  if (p.chainFilter !== "all" && p.categoryFilter === "crypto") {
    const chainPill = CHAIN_PILLS.find((cp) => cp.id === p.chainFilter);
    activeChips.push({
      key: "chain",
      label: chainPill?.label ?? p.chainFilter,
      clear: () => p.onSetChain("all"),
    });
  }
  if (p.langFilter !== "all") {
    const langPill = LANG_PILLS.find((lp) => lp.id === p.langFilter);
    activeChips.push({
      key: "lang",
      label: langPill?.label ?? p.langFilter,
      clear: () => p.onSetLang("all"),
    });
  }
  if (p.kindFilter !== "all") {
    activeChips.push({
      key: "kind",
      label: p.kindFilter === "books" ? "Books" : "Challenges",
      clear: () => p.onSetKind("all"),
    });
  }

  return (
    <div className="fishbones-library-controls fishbones-library-controls--compact">
      {/* Left side: active filter chips + Filter popover trigger.
          The trigger pill itself doubles as a status when nothing's
          active ("Filter ▾") and as the entry-point when chips are
          present. */}
      <div className="fishbones-library-filter-cluster" ref={wrapRef}>
        {activeChips.map((c) => (
          <span key={c.key} className="fishbones-library-filter-chip">
            {c.label}
            <button
              type="button"
              className="fishbones-library-filter-chip-x"
              onClick={c.clear}
              aria-label={`Remove ${c.label} filter`}
            >
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </button>
          </span>
        ))}
        <button
          type="button"
          className={`fishbones-library-filter-trigger ${
            filterOpen ? "fishbones-library-filter-trigger--open" : ""
          }`}
          onClick={() => setFilterOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
        >
          <Icon icon={filterIcon} size="xs" color="currentColor" />
          <span>{activeChips.length === 0 ? "Filter" : "More"}</span>
        </button>

        {filterOpen && (
          <FilterPopover
            categoryFilter={p.categoryFilter}
            chainFilter={p.chainFilter}
            langFilter={p.langFilter}
            kindFilter={p.kindFilter}
            categoryCounts={p.categoryCounts}
            chainCounts={p.chainCounts}
            countByLang={p.countByLang}
            kindCounts={p.kindCounts}
            totalCourses={p.totalCourses}
            onSetCategory={p.onSetCategory}
            onSetChain={p.onSetChain}
            onSetLang={p.onSetLang}
            onSetKind={p.onSetKind}
          />
        )}
      </div>

      {/* Right side: search + sort + view. The dominant tools row.
          Sort + view collapse to icon buttons to save space. */}
      <div className="fishbones-library-tools">
        <label className="fishbones-library-search-wrap">
          <Icon
            icon={searchIcon}
            size="xs"
            color="currentColor"
            className="fishbones-library-search-icon"
          />
          <input
            type="search"
            className="fishbones-library-search"
            placeholder="Search…"
            value={p.query}
            onChange={(e) => p.onSetQuery(e.target.value)}
          />
        </label>
        <label
          className="fishbones-library-sort fishbones-library-sort--compact"
          title="Sort order"
        >
          <Icon icon={arrowUpDown} size="xs" color="currentColor" />
          <select
            className="fishbones-library-sort-select"
            value={p.sortBy}
            onChange={(e) => p.onSetSort(e.target.value as SortKey)}
          >
            <option value="name">Name (A–Z)</option>
            <option value="progress">Progress</option>
            <option value="lessons">Lesson count</option>
          </select>
        </label>
        <div
          className="fishbones-library-viewmode"
          role="tablist"
          aria-label="View mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={p.viewMode === "shelf"}
            className={`fishbones-library-viewmode-btn fishbones-library-viewmode-btn--icon ${
              p.viewMode === "shelf"
                ? "fishbones-library-viewmode-btn--active"
                : ""
            }`}
            onClick={() => p.onSetViewMode("shelf")}
            title="Shelf view — book covers"
            aria-label="Shelf view"
          >
            <Icon icon={rows3} size="xs" color="currentColor" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={p.viewMode === "grid"}
            className={`fishbones-library-viewmode-btn fishbones-library-viewmode-btn--icon ${
              p.viewMode === "grid"
                ? "fishbones-library-viewmode-btn--active"
                : ""
            }`}
            onClick={() => p.onSetViewMode("grid")}
            title="Grid view — info cards"
            aria-label="Grid view"
          >
            <Icon icon={layoutGrid} size="xs" color="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FilterPopover — sectioned panel of every filter dimension.
//
// Sections auto-hide using the same rules the old inline pill bars
// did:
//   - Category: hides when only one category is present
//   - Chain: hides unless the active category is "crypto" AND there
//     are at least two non-empty chains
//   - Language: hides if only one language is present
//   - Kind: hides if there's nothing to switch (only books OR only
//     challenges)
//
// Picking a value updates the relevant filter immediately; the
// popover stays open so users can layer multiple filters in one
// session. They dismiss by clicking outside or pressing Escape.
// ─────────────────────────────────────────────────────────────────────

interface FilterPopoverProps {
  categoryFilter: "all" | CourseCategory;
  chainFilter: "all" | CryptoChain;
  langFilter: "all" | LanguageId;
  kindFilter: "all" | "books" | "challenges";
  categoryCounts: CategoryCountsShape;
  chainCounts: ChainCountsShape;
  countByLang: Map<string, number>;
  kindCounts: KindCountsShape;
  totalCourses: number;
  onSetCategory: (c: "all" | CourseCategory) => void;
  onSetChain: (c: "all" | CryptoChain) => void;
  onSetLang: (l: "all" | LanguageId) => void;
  onSetKind: (k: "all" | "books" | "challenges") => void;
}

function FilterPopover(p: FilterPopoverProps): ReactElement {
  const showCategory =
    p.categoryCounts.crypto > 0 && p.categoryCounts.programming > 0;
  const showChain =
    p.categoryFilter === "crypto" &&
    p.chainCounts.all > 0 &&
    chainCountsHasMultiple(p.chainCounts.byChain);
  const showKind = p.kindCounts.books > 0 && p.kindCounts.challenges > 0;
  const langPills = LANG_PILLS.filter(
    (l) =>
      l.id === "all" ||
      l.id === p.langFilter ||
      (p.countByLang.get(l.id) ?? 0) > 0,
  );
  const showLang = langPills.length > 1;

  return (
    <div
      className="fishbones-library-filter-pop"
      role="dialog"
      aria-label="Filter courses"
    >
      {showCategory && (
        <FilterSection title="Category">
          {CATEGORY_PILLS.map((cp) => {
            const count =
              cp.id === "all"
                ? p.categoryCounts.all
                : cp.id === "crypto"
                  ? p.categoryCounts.crypto
                  : p.categoryCounts.programming;
            return (
              <FilterOption
                key={cp.id}
                label={cp.label}
                count={count}
                active={p.categoryFilter === cp.id}
                onSelect={() => p.onSetCategory(cp.id)}
              />
            );
          })}
        </FilterSection>
      )}

      {showChain && (
        <FilterSection title="Chain">
          {CHAIN_PILLS.filter(
            (cp) =>
              cp.id === "all" ||
              cp.id === p.chainFilter ||
              (p.chainCounts.byChain.get(cp.id as CryptoChain) ?? 0) > 0,
          ).map((cp) => {
            const count =
              cp.id === "all"
                ? p.chainCounts.all
                : p.chainCounts.byChain.get(cp.id as CryptoChain) ?? 0;
            return (
              <FilterOption
                key={cp.id}
                label={cp.label}
                count={count}
                active={p.chainFilter === cp.id}
                onSelect={() => p.onSetChain(cp.id)}
              />
            );
          })}
        </FilterSection>
      )}

      {showLang && (
        <FilterSection title="Language">
          {langPills.map((lp) => {
            const count =
              lp.id === "all"
                ? p.totalCourses
                : p.countByLang.get(lp.id) ?? 0;
            return (
              <FilterOption
                key={lp.id}
                label={lp.label}
                count={count}
                active={p.langFilter === lp.id}
                onSelect={() => p.onSetLang(lp.id)}
              />
            );
          })}
        </FilterSection>
      )}

      {showKind && (
        <FilterSection title="Kind">
          <FilterOption
            label="All"
            count={p.kindCounts.all}
            active={p.kindFilter === "all"}
            onSelect={() => p.onSetKind("all")}
          />
          <FilterOption
            label="Books"
            count={p.kindCounts.books}
            active={p.kindFilter === "books"}
            onSelect={() => p.onSetKind("books")}
          />
          <FilterOption
            label="Challenges"
            count={p.kindCounts.challenges}
            active={p.kindFilter === "challenges"}
            onSelect={() => p.onSetKind("challenges")}
          />
        </FilterSection>
      )}
    </div>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="fishbones-library-filter-section">
      <div className="fishbones-library-filter-section-title">{title}</div>
      <div className="fishbones-library-filter-section-options">{children}</div>
    </div>
  );
}

function FilterOption({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`fishbones-library-filter-opt ${
        active ? "fishbones-library-filter-opt--active" : ""
      }`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span className="fishbones-library-filter-opt-count">{count}</span>
    </button>
  );
}
