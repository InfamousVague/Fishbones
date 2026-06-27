import { useEffect, useState } from "react";
import type { UseLibreCloud } from "../../../hooks/useLibreCloud";
import { useT } from "../../../i18n/i18n";
import SignInDialog from "./SignInDialog";

/// First-launch sign-in nudge.
///
/// Wakes up once on the very first session (no token, no "skip"
/// pref recorded), opens the SignInDialog with a softer headline,
/// and surfaces a "Don't show this again" checkbox the user can
/// flip to suppress future prompts. After they sign in, skip, or
/// close the modal, the decision sticks in localStorage:
///
///   - sign in       → token gets written, user is logged in,
///                     prompt never reappears
///   - skip + tick   → libre:cloud:dismissed-v1 = "permanent"
///   - skip          → "session" (we re-prompt next launch)
///   - close (×)     → "session" (treated like skip — same intent)
///
/// All gating happens here, so the only thing the parent has to do
/// is render `<FirstLaunchPrompt cloud={cloud} />` near the top of
/// the tree. The component renders nothing until it decides to show.

const DISMISS_KEY = "libre:cloud:dismissed-v1";

function readDismissed(): "permanent" | "session" | null {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    return v === "permanent" || v === "session" ? v : null;
  } catch {
    return null;
  }
}
function writeDismissed(v: "permanent" | "session"): void {
  try {
    localStorage.setItem(DISMISS_KEY, v);
  } catch {
    /* ignore */
  }
}

interface Props {
  cloud: UseLibreCloud;
}

export default function FirstLaunchPrompt({ cloud }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Decide whether to open. We wait until the cloud hook has
  // resolved its boot state — `cloud.user === null` means "we have a
  // stored token and are still checking it"; we don't want to flash
  // the prompt over an already-signed-in user just because the `me`
  // request hasn't returned yet.
  useEffect(() => {
    if (cloud.user !== false) return; // null = booting, object = signed in
    if (readDismissed() === "permanent") return;
    let timer = 0;
    // Wait until the first-launch THEME PICKER has been resolved (a theme was
    // picked / dismissed) so the two first-run modals don't stack. The picker
    // writes `libre:theme-picked-v1` in the same tab (no cross-tab `storage`
    // event), so poll for it.
    const tryOpen = () => {
      let picked = false;
      try {
        picked = !!localStorage.getItem("libre:theme-picked-v1");
      } catch {
        picked = true; // localStorage unavailable — don't block the prompt
      }
      if (!picked) {
        timer = window.setTimeout(tryOpen, 500);
        return;
      }
      // Slight delay so the prompt arrives after the picker closes and the
      // bootloader has faded. Feels less ambush-y.
      timer = window.setTimeout(() => setOpen(true), 600);
    };
    tryOpen();
    return () => window.clearTimeout(timer);
  }, [cloud.user]);

  if (!open) return null;

  const handleSkip = () => {
    writeDismissed(dontShowAgain ? "permanent" : "session");
  };

  const handleClose = () => {
    // If they got here without signing in, treat the close as a skip.
    if (!cloud.signedIn) {
      writeDismissed(dontShowAgain ? "permanent" : "session");
    }
    setOpen(false);
  };

  return (
    <>
      <SignInDialog
        cloud={cloud}
        onClose={handleClose}
        showSkipButton
        onSkip={handleSkip}
        headline={t("auth.firstLaunchHeadline")}
        blurb={t("auth.firstLaunchBlurb")}
      />
      {/* "Don't show again" sits inside the modal flow rather than
          as a separate widget so the user sees it before deciding to
          dismiss. Absolute-positioned over the backdrop layer. */}
      <div className="libre-firstlaunch-dontshow">
        <label>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>{t("auth.dontShowAgain")}</span>
        </label>
      </div>
    </>
  );
}
