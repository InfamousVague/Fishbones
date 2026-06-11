/// One-shot "start the account fresh" orchestrator.
///
/// Wipes every piece of progress, every cached course, every
/// achievement, every cache that the learner has ever earned or
/// downloaded — then forces a clean re-seed of the bundled / web
/// starter set on the next launch. The only things that survive
/// are the user's PREFERENCES (theme, locale, sign-in token,
/// AI host config) since those are chosen, not earned.
///
/// Designed to be safe to call from a single button click. Never
/// throws — every step has its own try/catch and feeds into a
/// structured `ResetAccountReport` so the UI can show a precise
/// "what landed, what didn't" toast.
///
/// What it WIPES:
///   - **Local progress** — Tauri SQLite OR IndexedDB completions
///   - **Installed courses** — every `delete_course` IPC on desktop
///     (so first-launch reseed runs again from bundled-packs/), every
///     IDB course record on web (the SEED_VERSION bump alongside this
///     ensures the next page load re-fetches the manifest)
///   - **Ingest cache** — Tauri `cache_clear` so a returning user
///     doesn't see ghost AI-import responses from a previous session
///   - **IDB seed flag** — wiped on web so the next visit re-pulls
///     the manifest into a freshly-emptied IDB
///   - Every progress-shaped localStorage key:
///       fb:achievements:unlocked, fb:achievements:freezes-used,
///       fb:streak-shields:v1, fb:streak-frozen-days:v1,
///       libre-practice-history-v1, libre:practice:records:v1,
///       libre:practice:today:v1, libre:recent-courses:v1,
///       libre:notifications:last-seen-at,
///       libre:open-tabs:v2, fb:catalog-cache-v2
///   - **Cloud progress** — DELETE /progress (best-effort;
///     falls back to local-only if the relay route 404s)
///
/// What it KEEPS (preferences):
///   - Sign-in token + cached user (the account itself isn't deleted —
///     `cloud.deleteAccount()` is the heavier door)
///   - Theme, locale, library/mobile view modes
///   - SFX enabled / volume, dev console flag
///   - AI host config + API keys
///   - Banner dismissals (install / update)
///
/// Caller is expected to `window.location.reload()` after this
/// resolves so the rebooted React tree picks up the empty state
/// (the seed runs on next mount).

import { storage, metaDelete } from "./storage";
import { isWeb } from "./platform";
import type { UseLibreCloud } from "../hooks/useLibreCloud";

/// localStorage keys that carry progress-shaped (earned) data. Kept
/// here rather than imported from the constituent modules because
/// most expose the key only as a private `const STORAGE_KEY` —
/// duplicating the literal at this single coordinator keeps the
/// "what counts as progress" list scannable in one place.
const ACCOUNT_STATE_KEYS: readonly string[] = [
  // Streak shields + frozen-day registry
  "libre:streak-shields:v1",
  "libre:streak-frozen-days:v1",
  // Practice history (two key generations — the older flat-history
  // hook + the newer per-record store both persist independently;
  // wipe both so the SRS schedule starts from scratch)
  "libre-practice-history-v1",
  "libre:practice:records:v1",
  "libre:practice:today:v1",
  // Recents row + notification drawer marker
  "libre:recent-courses:v1",
  "libre:notifications:last-seen-at",
  // Workbench-side state that can carry stale references to courses
  // we're about to delete (stale tabs would 404 their lessons after
  // the reseed renames things)
  "libre:open-tabs:v2",
  // In-memory catalog cache. Without this, the SWR layer would
  // re-paint the just-wiped Discover grid from the cached snapshot
  // before the network refetch completes.
  "libre:catalog-cache-v2",
];

/// IDB meta keys to clear so the next page load re-runs the seed.
const META_KEYS_TO_CLEAR: readonly string[] = [
  "starterCoursesSeeded",
  "starterCoursesSeededIds",
];

export interface ResetAccountReport {
  /// True when local completions, every account-state localStorage
  /// key, and the installed courses were successfully cleared.
  localCleared: boolean;
  /// True when every installed course was deleted.
  coursesCleared: boolean;
  /// True when the relay confirmed it wiped the user's progress
  /// rows. False when the user wasn't signed in OR the relay route
  /// isn't implemented OR the network call failed — the local wipe
  /// still went through.
  relayCleared: boolean;
  /// Human-readable summary the UI can surface as a toast / status.
  message: string;
}

