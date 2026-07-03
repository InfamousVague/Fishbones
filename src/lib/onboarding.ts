/// First-launch onboarding wizard gate.
///
/// The wizard runs ONCE for genuinely new users, walking them through theme →
/// privacy → a couple of basic settings. Existing users — who already went
/// through the old first-launch theme picker (`libre:theme-picked-v1`) — are
/// treated as already-onboarded so the wizard never appears retroactively for
/// someone mid-course.
///
/// The wizard OWNS theme selection now, so completing it also stamps the legacy
/// theme-picked latch — that keeps the standalone `ThemePickerFirstLaunch` from
/// double-prompting and lets any downstream first-launch surface that waits on
/// that latch (the sign-in nudge) chain correctly after the wizard.

const ONBOARDED_KEY = "libre:onboarded-v1";
const LEGACY_THEME_PICKED_KEY = "libre:theme-picked-v1";

/// True if the user has completed onboarding OR is a pre-existing user (already
/// picked a theme in the old first-run flow). Defaults to `true` when storage
/// is unavailable so we never nag a user who can't persist the dismissal.
export function hasOnboarded(): boolean {
  try {
    return (
      localStorage.getItem(ONBOARDED_KEY) === "1" ||
      !!localStorage.getItem(LEGACY_THEME_PICKED_KEY)
    );
  } catch {
    return true;
  }
}

/// True only for a genuinely-new user who should see the onboarding wizard.
export function shouldShowOnboarding(): boolean {
  return !hasOnboarded();
}

/// Latch onboarding complete. Also stamps the legacy theme-picked key so the
/// standalone first-launch theme picker stays suppressed and the sign-in nudge
/// (which waits on that latch) opens next.
export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
    localStorage.setItem(LEGACY_THEME_PICKED_KEY, "1");
  } catch {
    /* private mode — wizard may re-appear next launch, harmless */
  }
}
