import { useEffect, useState } from "react";
import { flame } from "@base/primitives/icon/icons/flame";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { zap } from "@base/primitives/icon/icons/zap";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { userPlus } from "@base/primitives/icon/icons/user-plus";
import { userMinus } from "@base/primitives/icon/icons/user-minus";
import { userCheck } from "@base/primitives/icon/icons/user-check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { Icon } from "@base/primitives/icon";
import { Avatar } from "@base/primitives/avatar";
import { Badge } from "@base/primitives/badge";
import { Button } from "@base/primitives/button";
import { Chip } from "@base/primitives/chip";
import { Skeleton } from "@base/primitives/skeleton";
import "@base/primitives/icon/icon.css";
import "@base/primitives/avatar/avatar.css";
import "@base/primitives/badge/badge.css";
import "@base/primitives/button/button.css";
import "@base/primitives/chip/chip.css";
import "@base/primitives/skeleton/skeleton.css";
import "@base/primitives/spinner/spinner.css";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";
import SupporterCard from "@/components/molecules/SupporterCard/SupporterCard";
import EarlyBadge from "@/components/molecules/EarlyBadge/EarlyBadge";
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
  /// Optional because the embedded (own-profile) variant renders no
  /// relationship CTA at all.
  onAddFriend?: (email: string) => Promise<unknown>;
  onRemoveFriend?: (userId: string) => Promise<void>;
  onAcceptRequest?: (userId: string) => Promise<void>;
  onClose?: () => void;
  /// Render the card body INLINE (no ModalBackdrop, no close button,
  /// no relationship CTA) — used by the Social view to show the
  /// signed-in learner's OWN profile as a hero card above the friends
  /// list. Same fetch + markup path as the overlay, so the two stay
  /// visually in lockstep.
  embedded?: boolean;
}

