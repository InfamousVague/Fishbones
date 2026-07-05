/// Mobile Discover — the catalog browser, reworked as a LANGUAGE-
/// FIRST entry point. A first-time learner doesn't think in terms of
/// a 90-course wall; they think "I want to learn Python". So the page
/// leads with that question:
///
///   1. "Start with a language" — a grid of brand-coloured language
///      tiles (icon + name + course count), built from whatever the
///      live catalog actually stocks. Tapping one filters the whole
///      page to that language; tapping again (or the Show-all chip)
///      clears.
///   2. "Start here" — a horizontal rail of curated beginner books
///      (only while unfiltered), so the very first tap can be a
///      sensible default rather than a research project.
///   3. The full Books / Tracks / Challenges shelves, filtered by
///      the selected language.
///
/// Tiles reuse the exact BookCover install/open flow the previous
/// version had: placeholder → tap installs (spinner while in
/// flight), installed → tap opens. Language branding comes from the
/// shared LANGUAGE_META (same source as LanguageChip), so colours and
/// icons match every other surface.

import { useMemo, useState } from "react";
import type { Course, LanguageId } from "@/data/types";
import { isChallengePack, isExerciseTrack, isKoans, isLings } from "@/data/types";
import {
  coverHref,
  placeholderCourseFromCatalog,
  type CatalogEntry,
} from "@/lib/catalog";
import { languageMeta } from "@/lib/languages";
import BookCover from "@/components/templates/Library/BookCover";
import { haptics } from "@/lib/haptics";
import type { LibraryPane } from "./MobileLibrary";
import "./MobileLibrary.css";

interface Props {
  /// Full remote catalog from `useCatalog()`. Hidden / retired
  /// entries are already filtered out by the catalog layer.
  catalog: CatalogEntry[];
  /// The learner's locally-installed courses (the same list
  /// MobileLibrary renders). Used to decide per-tile whether to show
  /// an "install" placeholder or an "open" installed tile, and to
  /// power the per-tile Installed badge.
  installed: Course[];
  /// Whether the catalog has finished its first load. Drives the
  /// empty / loading copy so a cold-launch with an empty cache shows
  /// "Loading…" rather than "No courses".
  loaded: boolean;
  /// Ids currently mid-install (download in flight). Drives the
  /// spinner overlay on the placeholder tile.
  installingIds: Set<string>;
  /// Fired when a placeholder tile is tapped. Parent runs the
  /// fetch → saveCourse → allowlist-update flow and flips the tile to
  /// its installed state once the course lands in the library.
  onInstall: (entry: CatalogEntry) => void;
  /// Fired when an already-installed tile is tapped — opens the
  /// course at its first lesson (parent resolves the Course + jumps
  /// into the lesson view).
  onOpen: (courseId: string) => void;
  /// Current pane + setter for the shared [My Library | Discover]
  /// segmented toggle. Lets the learner flip back to their library
  /// from the Discover header.
  pane: LibraryPane;
  onPaneChange: (pane: LibraryPane) => void;
}

/// Bucket a catalog entry into the same three shelves MobileLibrary
/// uses (Books / Tracks / Challenges) so Discover mirrors the
/// library's structure. We build a throwaway placeholder Course to
/// reuse the existing kind predicates rather than re-deriving the
/// bucketing rules from `packType` by hand.
function shelfOf(course: Course): "books" | "tracks" | "challenges" {
  if (isChallengePack(course) || isKoans(course) || isLings(course)) {
    return "challenges";
  }
  if (isExerciseTrack(course)) return "tracks";
  return "books";
}

const SHELF_ORDER: Array<{ key: "books" | "tracks" | "challenges"; label: string }> = [
  { key: "books", label: "Books" },
  { key: "tracks", label: "Tracks" },
  { key: "challenges", label: "Challenges" },
];

