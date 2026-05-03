/// Catalog of available courses — both core (bundled with the app)
/// and remote (downloadable). Drives the Library's "show every book
/// the user CAN have, render the ones they don't yet have as
/// placeholders" UX.
///
/// Source format (the JSON written by `scripts/extract-starter-
/// courses.mjs` to `public/starter-courses/manifest.json`):
///
///   {
///     "version": 2,
///     "generatedAt": "2026-04-30T...",
///     "archiveBaseUrl": "https://mattssoftware.com/fishbones/courses",
///     "courses": [
///       {
///         "id": "the-rust-programming-language",
///         "packId": "the-rust-programming-language",
///         "title": "The Rust Programming Language",
///         "author": "Steve Klabnik, Carol Nichols",
///         "language": "rust",
///         "file": "the-rust-programming-language.json",
///         "cover": "the-rust-programming-language.jpg",
///         "sizeBytes": 1234567,         // unzipped course.json size
///         "archiveSizeBytes": 234567,    // .fishbones archive size
///         "archiveUrl": "https://...   /the-rust-programming-language.fishbones",
///         "tier": "core" | "remote",
///         "packType": "course" | "challenges",
///         "releaseStatus": "BETA" | "ALPHA" | "UNREVIEWED",
///         "lessonCount": 168
///       },
///       ...
///     ]
///   }
///
/// At runtime we fetch this once per app session, cache in memory,
/// and let `useCourses` merge entries that aren't in the user's
/// installed set as `placeholder: true` Course objects.

import type { Course, LanguageId } from "../data/types";
import { isWeb } from "./platform";

export interface CatalogEntry {
  id: string;
  packId: string;
  title: string;
  author?: string;
  language: LanguageId;
  /// Filename of the course JSON inside `/starter-courses/`. Web
  /// download path: fetch + storage.saveCourse. Empty string for
  /// desktop-bundled entries (those install via `localPath`).
  file: string;
  /// Filename of the cover JPEG inside `/starter-courses/`. We
  /// resolve to a real URL via `coverHref` below.
  cover?: string;
  sizeBytes: number;
  archiveSizeBytes: number;
  /// Full URL to the .fishbones archive on the catalog host. Used
  /// by the desktop downloader when `localPath` is unset (i.e.
  /// remote catalogs). Empty string for entries that ship inside
  /// the desktop binary's bundled-packs/ — those install from the
  /// local archive without a network round-trip.
  archiveUrl: string;
  /// Filesystem path to the .fishbones archive when this entry is
  /// already shipped inside the desktop binary (populated by the
  /// `list_bundled_catalog_entries` Tauri command). The install
  /// handler prefers this over `archiveUrl` — no network needed,
  /// no server hosting required for the catalog to work on desktop.
  localPath?: string;
  tier: "core" | "remote";
  packType?: "course" | "challenges";
  releaseStatus?: "BETA" | "ALPHA" | "UNREVIEWED" | "PRE-RELEASE";
  lessonCount?: number;
}

interface CatalogJson {
  version: number;
  generatedAt?: string;
  archiveBaseUrl?: string;
  courses: CatalogEntry[];
}

/// Default catalog URLs by build target. Web fetches same-origin
/// (the manifest sits next to the per-course JSON files); desktop
/// hits a remote host. Override either with the
/// `FISHBONES_CATALOG_URL` env var at build time.
const CATALOG_URL_OVERRIDE = (
  import.meta.env.FISHBONES_CATALOG_URL as string | undefined
)?.trim();

function defaultCatalogUrl(): string {
  if (CATALOG_URL_OVERRIDE) return CATALOG_URL_OVERRIDE;
  if (isWeb) {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
    return `${base}starter-courses/manifest.json`;
  }
  return "https://mattssoftware.com/fishbones/catalog/manifest.json";
}

