/// Outbound half of the settings sync channel — see
/// `lib/settingsSync.ts` for the full contract.
///
/// Preference modules (e.g. `useLocale`) dispatch a
/// `libre:setting-changed` CustomEvent when the user changes a synced
/// setting; they deliberately don't import the cloud stack (it lives
/// above them in the dependency graph). This hook is the missing
/// listener: mounted once next to the realtime handle in App /
/// MobileApp, it forwards each event as a `SettingRow` push so the
/// change fans out to the user's other signed-in devices.
///
/// Events observed while `applySettingRowsLocally` is folding REMOTE
/// rows into local state are dropped — pushing those back would echo
/// a row we just received and loop it between devices.

import { useEffect } from "react";
import type { RealtimeSyncHandle } from "./useRealtimeSync";
import {
  SETTING_CHANGED_EVENT,
  isApplyingRemoteSettings,
  type SettingChangedDetail,
} from "@/lib/settingsSync";

export function useSettingsSyncBridge(realtime: RealtimeSyncHandle): void {
  // Depend on the stable `pushSetting` callback rather than the whole
  // handle — the hook returns a fresh object literal every render, so
  // `[realtime]` would tear down + re-add the listener each time.
  const { pushSetting } = realtime;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<Partial<SettingChangedDetail>>).detail;
      if (
        !detail ||
        typeof detail.key !== "string" ||
        detail.key.length === 0 ||
        typeof detail.value !== "string"
      ) {
        return;
      }
      // Suppression window: this dispatch was triggered (synchronously)
      // by a remote apply — don't push it back up.
      if (isApplyingRemoteSettings()) return;
      pushSetting({
        key: detail.key,
        value: detail.value,
        updated_at: new Date().toISOString(),
      });
    };
    window.addEventListener(SETTING_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(SETTING_CHANGED_EVENT, handler);
    };
  }, [pushSetting]);
}