/// Curated first-tap books, in display order. Filtered to whatever
/// the live catalog actually stocks, so a retired id just drops out
/// of the rail rather than rendering a dead tile.
const START_HERE_IDS = [
  "javascript-for-beginners",
  "python-for-beginners",
  "the-rust-programming-language",
  "learning-go",
  "javascript-typescript",
  "automate-the-boring-stuff",
];

export default function MobileDiscover({
  catalog,
  installed,
  loaded,
  installingIds,
  onInstall,
  onOpen,
  pane,
  onPaneChange,
}: Props) {
  const [selectedLang, setSelectedLang] = useState<LanguageId | null>(null);
  /// Tile grid collapsed to the top 9 ecosystems by default — 33
  /// languages is a full screen of tiles before any actual course
  /// appears. Expanding is one tap and sticky for the session.
  const [langsExpanded, setLangsExpanded] = useState(false);

  const installedIds = useMemo(
    () => new Set(installed.map((c) => c.id)),
    [installed],
  );
  const installedById = useMemo(() => {
    const m = new Map<string, Course>();
    for (const c of installed) m.set(c.id, c);
    return m;
  }, [installed]);

  /// Placeholder Course per catalog entry — used both for kind
  /// bucketing (via the predicates above) and, for not-installed
  /// entries, as the `<BookCover>` course prop. Built once per catalog
  /// change; stable so the grid doesn't churn on unrelated re-renders.
  const placeholders = useMemo(() => {
    const m = new Map<string, Course>();
    for (const e of catalog) m.set(e.id, placeholderCourseFromCatalog(e));
    return m;
  }, [catalog]);

  /// Languages actually stocked, sorted by catalog depth so the big
  /// ecosystems land in the first rows of the tile grid.
  const languages = useMemo(() => {
    const counts = new Map<LanguageId, number>();
    for (const e of catalog) {
      const lang = e.language as LanguageId;
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);
  }, [catalog]);

  const filtered = useMemo(
    () =>
      selectedLang
        ? catalog.filter((e) => (e.language as LanguageId) === selectedLang)
        : catalog,
    [catalog, selectedLang],
  );

  const sections = useMemo(() => {
    const buckets: Record<"books" | "tracks" | "challenges", CatalogEntry[]> = {
      books: [],
      tracks: [],
      challenges: [],
    };
    for (const e of filtered) {
      const placeholder = placeholders.get(e.id);
      if (!placeholder) continue;
      buckets[shelfOf(placeholder)].push(e);
    }
    return SHELF_ORDER.map((s) => ({
      ...s,
      rows: buckets[s.key],
    })).filter((s) => s.rows.length > 0);
  }, [filtered, placeholders]);

  const startHere = useMemo(() => {
    if (selectedLang) return [];
    const byId = new Map(catalog.map((e) => [e.id, e]));
    return START_HERE_IDS.map((id) => byId.get(id)).filter(
      (e): e is CatalogEntry => !!e,
    );
  }, [catalog, selectedLang]);

  const total = catalog.length;

  const pickLang = (lang: LanguageId) => {
    void haptics.selection();
    setSelectedLang((prev) => (prev === lang ? null : lang));
  };

  /// One catalog tile — installed opens, placeholder installs. Shared
  /// by the Start-here rail and the shelf grids.
  const renderTile = (entry: CatalogEntry) => {
    const isInstalled = installedIds.has(entry.id);
    const installing = installingIds.has(entry.id);
    if (isInstalled) {
      const course = installedById.get(entry.id)!;
      return (
        <div className="m-disc__tilewrap">
          <BookCover
            course={course}
            progress={0}
            onOpen={() => onOpen(entry.id)}
          />
          <span className="m-disc__installed" aria-hidden>
            Installed
          </span>
        </div>
      );
    }
    const placeholder = placeholders.get(entry.id)!;
    return (
      <BookCover
        course={placeholder}
        progress={0}
        onOpen={() => {}}
        placeholder
        installing={installing}
        placeholderCoverUrl={coverHref(entry)}
        onInstall={() => onInstall(entry)}
      />
    );
  };

  return (
    <div className="m-lib m-lib--discover">
      <div className="m-lib__segmented" role="tablist" aria-label="Library or Discover">
        <button
          type="button"
          role="tab"
          aria-selected={pane === "library"}
          className={`m-lib__seg${pane === "library" ? " m-lib__seg--active" : ""}`}
          onClick={() => {
            void haptics.selection();
            onPaneChange("library");
          }}
        >
          My Library
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "discover"}
          className={`m-lib__seg${pane === "discover" ? " m-lib__seg--active" : ""}`}
          onClick={() => {
            void haptics.selection();
            onPaneChange("discover");
          }}
        >
          Discover
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "paths"}
          className={`m-lib__seg${pane === "paths" ? " m-lib__seg--active" : ""}`}
          onClick={() => onPaneChange?.("paths")}
        >
          Paths
        </button>
      </div>
      <header className="m-lib__head">
        <div className="m-lib__head-text">
          <h1 className="m-lib__title">
            {selectedLang ? languageMeta(selectedLang).label : "Discover"}
          </h1>
          <p className="m-lib__subtitle">
            {!loaded
              ? "Loading catalog…"
              : selectedLang
                ? `${filtered.length} course${filtered.length === 1 ? "" : "s"}`
                : "What do you want to learn?"}
          </p>
        </div>
      </header>

      {loaded && total === 0 && (
        <p className="m-lib__empty">
          No courses available right now. Pull down on the Library tab to
          retry, or check your connection.
        </p>
      )}

      {/* ── Language tiles ── */}
      {languages.length > 0 && (
        <section className="m-disc__langs-section" aria-label="Browse by language">
          <header className="m-lib__section-head">
            <h2 className="m-lib__section-title">Start with a language</h2>
            {selectedLang && (
              <button
                type="button"
                className="m-disc__langs-clear"
                onClick={() => setSelectedLang(null)}
              >
                Show all
              </button>
            )}
          </header>
          <div className="m-disc__langs" role="group">
            {(langsExpanded ? languages : languages.slice(0, 9)).map(({ lang, count }) => {
              const meta = languageMeta(lang);
              const active = selectedLang === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={active}
                  className={
                    "m-disc__lang" + (active ? " m-disc__lang--active" : "")
                  }
                  style={{ "--m-disc-brand": meta.color } as React.CSSProperties}
                  onClick={() => pickLang(lang)}
                >
                  <span className="m-disc__lang-icon" aria-hidden>
                    <meta.Icon />
                  </span>
                  <span className="m-disc__lang-name">{meta.label}</span>
                  <span className="m-disc__lang-count">{count}</span>
                </button>
              );
            })}
          </div>
          {languages.length > 9 && (
            <button
              type="button"
              className="m-disc__langs-more"
              onClick={() => {
                void haptics.selection();
                setLangsExpanded((v) => !v);
              }}
            >
              {langsExpanded
                ? "Show fewer languages"
                : `All ${languages.length} languages`}
            </button>
          )}
        </section>
      )}

      {/* ── Curated first-tap rail ── */}
      {startHere.length > 0 && (
        <section className="m-disc__start" aria-label="Start here">
          <header className="m-lib__section-head">
            <h2 className="m-lib__section-title">Start here</h2>
            <span className="m-lib__section-count">beginner-friendly</span>
          </header>
          <ul className="m-disc__rail" role="list">
            {startHere.map((entry) => (
              <li key={entry.id} className="m-disc__rail-cell">
                {renderTile(entry)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.map((sec) => (
        <section
          key={sec.key}
          className={`m-lib__section m-lib__section--${sec.key}`}
          aria-label={sec.label}
        >
          <header className="m-lib__section-head">
            <h2 className="m-lib__section-title">{sec.label}</h2>
            <span className="m-lib__section-count">{sec.rows.length}</span>
          </header>
          <ul className="m-lib__grid" role="list">
            {sec.rows.map((entry) => (
              <li key={entry.id} className="m-lib__cell">
                {renderTile(entry)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
