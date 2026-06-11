import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "@base/primitives/icon";
import { filter as filterIcon } from "@base/primitives/icon/icons/filter";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { search as searchIcon } from "@base/primitives/icon/icons/search";
import { arrowUpDown } from "@base/primitives/icon/icons/arrow-up-down";
import { layoutGrid } from "@base/primitives/icon/icons/layout-grid";
import { rows3 } from "@base/primitives/icon/icons/rows-3";
import "@base/primitives/icon/icon.css";
import type { LanguageId } from "../../data/types";
import {
  CATEGORY_PILLS,
  CHAIN_PILLS,
  LANG_PILLS,
  chainCountsHasMultiple,
  type CourseCategory,
  type CryptoChain,
} from "./categorize";
import { useT } from "../../i18n/i18n";

/// Single-row filter chips + popover + tools — replaced the earlier
/// 4-row stack of pill bars (category / chain / language / kind) plus
/// tools row. The same filtering surface is now:
///
///   ┌────────────────────────────────────────────────────────────┐
///   │ [Crypto×] [Bitcoin×] [⚙ Filter]   🔍search   ⤓sort  ▦ ▤   │
///   └────────────────────────────────────────────────────────────┘
///
/// Active filters render as removable chips. The "Filter" button opens
/// a popover with sectioned options for every dimension (Category /
/// Chain / Language / Kind). All sections that have nothing to choose
/// (e.g. Chain when not in Crypto, or only-one-kind libraries) auto-
/// hide — same visibility rules the old pill-bar version had.

export type SortKey = "name" | "recent" | "status" | "progress" | "lessons";
export type ViewMode = "shelf" | "grid";

export interface ChainCountsShape {
  byChain: Map<CryptoChain, number>;
  all: number;
}
export interface CategoryCountsShape {
  crypto: number;
  programming: number;
  all: number;
}
export interface KindCountsShape {
  books: number;
  tracks: number;
  challenges: number;
  all: number;
}

