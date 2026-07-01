import { useCallback, useEffect, useState } from "react";
import { Icon } from "@base/primitives/icon";
import { flame } from "@base/primitives/icon/icons/flame";
import { zap } from "@base/primitives/icon/icons/zap";
import { users } from "@base/primitives/icon/icons/users";
import { userPlus } from "@base/primitives/icon/icons/user-plus";
import { check } from "@base/primitives/icon/icons/check";
import { x as xIcon } from "@base/primitives/icon/icons/x";
import "@base/primitives/icon/icon.css";
import ModalBackdrop from "@/components/atoms/ModalBackdrop/ModalBackdrop";
import { useT } from "@/i18n/i18n";
import type {
  AddFriendResult,
  FriendInfo,
  FriendRequest,
} from "@/hooks/useLibreCloud";
import "./FriendsModal.css";

interface Props {
  /// Cloud methods, threaded from `useLibreCloud` at the app level so
  /// this component stays free of the hook + its auth state.
  listFriends: () => Promise<FriendInfo[]>;
  addFriend: (email: string) => Promise<AddFriendResult>;
  listFriendRequests: () => Promise<FriendRequest[]>;
  acceptFriendRequest: (userId: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  /// Open a full profile card for a friend / requester row.
  onOpenProfile: (userId: string) => void;
  onClose: () => void;
}

/// Friends management modal: confirmed friends (with level / streak /
/// XP), an add-by-email form (with friendly 404 / 409 / 400 handling),
/// and incoming requests with Accept / Reject. Every list re-fetches
/// after a mutation so the UI reflects the server.
export default function FriendsModal({
  listFriends,
  addFriend,
  listFriendRequests,
  acceptFriendRequest,
  removeFriend,
  onOpenProfile,
  onClose,
}: Props) {
  const t = useT();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  /// Inline feedback under the add form. `kind` picks the color; `text`
  /// is the already-localized message.
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
      setLoading(false);
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
      const messages: Record<AddFriendResult, { kind: "ok" | "error"; key: string }> = {
        sent: { kind: "ok", key: "friends.requestSent" },
        not_found: { kind: "error", key: "friends.noSuchUser" },
        duplicate: { kind: "error", key: "friends.alreadyRequested" },
        invalid: { kind: "error", key: "friends.invalidEmail" },
      };
      const m = messages[result];
      setAddFeedback({ kind: m.kind, text: t(m.key, { email: value }) });
      if (result === "sent") setEmail("");
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
    <ModalBackdrop onDismiss={onClose} zIndex={200}>
      <div
        className="libre-friends"
        role="dialog"
        aria-label={t("friends.title")}
      >
        <header className="libre-friends-head">
          <span className="libre-friends-head-icon" aria-hidden>
            <Icon icon={users} size="sm" color="currentColor" />
          </span>
          <h2 className="libre-friends-title">{t("friends.title")}</h2>
          <button
            type="button"
            className="libre-friends-close"
            onClick={onClose}
            aria-label={t("friends.close")}
          >
            <Icon icon={xIcon} size="sm" color="currentColor" />
          </button>
        </header>

        <div className="libre-friends-body">
          {/* Add-by-email */}
          <form className="libre-friends-add" onSubmit={submitAdd}>
            <label className="libre-friends-add-label" htmlFor="libre-friends-email">
              {t("friends.addByEmail")}
            </label>
            <div className="libre-friends-add-row">
              <input
                id="libre-friends-email"
                className="libre-friends-add-input"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder={t("friends.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                type="submit"
                className="libre-friends-add-btn"
                disabled={adding || email.trim().length === 0}
              >
                <Icon icon={userPlus} size="xs" color="currentColor" />
                <span>{t("friends.sendRequest")}</span>
              </button>
            </div>
            {addFeedback && (
              <p
                className={`libre-friends-add-feedback libre-friends-add-feedback--${addFeedback.kind}`}
                role="status"
              >
                {addFeedback.text}
              </p>
            )}
          </form>

          {loadError && (
            <p className="libre-friends-error">{t("friends.loadError")}</p>
          )}

          {/* Incoming requests */}
          {requests.length > 0 && (
            <section className="libre-friends-section">
              <h3 className="libre-friends-section-title">
                {t("friends.requestsTitle", { n: requests.length })}
              </h3>
              <ul className="libre-friends-list" role="list">
                {requests.map((r) => (
                  <li key={r.id} className="libre-friends-request-row">
                    <button
                      type="button"
                      className="libre-friends-row-main"
                      onClick={() => onOpenProfile(r.id)}
                    >
                      <span className="libre-friends-avatar" aria-hidden>
                        {initial(r.display_name, r.email)}
                      </span>
                      <span className="libre-friends-identity">
                        <span className="libre-friends-name">
                          {r.display_name?.trim() ||
                            r.email ||
                            t("friends.anonymous")}
                        </span>
                        {r.display_name?.trim() && r.email && (
                          <span className="libre-friends-email">{r.email}</span>
                        )}
                      </span>
                    </button>
                    <div className="libre-friends-request-actions">
                      <button
                        type="button"
                        className="libre-friends-icon-btn libre-friends-icon-btn--accept"
                        onClick={() => handleAccept(r.id)}
                        aria-label={t("friends.accept")}
                        title={t("friends.accept")}
                      >
                        <Icon icon={check} size="xs" color="currentColor" weight="bold" />
                      </button>
                      <button
                        type="button"
                        className="libre-friends-icon-btn libre-friends-icon-btn--reject"
                        onClick={() => handleReject(r.id)}
                        aria-label={t("friends.reject")}
                        title={t("friends.reject")}
                      >
                        <Icon icon={xIcon} size="xs" color="currentColor" weight="bold" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Confirmed friends */}
          <section className="libre-friends-section">
            <h3 className="libre-friends-section-title">
              {t("friends.friendsTitle", { n: friends.length })}
            </h3>
            {loading ? (
              <p className="libre-friends-empty">{t("friends.loading")}</p>
            ) : friends.length === 0 ? (
              <p className="libre-friends-empty">{t("friends.noFriends")}</p>
            ) : (
              <ul className="libre-friends-list" role="list">
                {friends.map((f) => (
                  <li key={f.id} className="libre-friends-row">
                    <button
                      type="button"
                      className="libre-friends-row-main"
                      onClick={() => onOpenProfile(f.id)}
                    >
                      <span className="libre-friends-avatar" aria-hidden>
                        {initial(f.display_name, f.email)}
                      </span>
                      <span className="libre-friends-identity">
                        <span className="libre-friends-name">
                          {f.display_name?.trim() ||
                            f.email ||
                            t("friends.anonymous")}
                        </span>
                        {f.display_name?.trim() && f.email && (
                          <span className="libre-friends-email">{f.email}</span>
                        )}
                      </span>
                      <span className="libre-friends-metrics">
                        <span className="libre-friends-level">
                          {t("friends.levelShort", { level: f.stats.level })}
                        </span>
                        <span
                          className="libre-friends-metric libre-friends-metric--streak"
                          title={t("friends.streak")}
                        >
                          <Icon icon={flame} size="xs" color="currentColor" />
                          {f.stats.current_streak_days}
                        </span>
                        <span
                          className="libre-friends-metric libre-friends-metric--xp"
                          title={t("friends.xp")}
                        >
                          <Icon icon={zap} size="xs" color="currentColor" />
                          {f.stats.total_xp}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="libre-friends-remove"
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
      </div>
    </ModalBackdrop>
  );
}

/// First letter for the avatar chip — display name wins, then email,
/// then a bullet placeholder for fully-anonymous rows.
function initial(name: string | null, email: string | null): string {
  const src = name?.trim() || email || "";
  return src ? src[0].toUpperCase() : "•";
}
