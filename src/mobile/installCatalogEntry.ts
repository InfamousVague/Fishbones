/// Mobile-web catalog install. Replicates the desktop
/// `handleInstallCatalogEntry` flow (src/App.tsx) — fetch the course
/// JSON from `jsonHref(entry)`, parse it, persist via
/// `storage.saveCourse` — with ONE web-specific addition that the
/// desktop path doesn't need: stamping `coverFetchedAt`.
///
/// Why the extra stamp: on desktop, `useCourseCover` resolves covers
/// through the `load_course_cover` IPC (which extracts cover.png from
/// the bundled archive), so an installed course renders its art
/// without any per-course flag. On WEB, `useCourseCover`'s branch
/// returns `null` unless the Course record carries a truthy
/// `coverFetchedAt` — it uses that value both as the "this course has
/// a cover" signal and as the `?v=` cache-bust on the static
/// `/starter-courses/<id>.jpg` URL. The raw course JSON served at
/// `jsonHref` does NOT include `coverFetchedAt`, so a verbatim copy of
/// the desktop handler would install a course whose cover never
/// paints. `seedWebStarterCourses` handles this exact case the same
/// way (`coverFetchedAt: entry.cover ? Date.now() : undefined`); this
/// helper mirrors it so a Discover-installed course looks identical to
/// a first-launch-seeded one.
///
/// The `hidden` flag is threaded the same way the seeder does — kept
/// undefined unless the entry opts in — so strict `course.hidden ===
/// true` checks elsewhere behave. In practice Discover never surfaces
/// hidden entries (the catalog layer drops them), so this is just
/// defensive parity with the seed path.

import type { Course } from "@/data/types";
import { jsonHref, type CatalogEntry } from "@/lib/catalog";
import { storage } from "@/lib/storage";

/// Fetch + persist a catalog course into IndexedDB. Throws on network
/// / parse / storage failure so the caller can keep its per-tile
/// "installing" spinner honest and surface the error. Returns the
/// stored Course record (with the web cover stamp applied) so the
/// caller can, if it wants, use it without a re-read.
export async function installCatalogEntryWeb(
  entry: CatalogEntry,
): Promise<Course> {
  const url = jsonHref(entry);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const course = (await res.json()) as Course;
  const record: Course = {
    ...course,
    // Force the manifest id in case the JSON's own id disagrees
    // (mirrors the seeder's "cheap insurance" comment).
    id: entry.id,
    // Web cover signal + cache-bust — see the module doc above.
    coverFetchedAt: entry.cover ? Date.now() : undefined,
    hidden: entry.hidden ? true : undefined,
  };
  await storage.saveCourse(entry.id, record);
  return record;
}