/// Card showing one learner's public profile: kit Avatar + display
/// name, a level ring, streak/lessons/XP stats, member-since, and a
/// single relationship CTA chosen from `is_friend` +
/// `friend_request_pending`:
///   - already friends           → "Remove friend"
///   - a request is pending       → "Accept request"
///   - neither                     → "Add friend"
/// The CTA calls the matching action, then refetches so the button
/// swaps to the new relationship without a full reopen.
///
/// Two render modes share the same body: the default overlay (inside
/// <ModalBackdrop>) and `embedded` (inline hero for your own profile —
/// stats become kit Chips, a "You" badge marks it, and the CTA row is
/// dropped since you can't befriend yourself).
export default function ProfileCard({
  userId,
  getProfile,
  onAddFriend,
  onRemoveFriend,
  onAcceptRequest,
  onClose,
  embedded = false,
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
      } catch (err) {
        // Surface the real failure (status code etc.) for diagnosis —
        // the UI copy stays generic, but the console shouldn't.
        console.error("[libre] profile load failed:", userId, err);
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

  const runAction = async (action: () => Promise<unknown>) => {
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

  // Legacy relay rows can carry an empty created_at (the column was
  // backfilled with '' for accounts that predate it) — `new Date("")`
  // is Invalid Date, which would render "member since Invalid Date".
  // Only show the line when the date actually parses.
  const createdDate = profile ? new Date(profile.created_at) : null;
  const memberSince =
    createdDate && Number.isFinite(createdDate.getTime())
      ? createdDate.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
        })
      : "";

  const body = (
    <>
      {/* Initial load — skeleton mirrors the loaded head so the card
          doesn't jump when real data lands. */}
      {!profile && !error && (
        <div className="libre-profile-card-head" aria-busy="true">
          <Avatar skeleton size={embedded ? "xl" : "lg"} />
          <div className="libre-profile-card-head-text">
            <Skeleton size="text-base" width="60%" />
            <Skeleton size="text-xs" width="40%" />
          </div>
          <Skeleton
            shape="circle"
            width={embedded ? 72 : 64}
            height={embedded ? 72 : 64}
          />
        </div>
      )}
      {error && !profile && (
        <p className="libre-profile-card-empty libre-profile-card-empty--error">
          {error}
        </p>
      )}

      {profile && (
        <>
          <div className="libre-profile-card-head">
            <Avatar
              initials={initialsOf(profile.display_name, profile.email)}
              size={embedded ? "xl" : "lg"}
              alt={name}
            />
            <div className="libre-profile-card-head-text">
              <div className="libre-profile-card-name">
                <span className="libre-profile-card-name-text">{name}</span>
                {profile.early_access && <EarlyBadge size="md" />}
                {embedded && (
                  <Badge color="accent" variant="solid" size="sm">
                    {t("leaderboard.you")}
                  </Badge>
                )}
              </div>
              {profile.email && profile.display_name?.trim() && (
                <div className="libre-profile-card-email">{profile.email}</div>
              )}
              {memberSince && (
                <div className="libre-profile-card-since">
                  {t("friends.memberSince", { date: memberSince })}
                </div>
              )}
            </div>
            <ProgressRing
              progress={1}
              size={embedded ? 72 : 64}
              stroke={4}
              label={String(profile.stats.level)}
              sublabel={t("friends.level")}
              hideCheckOnComplete
            />
          </div>

          {/* Early-access supporter badge — a compact full-width row
              just under the head, above the stats/chips. Gated on the
              account's `early_access` flag so only supporters see it. */}
          {profile.early_access && (
            <SupporterCard className="libre-profile-card-supporter" />
          )}

          {embedded ? (
            /* Own-profile hero — compact chip row instead of the 2×2
               grid; the hero sits above the friends list and should
               read in one line. */
            <div className="libre-profile-card-chips">
              <Chip size="sm" icon={flame}>
                {t("friends.chipStreak", {
                  n: profile.stats.current_streak_days,
                })}
              </Chip>
              <Chip size="sm" icon={zap}>
                {t("friends.chipXp", { n: profile.stats.total_xp })}
              </Chip>
              <Chip size="sm" icon={bookOpenCheck}>
                {t("friends.chipLessons", {
                  n: profile.stats.lessons_completed,
                })}
              </Chip>
            </div>
          ) : (
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
          )}

          {error && <p className="libre-profile-card-error">{error}</p>}

          {!embedded && (
            <div className="libre-profile-card-cta">
              {profile.is_friend ? (
                <Button
                  variant="secondary"
                  icon={userMinus}
                  loading={busy}
                  onClick={() =>
                    onRemoveFriend &&
                    runAction(() => onRemoveFriend(profile.id))
                  }
                >
                  {t("friends.remove")}
                </Button>
              ) : profile.friend_request_pending ? (
                <Button
                  variant="primary"
                  icon={userCheck}
                  loading={busy}
                  onClick={() =>
                    onAcceptRequest &&
                    runAction(() => onAcceptRequest(profile.id))
                  }
                >
                  {t("friends.acceptRequest")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={userPlus}
                  loading={busy}
                  disabled={!profile.email}
                  onClick={() =>
                    onAddFriend &&
                    profile.email &&
                    runAction(() => onAddFriend(profile.email as string))
                  }
                >
                  {t("friends.add")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return (
      <section
        className="libre-profile-card libre-profile-card--embedded"
        aria-label={t("friends.profileTitle")}
      >
        {body}
      </section>
    );
  }

  return (
    <ModalBackdrop onDismiss={() => onClose?.()} zIndex={210}>
      <div
        className="libre-profile-card libre-profile-card--overlay"
        role="dialog"
        aria-label={t("friends.profileTitle")}
      >
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={xIcon}
          className="libre-profile-card-close"
          onClick={() => onClose?.()}
          aria-label={t("friends.close")}
        />
        {body}
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

/// 1–2 letter initials for the kit Avatar — display name wins, then
/// email; empty string lets Avatar render its neutral blank circle.
export function initialsOf(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const src = name?.trim() || email?.trim() || "";
  if (!src) return "";
  const words = src.split(/[\s._@-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return src.slice(0, 1).toUpperCase();
}
