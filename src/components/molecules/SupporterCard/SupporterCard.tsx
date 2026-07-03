import { Icon } from "@base/primitives/icon";
import { sparkles } from "@base/primitives/icon/icons/sparkles";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import "./SupporterCard.css";

interface Props {
  className?: string;
}

/// Celebratory "Supporter" badge card, shown to accounts carrying the
/// `early_access` flag (they joined the early-access list). Full-width,
/// self-contained, and token-driven: a slow animated multi-stop gradient
/// (accent hue + complementary hues) behind a sparkles icon, a bold
/// title, and a thank-you subtitle. Text is near-white with a soft
/// shadow so it stays readable over the gradient. The animation holds
/// still under `prefers-reduced-motion: reduce` (see the CSS).
///
/// Props are intentionally minimal — the only knob is `className` so
/// callers (the ProfileCard popup, the ProfileView page) can slot it
/// into their own grid/flow. All copy comes through i18n (`supporter.*`).
export default function SupporterCard({ className }: Props) {
  const t = useT();
  return (
    <section
      className={`libre-supporter-card${className ? ` ${className}` : ""}`}
      aria-label={t("supporter.title")}
    >
      <span className="libre-supporter-card-icon" aria-hidden>
        <Icon icon={sparkles} size="lg" color="currentColor" weight="bold" />
      </span>
      <div className="libre-supporter-card-text">
        <span className="libre-supporter-card-title">{t("supporter.title")}</span>
        <span className="libre-supporter-card-body">{t("supporter.body")}</span>
      </div>
    </section>
  );
}
