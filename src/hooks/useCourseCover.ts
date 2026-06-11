import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isWeb } from "../lib/platform";
import { catalogAssetBase } from "../lib/catalog";

/// Base URL for cover JPEGs — delegated to `catalogAssetBase()` so cover
/// resolution always matches wherever the catalog itself loads from: the
/// libre.academy CDN in production, the LOCAL `/starter-courses/` extract
/// on dev builds, or the `LIBRE_CATALOG_URL` override. One shared base
/// means a dev build shows the covers you just staged with
/// `npm run starter:web`, not the deployed set.
const COVER_CDN_BASE = catalogAssetBase();

/// Build the CDN fallback URL. Returns null for empty ids so the
/// caller can short-circuit without rendering a broken image. The
/// `cacheBust` param is the same `coverFetchedAt` value used for
/// the local IPC cache key — appending it as `?v=<n>` ensures a
/// returning user whose previous launch hit a 404 (no cover yet)
/// re-fetches once the JPEG lands on the CDN.
function desktopCdnCoverUrl(
  courseId: string,
  cacheBust?: number,
): string | null {
  if (!courseId) return null;
  const path = `${COVER_CDN_BASE}/${courseId}.jpg`;
  return cacheBust ? `${path}?v=${cacheBust}` : path;
}

/// Web-build cover URL. Resolves against the page's BASE_URL so the
/// cover loads correctly regardless of whether the app is mounted at
/// the page root (`/`), a subpath (`/learn/`), or the
/// libre.academy `/learn/` embed. Returns null when courseId is
/// empty so the caller can skip rendering.
///
/// `cacheBust` is appended as a `?v=<n>` query param so a re-seed
/// (which bumps `coverFetchedAt` to a fresh `Date.now()`) produces a
/// distinct URL — required for visitors whose browser cached an
/// earlier broken response (e.g. the Caddy `index.html` fallback that
/// was being served when the cover JPEG was missing). Without the
/// param the img element keeps reading the old 200-but-HTML payload
/// from disk cache and the shelf renders the language-tinted glyph
/// even after the JPEG is fixed on the server.
function webCoverUrl(courseId: string, cacheBust?: number): string | null {
  if (!courseId) return null;
  // DEV: read the LOCALLY staged cover under the page's BASE_URL
  // (`public/starter-courses/<id>.jpg`, produced by `npm run
  // starter:web`) so cover art you change locally shows on reload
  // without a deploy. No `?v=` cache-bust — the Vite dev server
  // revalidates the file by mtime, whereas the CDN path below pins the
  // URL behind the seed-time `coverFetchedAt` and would keep serving a
  // browser-cached copy after a re-extract.
  if (import.meta.env.DEV) {
    return `${import.meta.env.BASE_URL}starter-courses/${courseId}.jpg`;
  }
  // PROD: single absolute CDN base so the cover URL is identical on
  // every host — the production embed at libre.academy/learn/ and any
  // future location. Mirrors `COVER_CDN_BASE` used in the desktop
  // fallback path below.
  const path = `${COVER_CDN_BASE}/${courseId}.jpg`;
  return cacheBust ? `${path}?v=${cacheBust}` : path;
}

/// Thin hook that resolves a course's cover to a data URL (`data:image/png;base64,...`)
/// via the Rust `load_course_cover` command. Returns `null` when no
/// cover exists OR when loading fails — the caller renders its fallback
/// tile in either case.
///
/// `cacheBust` is threaded through so refetching a cover (e.g. the
/// "Fetch cover artwork…" button) invalidates stale in-memory URLs:
/// the import + course settings flow bumps `course.coverFetchedAt`
/// after the Rust command writes, and this hook keys on that value.

/// Module-level cache keyed on `${courseId}:${cacheBust ?? "0"}`. Shared
/// by every `useCourseCover` call and by `prefetchCovers` so the
/// library can load N covers up front and the per-card hooks hit a
/// warm cache instead of firing a second round of IPCs.
///
/// A `null` value = "resolved to no cover" (fetch succeeded, file
/// missing). An in-flight Promise = "fetch started, waiting on it" so
/// concurrent callers dedupe onto the same IPC.
type Resolved = string | null;
const resolved = new Map<string, Resolved>();
const inflight = new Map<string, Promise<Resolved>>();
/// Subscribers that want to know when the cached value for a key
/// changes. The per-hook mount registers itself; `fetchCover` runs
/// every subscriber for the affected key after the IPC resolves.
const subscribers = new Map<string, Set<() => void>>();

function cacheKey(courseId: string, cacheBust?: number): string {
  return `${courseId}:${cacheBust ?? 0}`;
}

function notify(key: string): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const fn of subs) fn();
}

/// Fire a `load_course_cover` IPC (or return an in-flight one) and
/// cache the result. Safe to call concurrently for the same key —
/// the second call hits the `inflight` map and rides the same promise.
function fetchCover(courseId: string, cacheBust?: number): Promise<Resolved> {
  const key = cacheKey(courseId, cacheBust);
  if (resolved.has(key)) {
    return Promise.resolve(resolved.get(key) ?? null);
  }
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = invoke<string | null>("load_course_cover", { courseId })
    .then((url) => {
      resolved.set(key, url ?? null);
      inflight.delete(key);
      notify(key);
      return url ?? null;
    })
    .catch(() => {
      resolved.set(key, null);
      inflight.delete(key);
      notify(key);
      return null;
    });
  inflight.set(key, p);
  return p;
}

