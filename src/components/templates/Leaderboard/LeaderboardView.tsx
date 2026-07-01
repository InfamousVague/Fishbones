import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { zap } from "@base/primitives/icon/icons/zap";
import { users } from "@base/primitives/icon/icons/users";
import { globe } from "@base/primitives/icon/icons/globe";
import { trophy } from "@base/primitives/icon/icons/trophy";
import { bookOpenCheck } from "@base/primitives/icon/icons/book-open-check";
import "@base/primitives/icon/icon.css";
import { useT } from "@/i18n/i18n";
import type {
  LeaderboardEntry,
  LeaderboardMetric,
} from "@/hooks/useLibreCloud";
import "./LeaderboardView.css";

type Scope = "friends" | "global";

interface Props {
  getFriendsLeaderboard: (
    metric: LeaderboardMetric,
  ) => Promise<LeaderboardEntry[]>;
  getGlobalLeaderboard: (
    limit?: number,
    offset?: number,
  ) => Promise<LeaderboardEntry[]>;
  /// Clicking a row opens that user's profile card.
  onOpenProfile: (userId: string) => void;
  /// The signed-in user's own id, so their row can be highlighted.
  currentUserId?: string | null;
}

/// Leaderboard page: Friends | Global scope tabs, a XP / Streak /
/// Lessons metric toggle, and ranked rows (rank, level, name, streak,
/// XP). Rows are clickable → profile card. The global board ignores the
/// metric toggle for ranking (server ranks by XP) but still reflects the
/// toggle's highlighted column so the two scopes feel consistent.
export default function LeaderboardView({
  getFriendsLeaderboard,
  getGlobalLeaderboard,
  onOpenProfile,
  currentUserId,
}: Props) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("friends");
  const [metric, setMetric] = useState<LeaderboardMetric>("xp");
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
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
    <div className="libre-leaderboard">
      <div className="libre-leaderboard-scroll">
        <div className="libre-leaderboard-inner">
          <header className="libre-leaderboard-header">
            <div className="libre-leaderboard-header-text">
              <h1 className="libre-leaderboard-title">
                {t("leaderboard.title")}
              </h1>
              <p className="libre-leaderboard-subtitle">
                {t("leaderboard.subtitle")}
              </p>
            </div>
          </header>

          {/* Scope tabs */}
          <div className="libre-leaderboard-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={scope === "friends"}
              className={`libre-leaderboard-tab ${
                scope === "friends" ? "libre-leaderboard-tab--active" : ""
              }`}
              onClick={() => setScope("friends")}
            >
              <Icon icon={users} size="xs" color="currentColor" />
              <span>{t("leaderboard.friends")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === "global"}
              className={`libre-leaderboard-tab ${
                scope === "global" ? "libre-leaderboard-tab--active" : ""
              }`}
              onClick={() => setScope("global")}
            >
              <Icon icon={globe} size="xs" color="currentColor" />
              <span>{t("leaderboard.global")}</span>
            </button>
          </div>

          {/* Metric toggle */}
          <div className="libre-leaderboard-metrics" role="group" aria-label={t("leaderboard.metricLabel")}>
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
          {loading ? (
            <p className="libre-leaderboard-empty">{t("leaderboard.loading")}</p>
          ) : error ? (
            <p className="libre-leaderboard-empty libre-leaderboard-empty--error">
              {t("leaderboard.loadError")}
            </p>
          ) : rows.length === 0 ? (
            <p className="libre-leaderboard-empty">
              {scope === "friends"
                ? t("leaderboard.emptyFriends")
                : t("leaderboard.emptyGlobal")}
            </p>
          ) : (
            <ol className="libre-leaderboard-list">
              {rows.map((r) => {
                const isMe = !!currentUserId && r.user_id === currentUserId;
                return (
                  <li key={r.user_id}>
                    <button
                      type="button"
                      className={`libre-leaderboard-row ${
                        isMe ? "libre-leaderboard-row--me" : ""
                      }`}
                      onClick={() => onOpenProfile(r.user_id)}
                    >
                      <span
                        className={`libre-leaderboard-rank libre-leaderboard-rank--${
                          r.rank <= 3 ? r.rank : "n"
                        }`}
                      >
                        {r.rank}
                      </span>
                      <span className="libre-leaderboard-level" aria-hidden>
                        {r.level}
                      </span>
                      <span className="libre-leaderboard-name">
                        {r.display_name?.trim() || t("friends.anonymous")}
                        {isMe && (
                          <span className="libre-leaderboard-you">
                            {t("leaderboard.you")}
                          </span>
                        )}
                      </span>
                      <span
                        className={`libre-leaderboard-cell libre-leaderboard-cell--streak ${
                          metric === "streak" ? "libre-leaderboard-cell--hl" : ""
                        }`}
                        title={t("friends.streak")}
                      >
                        <Icon icon={flame} size="xs" color="currentColor" />
                        {r.current_streak_days}
                      </span>
                      <span
                        className={`libre-leaderboard-cell libre-leaderboard-cell--metric ${
                          metric !== "streak"
                            ? "libre-leaderboard-cell--hl"
                            : ""
                        }`}
                      >
                        {metric === "lessons" ? (
                          <Icon icon={bookOpenCheck} size="xs" color="currentColor" />
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
      </div>
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
      className={`libre-leaderboard-metric-btn ${
        active ? "libre-leaderboard-metric-btn--active" : ""
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon icon={icon} size="xs" color="currentColor" />
      <span>{label}</span>
    </button>
  );
}
