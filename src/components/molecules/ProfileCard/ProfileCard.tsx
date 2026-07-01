import { useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { zap } from "@base/primitives/icon/icons/zap";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { userPlus } from "@base/primitives/icon/icons/user-plus";
import { userMinus } from "@base/primitives/icon/icons/user-minus";
import { userCheck } from "@base/primitives/icon/icons/user-check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";
import { useT } from "@/i18n/i18n";
import type { PublicProfile } from "@/hooks/useLibreCloud";
import "./ProfileCard.css";

interface Props {
  /// The user id whose profile to load + display.
  userId: string;
  /// Fetches the public profile card (relationship flags included).
  getProfile: (userId: string) => Promise<PublicProfile>;
  /// Relationship actions. Each resolves when the server confirms; the
  /// card refetches afterwards so the CTA reflects the new state.
  onAddFriend: (email: string) => Promise<void>;
  onRemoveFriend: (userId: string) => Promise<void>;
  onAcceptRequest: (userId: string) => Promise<void>;
  onClose: () => void;
}

/// Overlay card showing one learner's public profile: display name,
/// a level ring, a 2×2 stats grid, member-since, and a single
/// relationship CTA chosen from `is_friend` + `friend_request_pending`:
///   - already friends           → "Remove friend"
///   - a request is pending       → "Accept request"
///   - neither                     → "Add friend"
/// The CTA calls the matching action, then refetches so the button
/// swaps to the new relationship without a full reopen.
export default function ProfileCard({
  userId,
  getProfile,
  onAddFriend,
  onRemoveFriend,
  onAcceptRequest,
  onClose,
}: Props) {
  const t = useT();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  /// Error is stored as an i18n *key* (not resolved text) so the effect
  /// can set it without depending on `t` — `useT()` returns a fresh
  /// function identity every render, and listing it in the effect deps
  /// below would loop (effect → setState → re-render → new `t` → effect).
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setErrorKey(null);
    (async () => {
      try {
        const p = await getProfile(userId);
        if (!cancelled) setProfile(p);
      } catch {
        if (!cancelled) setErrorKey("friends.profileLoadError");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, getProfile]);

  const refresh = async () => {
    try {
      const p = await getProfile(userId);
      setProfile(p);
    } catch {
      /* leave the old card up — the action itself succeeded */
    }
  };

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrorKey(null);
    try {
      await action();
      await refresh();
    } catch {
      setErrorKey("friends.actionError");
    } finally {
      setBusy(false);
    }
  };

  const error = errorKey ? t(errorKey) : null;

  const name =
    profile?.display_name?.trim() ||
    profile?.email?.split("@")[0] ||
    t("friends.anonymous");

  const memberSince = profile
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      })
    : "";

  return (
    <ModalBackdrop onDismiss={onClose} zIndex={210}>
      <div
        className="libre-profile-card-overlay"
        role="dialog"
        aria-label={t("friends.profileTitle")}
      >
        <button
          type="button"
          className="libre-profile-card-close"
          onClick={onClose}
          aria-label={t("friends.close")}
        >
          <Icon icon={xIcon} size="sm" color="currentColor" />
        </button>

        {!profile && !error && (
          <p className="libre-profile-card-empty">{t("friends.loading")}</p>
        )}
        {error && !profile && (
          <p className="libre-profile-card-empty libre-profile-card-empty--error">
            {error}
          </p>
        )}

        {profile && (
          <>
            <div className="libre-profile-card-head">
              <ProgressRing
                progress={1}
                size={64}
                stroke={4}
                label={String(profile.stats.level)}
                sublabel={t("friends.level")}
                hideCheckOnComplete
              />
              <div className="libre-profile-card-head-text">
                <div className="libre-profile-card-name">{name}</div>
                {memberSince && (
                  <div className="libre-profile-card-since">
                    {t("friends.memberSince", { date: memberSince })}
                  </div>
                )}
              </div>
            </div>

            <div className="libre-profile-card-stats">
              <StatCell
                icon={flame}
                tone="streak"
                value={profile.stats.current_streak_days}
                label={t("friends.streak")}
              />
              <StatCell
                icon={trophy}
                tone="longest"
                value={profile.stats.longest_streak_days}
                label={t("friends.longest")}
              />
              <StatCell
                icon={bookOpenCheck}
                tone="lessons"
                value={profile.stats.lessons_completed}
                label={t("friends.lessons")}
              />
              <StatCell
                icon={zap}
                tone="xp"
                value={profile.stats.total_xp}
                label={t("friends.xp")}
              />
            </div>

            {error && (
              <p className="libre-profile-card-error">{error}</p>
            )}

            <div className="libre-profile-card-cta">
              {profile.is_friend ? (
                <button
                  type="button"
                  className="libre-profile-card-btn libre-profile-card-btn--ghost"
                  disabled={busy}
                  onClick={() => runAction(() => onRemoveFriend(profile.id))}
                >
                  <Icon icon={userMinus} size="xs" color="currentColor" />
                  <span>{t("friends.remove")}</span>
                </button>
              ) : profile.friend_request_pending ? (
                <button
                  type="button"
                  className="libre-profile-card-btn libre-profile-card-btn--primary"
                  disabled={busy}
                  onClick={() => runAction(() => onAcceptRequest(profile.id))}
                >
                  <Icon icon={userCheck} size="xs" color="currentColor" />
                  <span>{t("friends.acceptRequest")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="libre-profile-card-btn libre-profile-card-btn--primary"
                  disabled={busy || !profile.email}
                  onClick={() =>
                    profile.email &&
                    runAction(() => onAddFriend(profile.email as string))
                  }
                >
                  <Icon icon={userPlus} size="xs" color="currentColor" />
                  <span>{t("friends.add")}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}

function StatCell({
  icon,
  tone,
  value,
  label,
}: {
  icon: string;
  tone: "streak" | "longest" | "lessons" | "xp";
  value: number;
  label: string;
}) {
  return (
    <div className={`libre-profile-card-stat libre-profile-card-stat--${tone}`}>
      <span className="libre-profile-card-stat-icon" aria-hidden>
        <Icon icon={icon} size="xs" color="currentColor" weight="bold" />
      </span>
      <span className="libre-profile-card-stat-value">{value}</span>
      <span className="libre-profile-card-stat-label">{label}</span>
    </div>
  );
}
