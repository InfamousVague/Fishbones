import { Icon } from "@base/primitives/icon";
import { crown } from "@base/primitives/icon/icons/crown";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import "./EarlyBadge.css";

/// Small crown "EARLY" pill shown next to an early-access supporter's
/// name — everywhere a name renders (leaderboard rows, friend lists,
/// friend requests, profile card, profile page). Purely decorative +
/// aria-labelled; render it ONLY when the account's `early_access` flag
/// is true (the caller gates it).
///
/// `size="sm"` (default) fits inline beside a name; `size="md"` is a
/// touch bigger for the profile headers.
export default function EarlyBadge({
  size = "sm",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  const label = t("supporter.badge");
  return (
    <span
      className={`libre-early-badge libre-early-badge--${size} ${className}`.trim()}
      title={t("supporter.badgeTitle")}
      aria-label={t("supporter.badgeTitle")}
    >
      <Icon icon={crown} size="xs" color="currentColor" />
      <span className="libre-early-badge__text">{label}</span>
    </span>
  );
}
