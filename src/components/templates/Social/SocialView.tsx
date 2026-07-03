import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { zap } from "@base/primitives/icon/icons/zap";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { users } from "@base/primitives/icon/icons/users";
import { globe } from "@base/primitives/icon/icons/globe";
import { userPlus } from "@base/primitives/icon/icons/user-plus";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { check } from "@base/primitives/icon/icons/check";
import { frown } from "@base/primitives/icon/icons/frown";
import { logIn } from "@base/primitives/icon/icons/log-in";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import { SegmentedControl } from "@base/primitives/segmented-control";
import { Avatar } from "@base/primitives/avatar";
import { Badge } from "@base/primitives/badge";
import { Button } from "@base/primitives/button";
import { Chip } from "@base/primitives/chip";
import { Skeleton } from "@base/primitives/skeleton";
import "@base/primitives/icon/icon.css";
import "@base/primitives/segmented-control/segmented-control.css";
import "@base/primitives/avatar/avatar.css";
import "@base/primitives/badge/badge.css";
import "@base/primitives/button/button.css";
import "@base/primitives/chip/chip.css";
import "@base/primitives/skeleton/skeleton.css";
import "@base/primitives/spinner/spinner.css";
import EarlyBadge from "@/components/molecules/EarlyBadge/EarlyBadge";
import { useLeaderboardName } from "@/hooks/useLeaderboardName";
import {
  validateLeaderboardName,
  type NameError,
} from "@/lib/leaderboardName";
import ProfileCard, {
  initialsOf,
} from "@/components/molecules/ProfileCard/ProfileCard";
import { ProgressRing } from "@/components/atoms/ProgressRing/ProgressRing";
import { useT } from "@/i18n/i18n";
import type {
  AddFriendResult,
  FriendInfo,
  FriendRequest,
  LeaderboardEntry,
  LeaderboardMetric,
  PublicProfile,
} from "@/hooks/useLibreCloud";
import "./SocialView.css";

/// Which of the two social surfaces is showing. Kept as top-level page
/// state so the Friends ↔ Leaderboard switch is a kit SegmentedControl
/// toggle rather than two separate routes — the surfaces share the
/// same audience ("people I compare progress with") so they read as
/// one page with two tabs, mirroring the Profile page's card grid.
type Tab = "friends" | "leaderboard";
/// Leaderboard scope — friends-only vs. the global board.
type Scope = "friends" | "global";

interface Props {
  /// Cloud methods, threaded from `useLibreCloud` at the app level so
  /// this view stays free of the hook + its auth state. Each is a
  /// stable `useCallback` identity, so the effects below don't loop.
  listFriends: () => Promise<FriendInfo[]>;
  addFriend: (email: string) => Promise<AddFriendResult>;
  listFriendRequests: () => Promise<FriendRequest[]>;
  acceptFriendRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  getFriendsLeaderboard: (
    metric: LeaderboardMetric,
  ) => Promise<LeaderboardEntry[]>;
  getGlobalLeaderboard: (
    limit?: number,
    offset?: number,
  ) => Promise<LeaderboardEntry[]>;
  /// Fetches a public profile — used for the signed-in learner's own
  /// hero card at the top of the Friends tab (embedded ProfileCard).
  getProfile: (userId: string) => Promise<PublicProfile>;
  /// Open a full profile card for a friend / requester / leaderboard row.
  onOpenProfile: (userId: string) => void;
  /// The signed-in user's own id — drives the hero card and the
  /// leaderboard "You" highlight. Null/undefined = signed out, which
  /// renders the sign-in empty state instead of the tabs.
  currentUserId?: string | null;
  /// Opens the sign-in dialog. Optional — embeds without an auth
  /// affordance just show the explanation copy.
  onSignIn?: () => void;
}