let cachedPromise: Promise<CatalogEntry[]> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/// Fetch the catalog. Cached for `CACHE_TTL_MS` per process so the
/// Library doesn't re-hit the catalog source on every render. Force
/// a refresh with `{ refresh: true }` after a Reapply / Promote
/// flow (rare).
///
/// Desktop: invokes the Tauri `list_bundled_catalog_entries` command,
/// which enumerates `.fishbones` archives shipped under
/// `src-tauri/resources/bundled-packs/` and reads their per-archive
/// metadata. No server needed — the catalog IS the bundled
/// archives, every entry is already on disk and installs locally.
///
/// Web: fetches the manifest.json deployed alongside the per-course
/// JSON files (same-origin under `/starter-courses/`). Falls back to
/// an empty list on network failure so the Library still renders
/// installed courses normally.
export function fetchCatalog(opts: { refresh?: boolean } = {}): Promise<
  CatalogEntry[]
> {
  if (
    !opts.refresh &&
    cachedPromise &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return cachedPromise;
  }
  cachedPromise = isWeb ? fetchWebCatalog() : fetchDesktopCatalog();
  cachedAt = Date.now();
  return cachedPromise;
}

async function fetchWebCatalog(): Promise<CatalogEntry[]> {
  const url = defaultCatalogUrl();
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as CatalogJson;
    return Array.isArray(body.courses) ? body.courses : [];
  } catch (e) {
    console.warn(
      `[catalog] failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/// Shape returned by the Rust `list_bundled_catalog_entries`
/// command. Field names use snake_case in Rust's serde output (see
/// the matching struct in `src-tauri/src/courses.rs`); we map them
/// to camelCase CatalogEntry shape for the rest of the JS app.
interface BundledCatalogEntryFromRust {
  id: string;
  title: string;
  author?: string;
  language: string;
  pack_type?: string;
  lesson_count: number;
  size_bytes: number;
  local_path: string;
}

async function fetchDesktopCatalog(): Promise<CatalogEntry[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<BundledCatalogEntryFromRust[]>(
      "list_bundled_catalog_entries",
    );
    return rows.map((r) => ({
      id: r.id,
      packId: r.id,
      title: r.title,
      author: r.author,
      language: r.language as LanguageId,
      // No /starter-courses/ JSON file for bundled entries — install
      // is via `local_path`, not URL fetch.
      file: "",
      sizeBytes: r.size_bytes,
      archiveSizeBytes: r.size_bytes,
      // archiveUrl is unused when localPath is set; keep an empty
      // string so the type stays simple (required field).
      archiveUrl: "",
      localPath: r.local_path,
      tier: "core",
      packType: (r.pack_type as "course" | "challenges" | undefined) ?? "course",
      lessonCount: r.lesson_count,
    }));
  } catch (e) {
    console.warn(
      `[catalog] failed to load bundled catalog: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/// Resolve a catalog entry's cover field into a full URL. The
/// extract script writes `<id>.jpg` next to the manifest, so on
/// web we serve from the same origin; on desktop we point at the
/// CDN (assumed to host covers alongside archives at the catalog
/// base URL).
export function coverHref(entry: CatalogEntry): string | undefined {
  if (!entry.cover) return undefined;
  if (isWeb) {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
    return `${base}starter-courses/${entry.cover}`;
  }
  // Desktop: covers live alongside archives on the catalog host.
  // Strip the `/manifest.json` tail off the catalog URL to derive
  // the base.
  const catalogUrl = defaultCatalogUrl();
  const base = catalogUrl.replace(/\/manifest\.json$/, "");
  return `${base}/${entry.cover}`;
}

/// Build a synthetic `Course` from a catalog entry — used as a
/// placeholder in the Library grid until the user installs it.
/// The shape matches a real Course closely enough that BookCover
/// renders without tripping; `placeholder: true` flags it so the
/// click handler fires Download instead of Open.
export function placeholderCourseFromCatalog(entry: CatalogEntry): Course {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    language: entry.language,
    chapters: [], // empty — placeholders have no lessons until installed
    packType: entry.packType,
    releaseStatus: entry.releaseStatus,
    placeholder: true,
    downloadUrl: entry.archiveUrl,
    archiveSize: entry.archiveSizeBytes,
    tier: entry.tier,
  };
}
