/// Course-level image registry.
///
/// De-duplicated courses store each unique illustration ONCE in a
/// top-level `course.images` map — `{ <hash>: "data:image/webp;base64,…" }`
/// — and every lesson body (English + each translation) references it as
/// a tiny `![alt](asset://<hash> "caption")` instead of re-embedding the
/// base64 six times over. That's what drops a course like the Rust book
/// from 25MB to ~6.6MB.
///
/// This registry lets the lesson renderer resolve those `asset://<hash>`
/// refs back to real data URIs at paint time — lazily, only for images
/// that scroll into view — without threading the whole map down through
/// the component tree. Register a course's map once when it becomes
/// active; the reader looks images up by `(courseId, hash)`.

const registry = new Map<string, Record<string, string>>();

/// Register (or refresh) a course's image map. No-op for courses that
/// have no `images` field (the un-migrated majority still inline their
/// images as data: URIs, which the renderer passes through untouched).
export function registerCourseImages(
  courseId: string,
  images: Record<string, string> | undefined | null,
): void {
  if (images && typeof images === "object" && Object.keys(images).length > 0) {
    registry.set(courseId, images);
  }
}

/// Resolve one `asset://<hash>` ref to its data URI, or undefined if the
/// course isn't registered / the hash is unknown.
export function resolveCourseAsset(
  courseId: string,
  hash: string,
): string | undefined {
  return registry.get(courseId)?.[hash];
}

/// Whether we have a de-duplicated image map for this course.
export function hasCourseImages(courseId: string): boolean {
  return registry.has(courseId);
}

/// Test/seam: clear the registry.
export function __clearCourseImages(): void {
  registry.clear();
}
