import { Badge } from "@base/primitives/badge";
import { crown } from "@base/primitives/icon/icons/crown";
import "@base/primitives/badge/badge.css";
import { useT } from "@/i18n/i18n";

/// Small crown "EARLY" pill shown next to an early-access supporter's
/// name — everywhere a name renders (leaderboard rows, friend lists,
/// friend requests, profile card, profile page). Renders as the app's
/// standard `Badge` primitive so it matches every other pill on the
/// site (same radius / padding / accent token); render it ONLY when the
/// account's `early_access` flag is true (the caller gates it).
export default function EarlyBadge({
  size = "sm",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  return (
    <Badge
      color="accent"
      variant="solid"
      size={size}
      icon={crown}
      className={className}
    >
      {t("supporter.badge")}
    </Badge>
  );
}
