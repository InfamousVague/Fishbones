/// Per-book reading language.
///
/// Distinct from `useLocale` (the ONE app-wide UI language): a book that
/// ships translations can be READ in a language independent of the chrome.
/// A learner whose app is in English can read a course that's been
/// translated into Spanish without flipping the whole UI — and two open
/// books can be read in two different languages at once.
///
/// The selection is keyed by `courseId` and lives in a single module-level
/// store exposed to React via `useSyncExternalStore`, mirroring
/// `useLocale`'s reactivity model: every consumer of the same course
/// (the reader, and — later — the sidebar title) subscribes to the SAME
/// entry, so picking a language in the reader re-renders every surface
/// that reads it, no reload needed.
///
/// Storage is in-memory for now (resets on reload). Persisting the choice
/// to localStorage / the cloud account is a follow-up — the store shape
/// here is the seam that upgrade slots into without touching call sites.
///
/// A course with no per-book selection returns `undefined`; callers fall
/// back to the app locale (see the reader's `readingLocale` derivation).
/// Selecting a language that the book isn't actually translated into is
/// harmless — the read-time merge just falls back to English per key.

import { useCallback, useSyncExternalStore } from "react";
import { isLocale, type Locale } from "@/data/locales";

/// courseId → chosen reading locale. Absent key = "no override yet".
const store = new Map<string, Locale>();

/// Subscriber set — every mounted `useBookLocale` consumer registers its
/// React re-render callback so a `setBookLocale` notifies them all.
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/// Set (or clear-to-default) the reading locale for one book and broadcast
/// to subscribers. Exported so imperative callers can drive the same store.
export function setBookLocale(courseId: string, next: Locale): void {
  if (!isLocale(next)) return;
  if (store.get(courseId) === next) return;
  store.set(courseId, next);
  listeners.forEach((cb) => cb());
}

/// Read + set the reading locale for `courseId`. Returns `undefined` when
/// the learner hasn't picked one — the caller decides the fallback (app
/// locale, then English).
export function useBookLocale(
  courseId: string,
): readonly [Locale | undefined, (next: Locale) => void] {
  // Snapshot returns a primitive (or undefined) so referential-equality
  // stays stable between renders when unchanged — no useSyncExternalStore
  // loop.
  const selected = useSyncExternalStore(
    subscribe,
    () => store.get(courseId),
    () => undefined,
  );
  const set = useCallback(
    (next: Locale) => setBookLocale(courseId, next),
    [courseId],
  );
  return [selected, set] as const;
}
