import { useEffect, useState } from "react";
import { terminal } from "@base/primitives/icon/icons/terminal";

import SettingsCard, { SettingsPage } from "./SettingsCard";
import SettingsRow from "./SettingsRow";
import SettingsToggle from "./SettingsToggle";
import { useT } from "@/i18n/i18n";

const FLAG_KEY = "libre:devconsole";

/// Developer settings. Hidden from the rail by default — the parent
/// dialog reveals it only after the user has tapped the version
/// number in the footer 10× in a row. Currently surfaces a single
/// affordance: the floating dev console toggle. The celebration
/// tester that used to live here was retired alongside the
/// coin-burst effect (see `lib/celebrate.ts`).
export default function DeveloperPane() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FLAG_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Re-sync if devconsole.js was toggled by another path (the
  // panel's × button, or a second tab). Polling at 1Hz is fine for
  // a settings dialog open briefly.
  useEffect(() => {
    const id = window.setInterval(() => {
      let live = false;
      try {
        live = localStorage.getItem(FLAG_KEY) === "1";
      } catch {
        live = false;
      }
      setEnabled((prev) => (prev === live ? prev : live));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  function toggle(next: boolean) {
    // Prefer the runtime API exposed by devconsole.js — it
    // mounts/unmounts the panel live without a reload AND flushes
    // the buffered logs into the panel on toggle-on.
    const api = (
      window as unknown as { __fbDevConsole_toggle?: () => "on" | "off" }
    ).__fbDevConsole_toggle;
    if (api) {
      const result = api();
      setEnabled(result === "on");
      return;
    }
    // Fallback: devconsole.js didn't load. Flip the flag and reload.
    try {
      if (next) localStorage.setItem(FLAG_KEY, "1");
      else localStorage.removeItem(FLAG_KEY);
    } catch {
      /* private mode / quota — silently fail */
    }
    setEnabled(next);
    window.location.reload();
  }

  return (
    <SettingsPage
      title={t("settings.developerTitle")}
      description={t("settings.developerDescription")}
    >
      <SettingsCard title={t("settings.consoleCard")}>
        <SettingsRow
          icon={terminal}
          tone={enabled ? "accent" : "default"}
          label={t("settings.showDevConsole")}
          sub={
            enabled
              ? t("settings.devConsoleOn")
              : t("settings.devConsoleOff")
          }
          control={
            <SettingsToggle
              checked={enabled}
              onChange={toggle}
              label={t("settings.showDevConsole")}
            />
          }
        />
      </SettingsCard>
    </SettingsPage>
  );
}
