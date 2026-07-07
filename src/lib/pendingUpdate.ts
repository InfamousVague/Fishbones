/// Cross-boot marker for the in-app "Download & install" flow.
///
/// The Settings updater downloads + stages a new bundle in-app, then
/// relaunches. On macOS the freshly-swapped bundle sometimes isn't the one
/// the OS reopens on the immediate relaunch (a Launch Services race), so the
/// pre-launch updater's boot check would find the SAME update again and
/// re-download it — the "downloads twice" bug.
///
/// To fix that precisely (rather than skipping the boot check blindly, which
/// would strand anyone whose in-app install never staged), the button marks
/// the target version here the moment the download finishes. On the next
/// boot the pre-launch updater consumes the mark and compares it to the
/// version actually running:
///   - running >= target  → the swap applied, so SKIP the redundant check
///                          (no second download).
///   - running <  target  → the swap didn't take, so let the normal boot
///                          check run and download it (self-heals).
/// The mark is single-use — consumed on read — so a later boot always checks
/// normally.

const KEY = "libre:pending-update-version";

/// Record that `version` has been downloaded + staged by the in-app updater.
export function markUpdateStaged(version: string): void {
  try {
    localStorage.setItem(KEY, version.replace(/^v/, "").trim());
  } catch {
    /* private mode / quota — the boot updater just re-checks normally */
  }
}

/// Read + clear the staged-update marker (single-use). Returns the target
/// version string (no `v` prefix), or null when nothing is pending.
export function consumeStagedUpdate(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/// True when dotted-numeric `current` is >= `target` (leading `v` tolerated).
/// Used to decide whether a staged update actually applied on relaunch.
export function versionSatisfies(current: string, target: string): boolean {
  const parse = (s: string) =>
    s
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(target);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true; // equal → satisfied
}
