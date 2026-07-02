/// Shared plumbing for the cross-device `settings` sync channel.
///
/// Two directions, one contract:
///
///   - **Outbound**: a preference module (e.g. `useLocale`) persists
///     its value to localStorage and dispatches a
///     `libre:setting-changed` CustomEvent whose detail is
///     `{ key, value }` where `key` is the LITERAL localStorage key
///     and `value` is the EXACT string stored under it. The
///     `useSettingsSyncBridge` hook (mounted next to the realtime
///     handle in App / MobileApp) forwards that detail as a
///     `SettingRow` push.
///
///   - **Inbound**: `applySettingRowsLocally` (called from the
///     realtime `applySettings` appliers) writes each row straight
///     back into localStorage under `row.key` — a perfect round-trip
///     because outbound rows carry the storage-level encoding — and
///     then folds keys with live in-memory stores (currently the
///     locale) into those stores so mounted consumers repaint without
///     a reload.
///
/// Feedback-loop guard: applying a remote row flips a module-level
/// suppression flag for the duration of the (synchronous) apply.
/// CustomEvent dispatch is synchronous, so any `libre:setting-changed`
/// fired from inside the apply (e.g. a store notification chain
/// re-entering a preference setter) is observed by the bridge while
/// the flag is up and dropped instead of being pushed back to the
/// relay — without this, a remote apply could re-push the row it just
/// received and ping-pong between devices forever.

import { isLocale, LOCALE_STORAGE_KEY } from "@/data/locales";
import { setStoredLocale } from "@/hooks/useLocale";

/// Event name shared with the dispatch site in `useLocale` (kept as a
/// literal there to avoid a hooks→lib→hooks import cycle).
export const SETTING_CHANGED_EVENT = "libre:setting-changed";

/// Shape of the `libre:setting-changed` CustomEvent detail.
export interface SettingChangedDetail {
  /// The literal localStorage key the value lives under.
  key: string;
  /// The exact string persisted under that key (JSON-encoded where
  /// the reading module expects JSON).
  value: string;
}

let applyingRemoteSettings = false;

/// True while `applySettingRowsLocally` is folding remote rows into
/// local storage / live stores. The outbound bridge checks this to
/// avoid re-pushing a setting we just received.
export function isApplyingRemoteSettings(): boolean {
  return applyingRemoteSettings;
}

/// Apply a batch of settings rows pulled from the relay (or pushed by
/// a sibling device over the WS bus) to this device. Writes each
/// value to localStorage under its wire key, then updates any live
/// in-memory store keyed by that setting so the UI reflects the
/// change immediately:
///
///   - `LOCALE_STORAGE_KEY` → `setStoredLocale`, so every mounted
///     `useLocale()` / `useT()` consumer re-renders in the new
///     language. Values are parsed defensively (JSON-quoted `"es"`
///     per the storage encoding, with a bare-code fallback) and
///     unrecognised locales are ignored rather than applied.
///
/// Idempotent: re-applying the current value is a no-op end to end.
export function applySettingRowsLocally(
  rows: ReadonlyArray<{ key: string; value: string }>,
): void {
  applyingRemoteSettings = true;
  try {
    for (const r of rows) {
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(r.key, r.value);
        } catch {
          /* quota / private mode — still fold into live state below */
        }
      }
      if (r.key === LOCALE_STORAGE_KEY) {
        let parsed: unknown = r.value;
        try {
          parsed = JSON.parse(r.value);
        } catch {
          /* not JSON — treat the raw string as a bare locale code */
        }
        if (isLocale(parsed)) {
          setStoredLocale(parsed);
        }
      }
    }
  } finally {
    applyingRemoteSettings = false;
  }
}