/// Social page — the consolidated home for the two people-facing
/// surfaces. A kit SegmentedControl switches between:
///   - Friends     — own-profile hero, add-by-email, incoming
///                   requests, confirmed friends.
///   - Leaderboard — Friends / Global scope + XP / Streak / Lessons.
///
/// Rendered as a full main-pane view (not a modal) so it sits in the
/// same slot as Profile and reuses that shell's scroll + centered-
/// column chrome. Rows open the shared ProfileCard overlay.
///
/// BOTH panels stay mounted (the inactive one is `hidden`) so tab
/// switches never refetch or flash — each panel keeps its last-good
/// data + scroll state for the whole page visit. Initial loads show
/// kit Skeleton rows; refetches after mutations swap data in place.
export default function SocialView({
  listFriends,
  addFriend,
  listFriendRequests,
  acceptFriendRequest,
  removeFriend,
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  getProfile,
  onOpenProfile,
  currentUserId,
  onSignIn,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("friends");
  /// Owned here (not in FriendsPanel) so the leaderboard's "Add
  /// friends" empty-state CTA can hop tabs AND focus the email input.
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const goAddFriends = useCallback(() => {
    setTab("friends");
    // The friends panel is already mounted (just hidden), so the input
    // exists — focus lands after the tab flip paints.
    requestAnimationFrame(() => emailInputRef.current?.focus());
  }, []);

  return (
    <div className="libre-social">
      <div className="libre-social-scroll">
        <div className="libre-social-inner">
          <header className="libre-social-header">
            <div className="libre-social-header-text">
              <h1 className="libre-social-title">{t("social.title")}</h1>
              <p className="libre-social-subtitle">{t("social.subtitle")}</p>
            </div>
          </header>

          {!currentUserId ? (
            /* Signed out — the cloud methods all require a session, so
               explain instead of showing two broken tabs. */
            <EmptyState
              icon={logIn}
              title={t("social.signedOutTitle")}
              body={t("social.signedOutBody")}
              action={
                onSignIn && (
                  <Button variant="primary" icon={logIn} onClick={onSignIn}>
                    {t("auth.signIn")}
                  </Button>
                )
              }
            />
          ) : (
            <>
              <SegmentedControl
                className="libre-social-seg"
                size="lg"
                ariaLabel={t("social.title")}
                value={tab}
                onChange={(v) => setTab(v as Tab)}
                options={[
                  {
                    value: "friends",
                    title: t("social.friendsTab"),
                    label: (
                      <>
                        <Icon icon={users} size="xs" color="currentColor" />
                        <span>{t("social.friendsTab")}</span>
                      </>
                    ),
                  },
                  {
                    value: "leaderboard",
                    title: t("social.leaderboardTab"),
                    label: (
                      <>
                        <Icon icon={trophy} size="xs" color="currentColor" />
                        <span>{t("social.leaderboardTab")}</span>
                      </>
                    ),
                  },
                ]}
              />

              <div
                className="libre-social-tabpanel"
                hidden={tab !== "friends"}
              >
                <FriendsPanel
                  listFriends={listFriends}
                  addFriend={addFriend}
                  listFriendRequests={listFriendRequests}
                  acceptFriendRequest={acceptFriendRequest}
                  removeFriend={removeFriend}
                  getProfile={getProfile}
                  onOpenProfile={onOpenProfile}
                  currentUserId={currentUserId}
                  emailInputRef={emailInputRef}
                />
              </div>
              <div
                className="libre-social-tabpanel"
                hidden={tab !== "leaderboard"}
              >
                <LeaderboardPanel
                  getFriendsLeaderboard={getFriendsLeaderboard}
                  getGlobalLeaderboard={getGlobalLeaderboard}
                  onOpenProfile={onOpenProfile}
                  currentUserId={currentUserId}
                  onGoAddFriends={goAddFriends}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/// ── Friends panel ─────────────────────────────────────────────────
/// Own-profile hero (embedded ProfileCard), add-by-email form (kit
/// Button with its loading state; friendly 404 / 409 / 400 feedback
/// inline under the input), incoming requests with Accept / Reject,
/// and confirmed friends with level / streak / XP chips. Every list
/// re-fetches after a mutation so the UI reflects the server. Uses
/// `initialLoad` (not a plain `loading` flag) so a refetch after a
/// mutation swaps data in place instead of flashing back to skeletons.
function FriendsPanel({
  listFriends,
  addFriend,
  listFriendRequests,
  acceptFriendRequest,
  removeFriend,
  getProfile,
  onOpenProfile,
  currentUserId,
  emailInputRef,
}: {
  listFriends: () => Promise<FriendInfo[]>;
  addFriend: (email: string) => Promise<AddFriendResult>;
  listFriendRequests: () => Promise<FriendRequest[]>;
  acceptFriendRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  getProfile: (userId: string) => Promise<PublicProfile>;
  onOpenProfile: (userId: string) => void;
  currentUserId: string;
  emailInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  // First-load flag only. Mutations refetch silently (see `refresh`),
  // so we never toggle back to skeletons once we've shown real data.
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      const [f, r] = await Promise.all([listFriends(), listFriendRequests()]);
      setFriends(f);
      setRequests(r);
    } catch (err) {
      console.error("[libre] friends refresh failed:", err);
      setLoadError(true);
    } finally {
      setInitialLoad(false);
    }
  }, [listFriends, listFriendRequests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || adding) return;
    setAdding(true);
    setAddFeedback(null);
    try {
      const result = await addFriend(value);
      const messages: Record<
        AddFriendResult,
        { kind: "ok" | "error"; key: string }
      > = {
        sent: { kind: "ok", key: "friends.requestSent" },
        not_found: { kind: "error", key: "friends.noSuchUser" },
        duplicate: { kind: "error", key: "friends.alreadyRequested" },
        invalid: { kind: "error", key: "friends.invalidEmail" },
      };
      const m = messages[result];
      setAddFeedback({ kind: m.kind, text: t(m.key, { email: value }) });
      if (result === "sent") {
        setEmail("");
        // A successful request can create an edge the requests list
        // should reflect — refetch quietly.
        void refresh();
      }
    } catch (err) {
      // 404/409/400 are mapped to friendly copy above — landing here
      // means 401 (dead session), 500, or a network failure. Surface it.
      console.error("[libre] add friend failed:", err);
      setAddFeedback({ kind: "error", text: t("friends.addFailed") });
    } finally {
      setAdding(false);
    }
  };

  const handleAccept = async (userId: string) => {
    try {
      await acceptFriendRequest(userId);
      await refresh();
    } catch (err) {
      console.error("[libre] accept request failed:", err);
      setLoadError(true);
    }
  };

  const handleReject = async (userId: string) => {
    // Reject uses the same "sever edge" endpoint as remove-friend.
    try {
      await removeFriend(userId);
      await refresh();
    } catch (err) {
      console.error("[libre] reject request failed:", err);
      setLoadError(true);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeFriend(userId);
      await refresh();
    } catch (err) {
      console.error("[libre] remove friend failed:", err);
      setLoadError(true);
    }
  };

  return (
    <div className="libre-social-panel">
      {/* Own profile hero — same embedded card the overlay uses. */}
      <ProfileCard embedded userId={currentUserId} getProfile={getProfile} />

      {/* Add-by-email */}
      <form className="libre-social-add" onSubmit={submitAdd}>
        <label className="libre-social-add-label" htmlFor="libre-social-email">
          {t("friends.addByEmail")}
        </label>
        <div className="libre-social-add-row">
          <input
            id="libre-social-email"
            ref={emailInputRef}
            className="libre-social-add-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder={t("friends.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            icon={userPlus}
            loading={adding}
            disabled={email.trim().length === 0}
          >
            {t("friends.sendRequest")}
          </Button>
        </div>
        {addFeedback && (
          <p
            className={`libre-social-add-feedback libre-social-add-feedback--${addFeedback.kind}`}
            role="status"
          >
            <Icon
              icon={addFeedback.kind === "ok" ? check : xIcon}
              size="xs"
              color="currentColor"
              weight="bold"
            />
            <span>{addFeedback.text}</span>
          </p>
        )}
      </form>

      {loadError && (
        <EmptyState
          icon={frown}
          body={t("friends.loadError")}
          action={
            <Button variant="secondary" size="sm" onClick={() => refresh()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}

      {/* Incoming requests */}
      {requests.length > 0 && (
        <section className="libre-social-section">
          <h2 className="libre-social-section-title">
            {t("friends.requestsHeading")}
            <Badge color="accent" variant="solid" size="sm">
              {requests.length}
            </Badge>
          </h2>
          <ul className="libre-social-list" role="list">
            {requests.map((r) => (
              <li key={r.id} className="libre-social-row">
                <button
                  type="button"
                  className="libre-social-row-main"
                  onClick={() => onOpenProfile(r.id)}
                >
                  <Avatar
                    size="sm"
                    initials={initialsOf(r.display_name, r.email)}
                    alt=""
                  />
                  <span className="libre-social-identity">
                    <span className="libre-social-name-row">
                      <span className="libre-social-name">
                        {r.display_name?.trim() ||
                          r.email ||
                          t("friends.anonymous")}
                      </span>
                      {r.early_access && <EarlyBadge />}
                    </span>
                    {r.display_name?.trim() && r.email && (
                      <span className="libre-social-email">{r.email}</span>
                    )}
                  </span>
                </button>
                <div className="libre-social-row-actions">
                  <Button
                    size="sm"
                    iconOnly
                    icon={check}
                    intent="success"
                    appearance="subtle"
                    onClick={() => handleAccept(r.id)}
                    aria-label={t("friends.accept")}
                    title={t("friends.accept")}
                  />
                  <Button
                    size="sm"
                    iconOnly
                    icon={xIcon}
                    intent="error"
                    appearance="subtle"
                    onClick={() => handleReject(r.id)}
                    aria-label={t("friends.reject")}
                    title={t("friends.reject")}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Confirmed friends */}
      <section className="libre-social-section">
        <h2 className="libre-social-section-title">
          {t("friends.friendsHeading")}
          {!initialLoad && (
            <Badge color="neutral" variant="outline" size="sm">
              {friends.length}
            </Badge>
          )}
        </h2>
        {initialLoad ? (
          <div className="libre-social-list" aria-busy="true">
            <FriendRowSkeleton />
            <FriendRowSkeleton />
            <FriendRowSkeleton />
          </div>
        ) : friends.length === 0 ? (
          !loadError && (
            <EmptyState
              icon={users}
              title={t("friends.emptyTitle")}
              body={t("friends.emptyBody")}
              action={
                <Button
                  variant="secondary"
                  icon={userPlus}
                  onClick={() => emailInputRef.current?.focus()}
                >
                  {t("friends.addFirst")}
                </Button>
              }
            />
          )
        ) : (
          <ul className="libre-social-list" role="list">
            {friends.map((f) => (
              <li key={f.id} className="libre-social-row">
                <button
                  type="button"
                  className="libre-social-row-main"
                  onClick={() => onOpenProfile(f.id)}
                >
                  <Avatar
                    size="sm"
                    initials={initialsOf(f.display_name, f.email)}
                    alt=""
                  />
                  <span className="libre-social-identity">
                    <span className="libre-social-name-row">
                      <span className="libre-social-name">
                        {f.display_name?.trim() ||
                          f.email ||
                          t("friends.anonymous")}
                      </span>
                      {f.early_access && <EarlyBadge />}
                    </span>
                    {f.display_name?.trim() && f.email && (
                      <span className="libre-social-email">{f.email}</span>
                    )}
                  </span>
                  <span className="libre-social-metrics">
                    <Badge color="neutral" variant="outline" size="sm">
                      {t("friends.levelShort", { level: f.stats.level })}
                    </Badge>
                    <Chip
                      size="sm"
                      icon={flame}
                      className="libre-social-chip--streak"
                    >
                      {f.stats.current_streak_days}
                    </Chip>
                    <Chip
                      size="sm"
                      icon={zap}
                      className="libre-social-chip--xp"
                    >
                      {f.stats.total_xp}
                    </Chip>
                  </span>
                </button>
                <Button
                  size="sm"
                  iconOnly
                  icon={xIcon}
                  variant="ghost"
                  onClick={() => handleRemove(f.id)}
                  aria-label={t("friends.remove")}
                  title={t("friends.remove")}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/// ── Leaderboard panel ─────────────────────────────────────────────
/// Friends | Global scope + XP / Streak / Lessons metric — both kit
/// SegmentedControls — above ranked rows (medal-weighted rank, kit
/// Avatar, level ring, streak/metric chips). Rows are clickable →
/// profile card. The global board ranks by XP server-side but still
/// reflects the toggle's highlighted column so the two scopes feel
/// consistent. `initialLoad` keeps the last-good rows painted during
/// a scope/metric refetch instead of flashing skeletons.
function LeaderboardPanel({
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  onOpenProfile,
  currentUserId,
  onGoAddFriends,
}: {
  getFriendsLeaderboard: (
    metric: LeaderboardMetric,
  ) => Promise<LeaderboardEntry[]>;
  getGlobalLeaderboard: (
    limit?: number,
    offset?: number,
  ) => Promise<LeaderboardEntry[]>;
  onOpenProfile: (userId: string) => void;
  currentUserId?: string | null;
  /// Hop to the Friends tab and focus the add-by-email input — the
  /// friends-scope empty state's CTA.
  onGoAddFriends: () => void;
}) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("friends");
  const [metric, setMetric] = useState<LeaderboardMetric>("xp");
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState(false);
  // Public leaderboard identity — drives the "claim your spot" banner.
  // Everyone appears under a generated pseudonym until they claim a
  // handle (the global board never shows account display names).
  const lbName = useLeaderboardName(!!currentUserId);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data =
        scope === "friends"
          ? await getFriendsLeaderboard(metric)
          : await getGlobalLeaderboard(50, 0);
      setRows(data);
    } catch (err) {
      console.error("[libre] leaderboard load failed:", err);
      setError(true);
      setRows([]);
    } finally {
      setInitialLoad(false);
    }
  }, [scope, metric, getFriendsLeaderboard, getGlobalLeaderboard]);

  useEffect(() => {
    void load();
  }, [load]);

  const metricValue = (r: LeaderboardEntry): number => {
    if (metric === "streak") return r.current_streak_days;
    if (metric === "lessons") return r.lessons_completed;
    return r.total_xp;
  };

  const metricIcon =
    metric === "lessons" ? bookOpenCheck : metric === "streak" ? trophy : zap;

  return (
    <div className="libre-social-panel">
      {/* "Claim your spot" — shows while the user is still on their
          generated pseudonym. Refreshes the board after a successful
          claim so the new name paints immediately. */}
      {!lbName.claimed && lbName.alias ? (
        <ClaimSpotBanner
          alias={lbName.alias}
          claim={lbName.claim}
          onClaimed={() => void load()}
        />
      ) : null}
      {/* Scope + metric controls, one row. */}
      <div className="libre-social-lb-controls">
        <SegmentedControl
          className="libre-social-seg libre-social-seg--scope"
          size="lg"
          ariaLabel={t("leaderboard.title")}
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            {
              value: "friends",
              title: t("leaderboard.friends"),
              label: (
                <>
                  <Icon icon={users} size="xs" color="currentColor" />
                  <span>{t("leaderboard.friends")}</span>
                </>
              ),
            },
            {
              value: "global",
              title: t("leaderboard.global"),
              label: (
                <>
                  <Icon icon={globe} size="xs" color="currentColor" />
                  <span>{t("leaderboard.global")}</span>
                </>
              ),
            },
          ]}
        />
        <SegmentedControl
          size="lg"
          ariaLabel={t("leaderboard.metricLabel")}
          value={metric}
          onChange={(v) => setMetric(v as LeaderboardMetric)}
          options={[
            {
              value: "xp",
              title: t("leaderboard.metricXp"),
              label: (
                <>
                  <Icon icon={zap} size="xs" color="currentColor" />
                  <span>{t("leaderboard.metricXp")}</span>
                </>
              ),
            },
            {
              value: "streak",
              title: t("leaderboard.metricStreak"),
              label: (
                <>
                  <Icon icon={flame} size="xs" color="currentColor" />
                  <span>{t("leaderboard.metricStreak")}</span>
                </>
              ),
            },
            {
              value: "lessons",
              title: t("leaderboard.metricLessons"),
              label: (
                <>
                  <Icon icon={bookOpenCheck} size="xs" color="currentColor" />
                  <span>{t("leaderboard.metricLessons")}</span>
                </>
              ),
            },
          ]}
        />
      </div>

      {/* Body */}
      {initialLoad ? (
        <div className="libre-social-rank-list" aria-busy="true">
          <RankRowSkeleton />
          <RankRowSkeleton />
          <RankRowSkeleton />
          <RankRowSkeleton />
          <RankRowSkeleton />
        </div>
      ) : error ? (
        <EmptyState
          icon={frown}
          body={t("leaderboard.loadError")}
          action={
            <Button variant="secondary" size="sm" onClick={() => load()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        scope === "friends" ? (
          <EmptyState
            icon={trophy}
            title={t("leaderboard.emptyFriendsTitle")}
            body={t("leaderboard.emptyFriends")}
            action={
              <Button
                variant="secondary"
                icon={userPlus}
                onClick={onGoAddFriends}
              >
                {t("leaderboard.addFriendsCta")}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={globe} body={t("leaderboard.emptyGlobal")} />
        )
      ) : (
        <ol className="libre-social-rank-list">
          {rows.map((r) => {
            const isMe = !!currentUserId && r.user_id === currentUserId;
            return (
              <li key={r.user_id}>
                <button
                  type="button"
                  className={
                    "libre-social-rank-row" +
                    (isMe ? " libre-social-rank-row--me" : "")
                  }
                  onClick={() => onOpenProfile(r.user_id)}
                >
                  {/* Medal treatment: monochrome weight/ring emphasis
                      — #1 gets a solid disc + accent avatar ring, #2–3
                      outlined discs. No podium colors; this is a
                      monochrome system. */}
                  <span
                    className={`libre-social-rank libre-social-rank--${
                      r.rank <= 3 ? r.rank : "n"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <Avatar
                    size="sm"
                    initials={initialsOf(r.display_name, null)}
                    ring={r.rank === 1 ? "accent" : "none"}
                    alt=""
                  />
                  <span className="libre-social-rank-level" aria-hidden>
                    <ProgressRing
                      progress={1}
                      size={28}
                      stroke={2.5}
                      label={String(r.level)}
                      hideCheckOnComplete
                    />
                  </span>
                  <span className="libre-social-rank-name">
                    <span className="libre-social-rank-name-text">
                      {r.display_name?.trim() || t("friends.anonymous")}
                    </span>
                    {r.early_access && <EarlyBadge />}
                    {isMe && (
                      <Badge color="accent" variant="solid" size="sm">
                        {t("leaderboard.you")}
                      </Badge>
                    )}
                  </span>
                  <span className="libre-social-rank-cells">
                    <Chip
                      size="sm"
                      icon={flame}
                      variant={metric === "streak" ? "filled" : "outlined"}
                      className={
                        "libre-social-chip--streak" +
                        (metric === "streak" ? "" : " libre-social-chip--dim")
                      }
                    >
                      {r.current_streak_days}
                    </Chip>
                    <Chip
                      size="sm"
                      icon={metricIcon}
                      variant={metric === "streak" ? "outlined" : "filled"}
                      className={
                        metric === "streak" ? "libre-social-chip--dim" : ""
                      }
                    >
                      {metric === "streak" ? r.total_xp : metricValue(r)}
                    </Chip>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/// Friendly icon + copy + optional CTA — replaces the old bare
/// one-line empties. Also doubles as the load-error surface (frown
/// icon + Retry) and the signed-out explainer.
function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title?: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="libre-social-empty-state">
      <span className="libre-social-empty-state-icon" aria-hidden>
        <Icon icon={icon} size="lg" color="currentColor" />
      </span>
      {title && <h3 className="libre-social-empty-state-title">{title}</h3>}
      <p className="libre-social-empty-state-body">{body}</p>
      {action && <div className="libre-social-empty-state-action">{action}</div>}
    </div>
  );
}

/// Kit-Skeleton placeholder mirroring a friend row's geometry so the
/// initial load doesn't flash empty, then reflow.
function FriendRowSkeleton() {
  return (
    <div className="libre-social-row libre-social-row--skeleton">
      <Avatar skeleton size="sm" />
      <span className="libre-social-identity">
        <Skeleton size="text-sm" width="38%" />
      </span>
      <Skeleton size="xs" shape="pill" width={96} />
    </div>
  );
}

/// Same, for a leaderboard row (rank dot + avatar + name + chips).
function RankRowSkeleton() {
  return (
    <div className="libre-social-rank-row libre-social-rank-row--skeleton">
      <Skeleton shape="circle" width={22} height={22} />
      <Avatar skeleton size="sm" />
      <span className="libre-social-rank-name">
        <Skeleton size="text-sm" width="42%" />
      </span>
      <Skeleton size="xs" shape="pill" width={110} />
    </div>
  );
}

/// ── "Claim your spot" banner ──────────────────────────────────────
/// Shown at the top of the leaderboard while the viewer is still on
/// their generated pseudonym. Inline claim: name input with instant
/// client-side validation (mirrors the relay's rules; the relay
/// re-validates on PUT), Save → hide + refresh. "Maybe later" latches
/// per-session (sessionStorage) so it returns next launch without
/// nagging within the session.
const CLAIM_DISMISS_KEY = "libre:lb-claim-dismissed";

function ClaimSpotBanner({
  alias,
  claim,
  onClaimed,
}: {
  alias: string;
  claim: (name: string) => Promise<NameError | "network" | null>;
  onClaimed: () => void;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(CLAIM_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [name, setName] = useState(alias);
  const [saving, setSaving] = useState(false);
  const [errorCode, setErrorCode] = useState<NameError | "network" | null>(
    null,
  );

  if (dismissed) return null;

  // Live validation for the current input — drives the inline hint
  // without waiting for the round-trip. Skip while pristine (== alias,
  // which is always valid).
  const liveError = name === alias ? null : validateLeaderboardName(name);

  const errorText = (code: NameError | "network"): string =>
    code === "invalid_length"
      ? t("social.claimErrorLength")
      : code === "invalid_chars"
        ? t("social.claimErrorChars")
        : code === "profanity"
          ? t("social.claimErrorProfanity")
          : t("social.claimErrorNetwork");

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setErrorCode(null);
    const err = await claim(name);
    setSaving(false);
    if (err) {
      setErrorCode(err);
      return;
    }
    onClaimed();
  };

  const dismiss = () => {
    try {
      sessionStorage.setItem(CLAIM_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const shownError = errorCode ?? liveError;

  return (
    <div className="libre-social-claim" role="region" aria-label={t("social.claimTitle", { alias })}>
      <div className="libre-social-claim__text">
        <strong>{t("social.claimTitle", { alias })}</strong>
        <span>{t("social.claimBody")}</span>
      </div>
      <div className="libre-social-claim__form">
        <input
          className="libre-social-claim__input"
          value={name}
          maxLength={24}
          placeholder={t("social.claimPlaceholder")}
          onChange={(e) => {
            setName(e.target.value);
            setErrorCode(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !liveError) void save();
          }}
        />
        <button
          type="button"
          className="libre-social-claim__save"
          disabled={saving || !!liveError || name.trim().length === 0}
          onClick={() => void save()}
        >
          {t("social.claimSave")}
        </button>
        <button
          type="button"
          className="libre-social-claim__later"
          onClick={dismiss}
        >
          {t("social.claimDismiss")}
        </button>
      </div>
      {shownError ? (
        <span className="libre-social-claim__error">{errorText(shownError)}</span>
      ) : null}
    </div>
  );
}
