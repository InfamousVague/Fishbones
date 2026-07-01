import { useEffect, useState } from "react";
import { isDesktop } from "@/lib/platform";
import { changelogFor, type ChangelogEntry } from "@/data/changelog";

/// localStorage key holding the last app version the user has already
/// seen the changelog for. Absent = this is the first version-aware
/// launch (fresh install or upgrade from a pre-changelog build) — we
/// record silently and DON'T pop the modal, so a new user isn't
/// greeted by a "what changed" dialog for changes they never saw.
const SEEN_KEY = "libre:changelogSeenVersion";

/// Detects "the app was just updated" and, if so, yields the changelog
/// entry to show. Desktop-only: the web build is continuously deployed,
/// so "you just updated" isn't a meaningful moment there.
///
/// Logic: compare the running Tauri version against the last-seen
/// version in localStorage.
///   - no stored version  → first version-aware run; record, show nothing
///   - stored === current → already seen; show nothing
///   - stored !== current → just updated; surface the modal
/// `dismiss()` latches the current version so it won't show again.
export function useChangelogGate(): {
  entry: ChangelogEntry | null;
  dismiss: () => void;
} {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((version) => {
        if (cancelled || !version) return;
        let seen: string | null = null;
        try {
          seen = localStorage.getItem(SEEN_KEY);
        } catch {
          /* storage blocked — treat as "already seen" and stay quiet */
          return;
        }
        if (seen === null) {
          try {
            localStorage.setItem(SEEN_KEY, version);
          } catch {
            /* ignore */
          }
          return;
        }
        if (seen !== version) {
          // Show curated notes if we have them, else a generic entry
          // (empty highlights → the modal renders a fallback line).
          setEntry(changelogFor(version) ?? { version, date: "", highlights: [] });
        }
      })
      .catch(() => {
        /* version unavailable — never block the app on this */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setEntry((cur) => {
      if (cur) {
        try {
          localStorage.setItem(SEEN_KEY, cur.version);
        } catch {
          /* ignore */
        }
      }
      return null;
    });
  };

  return { entry, dismiss };
}