export interface LibraryControlsProps {
  categoryFilter: "all" | CourseCategory;
  chainFilter: "all" | CryptoChain;
  langFilter: "all" | LanguageId;
  kindFilter: "all" | "books" | "tracks";
  onSetCategory: (c: "all" | CourseCategory) => void;
  onSetChain: (c: "all" | CryptoChain) => void;
  onSetLang: (l: "all" | LanguageId) => void;
  onSetKind: (k: "all" | "books" | "tracks") => void;
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

export default function LibraryControls(p: LibraryControlsProps): ReactElement {
  const t = useT();
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
      label: p.categoryFilter === "crypto" ? t("library.chipCrypto") : t("library.chipProgramming"),
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
      label:
        p.kindFilter === "books" ? t("library.books") : t("library.tracks"),
      clear: () => p.onSetKind("all"),
    });
  }

  return (
    <div className="libre-library-controls libre-library-controls--compact">
      {/* Left side: active filter chips + Filter popover trigger.
          The trigger pill itself doubles as a status when nothing's
          active ("Filter ▾") and as the entry-point when chips are
          present. */}
      <div className="libre-library-filter-cluster" ref={wrapRef}>
        {activeChips.map((c) => (
          <span key={c.key} className="libre-library-filter-chip">
            {c.label}
            <button
              type="button"
              className="libre-library-filter-chip-x"
              onClick={c.clear}
              aria-label={t("library.removeFilter", { label: c.label })}
            >
              <Icon icon={xIcon} size="xs" color="currentColor" />
            </button>
          </span>
        ))}
        <button
          type="button"
          className={`libre-library-filter-trigger ${
            filterOpen ? "libre-library-filter-trigger--open" : ""
          }`}
          onClick={() => setFilterOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
        >
          <Icon icon={filterIcon} size="xs" color="currentColor" />
          <span>{activeChips.length === 0 ? t("library.filter") : t("library.more")}</span>
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
      <div className="libre-library-tools">
        <label className="libre-library-search-wrap">
          <Icon
            icon={searchIcon}
            size="xs"
            color="currentColor"
            className="libre-library-search-icon"
          />
          <input
            type="search"
            className="libre-library-search"
            placeholder={t("library.searchPlaceholder")}
            value={p.query}
            onChange={(e) => p.onSetQuery(e.target.value)}
          />
        </label>
        <label
          className="libre-library-sort libre-library-sort--compact"
          title={t("library.sortOrderTitle")}
        >
          <Icon icon={arrowUpDown} size="xs" color="currentColor" />
          <select
            className="libre-library-sort-select"
            value={p.sortBy}
            onChange={(e) => p.onSetSort(e.target.value as SortKey)}
          >
            <option value="name">{t("library.sortName")}</option>
            <option value="recent">{t("library.sortRecent")}</option>
            <option value="status">{t("library.sortStatus")}</option>
            <option value="progress">{t("library.sortProgress")}</option>
            <option value="lessons">{t("library.sortLessonCount")}</option>
          </select>
        </label>
        <div
          className="libre-library-viewmode"
          role="tablist"
          aria-label={t("library.viewMode")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={p.viewMode === "shelf"}
            className={`libre-library-viewmode-btn libre-library-viewmode-btn--icon ${
              p.viewMode === "shelf"
                ? "libre-library-viewmode-btn--active"
                : ""
            }`}
            onClick={() => p.onSetViewMode("shelf")}
            title={t("library.shelfViewTitle")}
            aria-label={t("library.shelfView")}
          >
            <Icon icon={rows3} size="xs" color="currentColor" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={p.viewMode === "grid"}
            className={`libre-library-viewmode-btn libre-library-viewmode-btn--icon ${
              p.viewMode === "grid"
                ? "libre-library-viewmode-btn--active"
                : ""
            }`}
            onClick={() => p.onSetViewMode("grid")}
            title={t("library.gridViewTitle")}
            aria-label={t("library.gridView")}
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
  kindFilter: "all" | "books" | "tracks";
  categoryCounts: CategoryCountsShape;
  chainCounts: ChainCountsShape;
  countByLang: Map<string, number>;
  kindCounts: KindCountsShape;
  totalCourses: number;
  onSetCategory: (c: "all" | CourseCategory) => void;
  onSetChain: (c: "all" | CryptoChain) => void;
  onSetLang: (l: "all" | LanguageId) => void;
  onSetKind: (k: "all" | "books" | "tracks") => void;
}

function FilterPopover(p: FilterPopoverProps): ReactElement {
  const t = useT();
  const showCategory =
    p.categoryCounts.crypto > 0 && p.categoryCounts.programming > 0;
  const showChain =
    p.categoryFilter === "crypto" &&
    p.chainCounts.all > 0 &&
    chainCountsHasMultiple(p.chainCounts.byChain);
  // Kind section visible when there are at least two distinct buckets
  // to switch between. With three buckets (books / tracks / challenges)
  // any pair-or-more non-zero count gives the user something to pick.
  const kindBucketsPresent =
    (p.kindCounts.books > 0 ? 1 : 0) +
    (p.kindCounts.tracks > 0 ? 1 : 0) +
    (p.kindCounts.challenges > 0 ? 1 : 0);
  const showKind = kindBucketsPresent >= 2;
  const langPills = LANG_PILLS.filter(
    (l) =>
      l.id === "all" ||
      l.id === p.langFilter ||
      (p.countByLang.get(l.id) ?? 0) > 0,
  );
  const showLang = langPills.length > 1;

  return (
    <div
      className="libre-library-filter-pop"
      role="dialog"
      aria-label={t("library.filterCourses")}
    >
      {showCategory && (
        <FilterSection title={t("library.filterCategory")}>
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
        <FilterSection title={t("library.filterChain")}>
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
        <FilterSection title={t("library.filterLanguage")}>
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
        <FilterSection title={t("library.filterKind")}>
          <FilterOption
            label={t("library.filterAll")}
            count={p.kindCounts.all}
            active={p.kindFilter === "all"}
            onSelect={() => p.onSetKind("all")}
          />
          {p.kindCounts.books > 0 && (
            <FilterOption
              label={t("library.books")}
              count={p.kindCounts.books}
              active={p.kindFilter === "books"}
              onSelect={() => p.onSetKind("books")}
            />
          )}
          {/* Tracks button. Now folds in BOTH Exercism-style
              tracks AND challenge packs — the dedicated
              "Challenges" filter was retired per Notion issue
              #8950f6efe915713b ("remove challenges from the
              main library page and represent them as tracks").
              Count = tracks + challenges so the badge still
              advertises the full set under this filter. */}
          {p.kindCounts.tracks + p.kindCounts.challenges > 0 && (
            <FilterOption
              label={t("library.tracks")}
              count={p.kindCounts.tracks + p.kindCounts.challenges}
              active={p.kindFilter === "tracks"}
              onSelect={() => p.onSetKind("tracks")}
            />
          )}
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
    <div className="libre-library-filter-section">
      <div className="libre-library-filter-section-title">{title}</div>
      <div className="libre-library-filter-section-options">{children}</div>
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
      className={`libre-library-filter-opt ${
        active ? "libre-library-filter-opt--active" : ""
      }`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span className="libre-library-filter-opt-count">{count}</span>
    </button>
  );
}