export async function resetAccount(
  cloud: Pick<UseLibreCloud, "resetProgress" | "signedIn">,
): Promise<ResetAccountReport> {
  let localCleared = true;
  let coursesCleared = true;
  let relayCleared = false;

  // 1. Wipe ingest cache (desktop only — quick, no-op on web).
  if (!isWeb) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("cache_clear", { bookId: "" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[reset] cache_clear failed:", e);
    }
  }

  // 2. Wipe completions in the active backend (Tauri SQLite or IDB).
  try {
    await storage.clearAllCompletions();
  } catch (e) {
    localCleared = false;
    // eslint-disable-next-line no-console
    console.warn("[reset] clearAllCompletions failed:", e);
  }

  // 3. Wipe every installed course. Desktop: enumerate then
  // delete_course one-by-one (the IPC has no bulk variant). Web:
  // walk the IDB course store + delete each row.
  //
  // Desktop ALSO needs to clear `<app-data>/seeded-packs.json` after
  // delete_course runs. ensure_seed treats ids in that marker's
  // seed_ids array as "user explicitly deleted, don't resurrect" —
  // without wiping the marker, the next-launch reseed walks every
  // bundled archive and skips them all, leaving the user with an
  // empty library after Start-fresh.
  try {
    if (!isWeb) {
      const { invoke } = await import("@tauri-apps/api/core");
      const installed = await invoke<Array<{ id: string }>>("list_courses");
      for (const c of installed) {
        try {
          await invoke("delete_course", { courseId: c.id });
        } catch (e) {
          coursesCleared = false;
          // eslint-disable-next-line no-console
          console.warn(`[reset] delete_course(${c.id}) failed:`, e);
        }
      }
      // Wipe the seed marker so ensure_seed re-imports every bundled
      // archive on the next launch. Best-effort — if this fails the
      // user's library stays empty, but the rest of the reset already
      // succeeded and a future SEED_VERSION bump would still recover.
      try {
        await invoke("reset_seed_marker");
      } catch (e) {
        coursesCleared = false;
        // eslint-disable-next-line no-console
        console.warn("[reset] reset_seed_marker failed:", e);
      }
    } else {
      // Web: storage.deleteCourse for each course in the IDB.
      const summaries = await storage.listCoursesSummary();
      for (const c of summaries) {
        try {
          await storage.deleteCourse(c.id);
        } catch (e) {
          coursesCleared = false;
          // eslint-disable-next-line no-console
          console.warn(`[reset] deleteCourse(${c.id}) failed:`, e);
        }
      }
    }
  } catch (e) {
    coursesCleared = false;
    // eslint-disable-next-line no-console
    console.warn("[reset] enumerate-then-delete courses failed:", e);
  }

  // 4. Web: drop the IDB seed flags so the seeder re-runs on the
  // next page load and re-pulls every starter book into a clean DB.
  if (isWeb) {
    for (const key of META_KEYS_TO_CLEAR) {
      try {
        await metaDelete(key);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[reset] metaDelete(${key}) failed:`, e);
      }
    }
  }

  // 4a. Wipe earned certificates. They live behind the storage meta
  // layer (which is shared across desktop + web), so this fires on
  // both paths. The Certificates page re-reads on the
  // `libre:certificates-changed` event the helper dispatches.
  try {
    const { clearCertificates } = await import("../data/certificates");
    const { notifyCertificatesChanged } = await import(
      "../hooks/useCertificates"
    );
    await clearCertificates();
    notifyCertificatesChanged();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[reset] clearCertificates failed:", e);
  }

  // 5. Wipe each progress-shaped localStorage key. Each removeItem
  // is independent — a failure on one key (quota / private mode)
  // doesn't strand the rest. Synthetic StorageEvents nudge the live
  // UI hooks to re-read in this tab too (the native event only
  // fires in OTHER tabs).
  if (typeof localStorage !== "undefined") {
    for (const key of ACCOUNT_STATE_KEYS) {
      try {
        localStorage.removeItem(key);
        if (typeof window !== "undefined") {
          try {
            window.dispatchEvent(new StorageEvent("storage", { key }));
          } catch {
            /* SSR / older browsers — ignore */
          }
        }
      } catch (e) {
        localCleared = false;
        // eslint-disable-next-line no-console
        console.warn(`[reset] removeItem(${key}) failed:`, e);
      }
    }
  }

  // 6. Best-effort relay wipe. The cloud helper handles its own
  // error surfaces — we just translate the boolean.
  if (cloud.signedIn) {
    try {
      relayCleared = await cloud.resetProgress();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[reset] cloud.resetProgress threw:", e);
      relayCleared = false;
    }
  }

  const parts: string[] = [];
  if (localCleared && coursesCleared) {
    parts.push("local progress + every installed course wiped");
  } else if (localCleared) {
    parts.push("local progress wiped — some courses didn't delete (see console)");
  } else if (coursesCleared) {
    parts.push("courses wiped — some progress keys didn't clear (see console)");
  } else {
    parts.push("local wipe partially failed (see console)");
  }
  if (cloud.signedIn) {
    parts.push(
      relayCleared
        ? "cloud progress wiped — other devices will sync the empty state on next pull"
        : "cloud wipe didn't go through (relay route missing or offline) — sign out + back in on each device to force-pull the local state",
    );
  } else {
    parts.push("not signed in, so cross-device sync was skipped");
  }
  return {
    localCleared: localCleared && coursesCleared,
    coursesCleared,
    relayCleared,
    message: parts.join(". ") + ".",
  };
}