/// Prime the cache for a batch of courses. Resolves when the batch
/// IPC settles (success OR failure — failures cache as `null` so the
/// caller's fallback tile renders). Returns the number of covers
/// actually fetched (cache hits are excluded so the library's
/// "loading N covers" label stays honest on re-opens).
///
/// One IPC for the whole batch instead of N parallel invokes —
/// Tauri's command pipeline serialises through a single dispatcher
/// even when JS fires Promise.all, so per-message overhead used to
/// dominate library cold start. The batch endpoint
/// (`load_course_covers`) does the same per-cover resolution server-
/// side and returns one map.
export async function prefetchCovers(
  entries: Array<{ courseId: string; cacheBust?: number }>,
): Promise<number> {
  // Web build: covers are static files synthesized into a URL by
  // useCourseCover's web branch — no IPC, no fetch, no caching
  // here. Returning 0 keeps the library's "loading N covers"
  // label honest (no covers were fetched, because none needed to
  // be). Skipping this stops the kata invoke stub from throwing
  // "TAURI_UNAVAILABLE: load_course_covers" once per course on
  // page boot, which (caught or not) bloats the Safari console.
  if (isWeb) return 0;

  // Filter out anything already resolved or in-flight — one fewer
  // course to ship across the bridge.
  const needed: Array<{ courseId: string; cacheBust?: number; key: string }> =
    [];
  for (const e of entries) {
    const key = cacheKey(e.courseId, e.cacheBust);
    if (resolved.has(key) || inflight.has(key)) continue;
    needed.push({ ...e, key });
  }
  if (needed.length === 0) return 0;

  // Mark every "needed" entry as in-flight against the same shared
  // promise so per-card mounts that fire before this resolves dedupe
  // onto it instead of firing their own single-course IPCs.
  const ids = needed.map((e) => e.courseId);
  const batch = (async () => {
    try {
      return await invoke<Record<string, string | null>>("load_course_covers", {
        courseIds: ids,
      });
    } catch {
      return null;
    }
  })();
  for (const e of needed) {
    inflight.set(
      e.key,
      batch.then((map) => {
        const url = map ? (map[e.courseId] ?? null) : null;
        resolved.set(e.key, url);
        inflight.delete(e.key);
        notify(e.key);
        return url;
      }),
    );
  }
  await batch;
  return needed.length;
}

export function useCourseCover(
  courseId: string,
  cacheBust?: number,
): string | null {
  const key = cacheKey(courseId, cacheBust);
  // Seed from cache so the first render already has the URL when the
  // library's prefetch populated it before we mounted.
  const [dataUrl, setDataUrl] = useState<string | null>(
    () => resolved.get(key) ?? null,
  );

  useEffect(() => {
    // Web-build path: covers are static files under
    // /<base>/starter-courses/<id>.jpg (staged by
    // scripts/extract-starter-courses.mjs). Skip the Tauri IPC
    // entirely. webSeedCourses sets `course.coverFetchedAt` to a
    // non-zero value at seed time on courses whose manifest entry
    // has a `cover` field, so a truthy cacheBust here = "we know
    // this course has a cover". Skipping the synthesis when
    // cacheBust is undefined avoids the broken-image flash on
    // courses without one.
    if (isWeb) return;

    let cancelled = false;
    const k = cacheKey(courseId, cacheBust);

    // Subscribe for future cache updates (e.g. the prefetch is still
    // in flight when we mount — the notify() call will wake us up).
    const onChange = () => {
      if (cancelled) return;
      setDataUrl(resolved.get(k) ?? null);
    };
    let set = subscribers.get(k);
    if (!set) {
      set = new Set();
      subscribers.set(k, set);
    }
    set.add(onChange);

    // Trigger a fetch if the cache is empty. `fetchCover` dedupes
    // concurrent requests for the same key so we don't N+1 when
    // prefetch + hook both fire at app start.
    void fetchCover(courseId, cacheBust).then((url) => {
      if (cancelled) return;
      setDataUrl(url);
    });

    return () => {
      cancelled = true;
      set?.delete(onChange);
      if (set && set.size === 0) subscribers.delete(k);
    };
  }, [courseId, cacheBust]);

  // Web build short-circuits to the static /starter-courses/<id>.jpg
  // URL when we know the cover exists (via webSeedCourses setting
  // coverFetchedAt) — no Tauri IPC needed. Desktop falls through
  // to the cached IPC result.
  if (isWeb) {
    return cacheBust ? webCoverUrl(courseId, cacheBust) : null;
  }
  // Desktop: prefer the IPC-loaded data URL (installed copy or
  // bundled archive). When that comes back null — typically a
  // remoteCatalogFallback placeholder whose archive hasn't shipped
  // yet — fall back to the deployed CDN at libre.academy. The img
  // element fetches HTTPS directly (Tauri's CSP allows external
  // image hosts by default), so we don't pay an extra IPC. If the
  // CDN doesn't have it either, the BookCover renders the
  // language-tinted glyph as before.
  return dataUrl ?? desktopCdnCoverUrl(courseId, cacheBust);
}
