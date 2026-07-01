import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { zap } from "@base/primitives/icon/icons/zap";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { users } from "@base/primitives/icon/icons/users";
import { globe } from "@base/primitives/icon/icons/globe";
import { userPlus } from "@base/primitives/icon/icons/user-plus";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import { check } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import type {
  AddFriendResult,
  FriendInfo,
  FriendRequest,
  LeaderboardEntry,
  LeaderboardMetric,
} from "@/hooks/useLibreCloud";
import "./SocialView.css";

/// Which of the two social surfaces is showing. Kept as top-level page
/// state so the Friends ↔ Leaderboard switch is a segmented-control
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
  /// Open a full profile card for a friend / requester / leaderboard row.
  onOpenProfile: (userId: string) => void;
  /// The signed-in user's own id, so their leaderboard row highlights.
  currentUserId?: string | null;
}

/// Social page — the consolidated home for the two people-facing
/// surfaces. A single segmented control switches between:
///   - Friends     — add-by-email, incoming requests, confirmed friends.
///   - Leaderboard — Friends / Global scope + XP / Streak / Lessons.
///
/// Rendered as a full main-pane view (not a modal) so it sits in the
/// same slot as Profile / Leaderboard and reuses that shell's scroll +
/// centered-column chrome. Rows open the shared ProfileCard overlay.
///
/// Loading is handled per-surface with a "load once, then swap in
/// place" pattern: the list holds the last-good data while a refetch
/// runs, so switching tabs / scopes never flashes an empty frame.
export default function SocialView({
  listFriends,
  addFriend,
  listFriendRequests,
  acceptFriendRequest,
  removeFriend,
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  onOpenProfile,
  currentUserId,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("friends");

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

          {/* Friends | Leaderboard segmented control. Same vocabulary
              as the leaderboard's scope tabs so the whole page reads
              as one consistent surface. */}
          <div className="libre-social-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "friends"}
              className={
                "libre-social-tab" +
                (tab === "friends" ? " libre-social-tab--active" : "")
              }
              onClick={() => setTab("friends")}
            >
              <Icon icon={users} size="xs" color="currentColor" />
              <span>{t("social.friendsTab")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "leaderboard"}
              className={
                "libre-social-tab" +
                (tab === "leaderboard" ? " libre-social-tab--active" : "")
              }
              onClick={() => setTab("leaderboard")}
            >
              <Icon icon={trophy} size="xs" color="currentColor" />
              <span>{t("social.leaderboardTab")}</span>
            </button>
          </div>

          {tab === "friends" ? (
            <FriendsPanel
              listFriends={listFriends}
              addFriend={addFriend}
              listFriendRequests={listFriendRequests}
              acceptFriendRequest={acceptFriendRequest}
              removeFriend={removeFriend}
              onOpenProfile={onOpenProfile}
            />
          ) : (
            <LeaderboardPanel
              getFriendsLeaderboard={getFriendsLeaderboard}
              getGlobalLeaderboard={getGlobalLeaderboard}
              onOpenProfile={onOpenProfile}
              currentUserId={currentUserId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/// ── Friends panel ─────────────────────────────────────────────────
/// Add-by-email form (with friendly 404 / 409 / 400 handling), incoming
/// requests with Accept / Reject, and confirmed friends with level /
/// streak / XP. Every list re-fetches after a mutation so the UI
/// reflects the server. Uses `initialLoad` (not a plain `loading` flag)
/// so a refetch after a mutation swaps data in place instead of
/// flashing the empty / spinner state.
function FriendsPanel({
  listFriends,
  addFriend,
  listFriendRequests,
  acceptFriendRequest,
  removeFriend,
  onOpenProfile,
}: {
  listFriends: () => Promise<FriendInfo[]>;
  addFriend: (email: string) => Promise<AddFriendResult>;
  listFriendRequests: () => Promise<FriendRequest[]>;
  acceptFriendRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  onOpenProfile: (userId: string) => void;
}) {
  const t = useT();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  // First-load flag only. Mutations refetch silently (see `refresh`),
  // so we never toggle back to a spinner once we've shown real data.
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
    } catch {
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
    } catch {
      setAddFeedback({ kind: "error", text: t("friends.addFailed") });
    } finally {
      setAdding(false);
    }
  };

  const handleAccept = async (userId: string) => {
    try {
      await acceptFriendRequest(userId);
      await refresh();
    } catch {
      setLoadError(true);
    }
  };

  const handleReject = async (userId: string) => {
    // Reject uses the same "sever edge" endpoint as remove-friend.
    try {
      await removeFriend(userId);
      await refresh();
    } catch {
      setLoadError(true);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeFriend(userId);
      await refresh();
    } catch {
      setLoadError(true);
    }
  };

  return (
    <div className="libre-social-panel">
      {/* Add-by-email */}
      <form className="libre-social-add" onSubmit={submitAdd}>
        <label className="libre-social-add-label" htmlFor="libre-social-email">
          {t("friends.addByEmail")}
        </label>
        <div className="libre-social-add-row">
          <input
            id="libre-social-email"
            className="libre-social-add-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder={t("friends.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="submit"
            className="libre-social-add-btn"
            disabled={adding || email.trim().length === 0}
          >
            <Icon icon={userPlus} size="xs" color="currentColor" />
            <span>{t("friends.sendRequest")}</span>
          </button>
        </div>
        {addFeedback && (
          <p
            className={`libre-social-add-feedback libre-social-add-feedback--${addFeedback.kind}`}
            role="status"
          >
            {addFeedback.text}
          </p>
        )}
      </form>

      {loadError && (
        <p className="libre-social-error">{t("friends.loadError")}</p>
      )}

      {/* Incoming requests */}
      {requests.length > 0 && (
        <section className="libre-social-section">
          <h2 className="libre-social-section-title">
            {t("friends.requestsTitle", { n: requests.length })}
          </h2>
          <ul className="libre-social-list" role="list">
            {requests.map((r) => (
              <li key={r.id} className="libre-social-row">
                <button
                  type="button"
                  className="libre-social-row-main"
                  onClick={() => onOpenProfile(r.id)}
                >
                  <span className="libre-social-avatar" aria-hidden>
                    {initial(r.display_name, r.email)}
                  </span>
                  <span className="libre-social-identity">
                    <span className="libre-social-name">
                      {r.display_name?.trim() ||
                        r.email ||
                        t("friends.anonymous")}
                    </span>
                    {r.display_name?.trim() && r.email && (
                      <span className="libre-social-email">{r.email}</span>
                    )}
                  </span>
                </button>
                <div className="libre-social-row-actions">
                  <button
                    type="button"
                    className="libre-social-icon-btn libre-social-icon-btn--accept"
                    onClick={() => handleAccept(r.id)}
                    aria-label={t("friends.accept")}
                    title={t("friends.accept")}
                  >
                    <Icon
                      icon={check}
                      size="xs"
                      color="currentColor"
                      weight="bold"
                    />
                  </button>
                  <button
                    type="button"
                    className="libre-social-icon-btn libre-social-icon-btn--reject"
                    onClick={() => handleReject(r.id)}
                    aria-label={t("friends.reject")}
                    title={t("friends.reject")}
                  >
                    <Icon
                      icon={xIcon}
                      size="xs"
                      color="currentColor"
                      weight="bold"
                    />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Confirmed friends */}
      <section className="libre-social-section">
        <h2 className="libre-social-section-title">
          {t("friends.friendsTitle", { n: friends.length })}
        </h2>
        {initialLoad ? (
          <p className="libre-social-empty">{t("friends.loading")}</p>
        ) : friends.length === 0 ? (
          <p className="libre-social-empty">{t("friends.noFriends")}</p>
        ) : (
          <ul className="libre-social-list" role="list">
            {friends.map((f) => (
              <li key={f.id} className="libre-social-row">
                <button
                  type="button"
                  className="libre-social-row-main"
                  onClick={() => onOpenProfile(f.id)}
                >
                  <span className="libre-social-avatar" aria-hidden>
                    {initial(f.display_name, f.email)}
                  </span>
                  <span className="libre-social-identity">
                    <span className="libre-social-name">
                      {f.display_name?.trim() ||
                        f.email ||
                        t("friends.anonymous")}
                    </span>
                    {f.display_name?.trim() && f.email && (
                      <span className="libre-social-email">{f.email}</span>
                    )}
                  </span>
                  <span className="libre-social-metrics">
                    <span className="libre-social-level">
                      {t("friends.levelShort", { level: f.stats.level })}
                    </span>
                    <span
                      className="libre-social-metric libre-social-metric--streak"
                      title={t("friends.streak")}
                    >
                      <Icon icon={flame} size="xs" color="currentColor" />
                      {f.stats.current_streak_days}
                    </span>
                    <span
                      className="libre-social-metric libre-social-metric--xp"
                      title={t("friends.xp")}
                    >
                      <Icon icon={zap} size="xs" color="currentColor" />
                      {f.stats.total_xp}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="libre-social-icon-btn libre-social-icon-btn--remove"
                  onClick={() => handleRemove(f.id)}
                  aria-label={t("friends.remove")}
                  title={t("friends.remove")}
                >
                  <Icon icon={xIcon} size="xs" color="currentColor" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/// ── Leaderboard panel ─────────────────────────────────────────────
/// Friends | Global scope tabs, an XP / Streak / Lessons metric toggle,
/// and ranked rows (rank, level, name, streak, metric). Rows are
/// clickable → profile card. The global board ranks by XP server-side
/// but still reflects the toggle's highlighted column so the two scopes
/// feel consistent. `initialLoad` keeps the last-good rows painted
/// during a scope/metric refetch instead of flashing the spinner.
function LeaderboardPanel({
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  onOpenProfile,
  currentUserId,
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
}) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("friends");
  const [metric, setMetric] = useState<LeaderboardMetric>("xp");
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data =
        scope === "friends"
          ? await getFriendsLeaderboard(metric)
          : await getGlobalLeaderboard(50, 0);
      setRows(data);
    } catch {
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

  return (
    <div className="libre-social-panel">
      {/* Scope tabs */}
      <div className="libre-social-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scope === "friends"}
          className={
            "libre-social-subtab" +
            (scope === "friends" ? " libre-social-subtab--active" : "")
          }
          onClick={() => setScope("friends")}
        >
          <Icon icon={users} size="xs" color="currentColor" />
          <span>{t("leaderboard.friends")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "global"}
          className={
            "libre-social-subtab" +
            (scope === "global" ? " libre-social-subtab--active" : "")
          }
          onClick={() => setScope("global")}
        >
          <Icon icon={globe} size="xs" color="currentColor" />
          <span>{t("leaderboard.global")}</span>
        </button>
      </div>

      {/* Metric toggle */}
      <div
        className="libre-social-metrics-toggle"
        role="group"
        aria-label={t("leaderboard.metricLabel")}
      >
        <MetricButton
          icon={zap}
          label={t("leaderboard.metricXp")}
          active={metric === "xp"}
          onClick={() => setMetric("xp")}
        />
        <MetricButton
          icon={flame}
          label={t("leaderboard.metricStreak")}
          active={metric === "streak"}
          onClick={() => setMetric("streak")}
        />
        <MetricButton
          icon={bookOpenCheck}
          label={t("leaderboard.metricLessons")}
          active={metric === "lessons"}
          onClick={() => setMetric("lessons")}
        />
      </div>

      {/* Body */}
      {initialLoad ? (
        <p className="libre-social-empty">{t("leaderboard.loading")}</p>
      ) : error ? (
        <p className="libre-social-empty libre-social-empty--error">
          {t("leaderboard.loadError")}
        </p>
      ) : rows.length === 0 ? (
        <p className="libre-social-empty">
          {scope === "friends"
            ? t("leaderboard.emptyFriends")
            : t("leaderboard.emptyGlobal")}
        </p>
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
                  <span
                    className={`libre-social-rank libre-social-rank--${
                      r.rank <= 3 ? r.rank : "n"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <span className="libre-social-rank-level" aria-hidden>
                    {r.level}
                  </span>
                  <span className="libre-social-rank-name">
                    {r.display_name?.trim() || t("friends.anonymous")}
                    {isMe && (
                      <span className="libre-social-you">
                        {t("leaderboard.you")}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      "libre-social-cell libre-social-cell--streak" +
                      (metric === "streak" ? " libre-social-cell--hl" : "")
                    }
                    title={t("friends.streak")}
                  >
                    <Icon icon={flame} size="xs" color="currentColor" />
                    {r.current_streak_days}
                  </span>
                  <span
                    className={
                      "libre-social-cell libre-social-cell--metric" +
                      (metric !== "streak" ? " libre-social-cell--hl" : "")
                    }
                  >
                    {metric === "lessons" ? (
                      <Icon
                        icon={bookOpenCheck}
                        size="xs"
                        color="currentColor"
                      />
                    ) : metric === "streak" ? (
                      <Icon icon={trophy} size="xs" color="currentColor" />
                    ) : (
                      <Icon icon={zap} size="xs" color="currentColor" />
                    )}
                    {metric === "streak" ? r.total_xp : metricValue(r)}
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

function MetricButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        "libre-social-metric-btn" +
        (active ? " libre-social-metric-btn--active" : "")
      }
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon icon={icon} size="xs" color="currentColor" />
      <span>{label}</span>
    </button>
  );
}

/// First letter for the avatar chip — display name wins, then email,
/// then a bullet placeholder for fully-anonymous rows.
function initial(name: string | null, email: string | null): string {
  const src = name?.trim() || email || "";
  return src ? src[0].toUpperCase() : "•";
}
