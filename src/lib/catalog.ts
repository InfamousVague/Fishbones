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
  /// download path: fetch + storage.saveCourse.
  file: string;
  /// Filename of the cover JPEG inside `/starter-courses/`. We
  /// resolve to a real URL via `coverHref` below.
  cover?: string;
  sizeBytes: number;
  archiveSizeBytes: number;
  /// Full URL to the .fishbones archive on the catalog host. Used
  /// by the desktop downloader.
  archiveUrl: string;
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
/// Library doesn't re-hit the network on every render. Force a
/// refresh with `{ refresh: true }` after a Reapply / Promote
/// flow (rare).
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
  const url = defaultCatalogUrl();
  cachedPromise = (async () => {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as CatalogJson;
      return Array.isArray(body.courses) ? body.courses : [];
    } catch (e) {
      // Network failure isn't fatal — the user just doesn't see any
      // remote placeholders. Log and return empty so the Library
      // still renders the installed courses normally.
      console.warn(
        `[catalog] failed to fetch ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  })();
  cachedAt = Date.now();
  return cachedPromise;
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
