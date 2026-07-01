/// Mobile Discover — the catalog browser the phone never had.
///
/// Until now the mobile web app had NO catalog: MobileLibrary only
/// rendered whatever the desktop had installed + synced across. This
/// view surfaces the full `useCatalog()` manifest so a phone-only
/// learner can browse and install courses independently, then have
/// them ride the existing library-sync back to desktop.
///
/// It reuses the exact tiles the desktop Discover grid uses:
/// `placeholderCourseFromCatalog(entry)` → `<BookCover placeholder>`
/// for not-yet-installed courses (tap → install, with a spinner while
/// the download runs), and a normal `<BookCover>` (tap → open) for
/// ones already in the local library. Styling piggybacks on
/// MobileLibrary.css's grid + section chrome so the two tabs read as
/// one surface.

import { useMemo } from "react";
import type { Course } from "@/data/types";
import { isChallengePack, isExerciseTrack, isKoans, isLings } from "@/data/types";
import {
  coverHref,
  placeholderCourseFromCatalog,
  type CatalogEntry,
} from "@/lib/catalog";
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

  const sections = useMemo(() => {
    const buckets: Record<"books" | "tracks" | "challenges", CatalogEntry[]> = {
      books: [],
      tracks: [],
      challenges: [],
    };
    for (const e of catalog) {
      const placeholder = placeholders.get(e.id);
      if (!placeholder) continue;
      buckets[shelfOf(placeholder)].push(e);
    }
    return SHELF_ORDER.map((s) => ({
      ...s,
      rows: buckets[s.key],
    })).filter((s) => s.rows.length > 0);
  }, [catalog, placeholders]);

  const total = catalog.length;

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
      </div>
      <header className="m-lib__head">
        <div className="m-lib__head-text">
          <h1 className="m-lib__title">Discover</h1>
          <p className="m-lib__subtitle">
            {loaded
              ? `${total} course${total === 1 ? "" : "s"} to install`
              : "Loading catalog…"}
          </p>
        </div>
      </header>

      {loaded && total === 0 && (
        <p className="m-lib__empty">
          No courses available right now. Pull down on the Library tab to
          retry, or check your connection.
        </p>
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
            {sec.rows.map((entry) => {
              const isInstalled = installedIds.has(entry.id);
              const installing = installingIds.has(entry.id);
              if (isInstalled) {
                // Already in the library — render a normal tile that
                // opens the course. Use the installed Course record so
                // its cover / progress chrome matches the Library tab.
                const course = installedById.get(entry.id)!;
                return (
                  <li key={entry.id} className="m-lib__cell">
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
                  </li>
                );
              }
              // Not installed — placeholder tile that installs on tap.
              const placeholder = placeholders.get(entry.id)!;
              return (
                <li key={entry.id} className="m-lib__cell">
                  <BookCover
                    course={placeholder}
                    progress={0}
                    // `onOpen` is unused for placeholders (BookCover
                    // routes the click to `onInstall`) but the prop is
                    // required, so give it a no-op.
                    onOpen={() => {}}
                    placeholder
                    installing={installing}
                    placeholderCoverUrl={coverHref(entry)}
                    onInstall={() => onInstall(entry)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
