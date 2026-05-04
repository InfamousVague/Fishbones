import { describeAuthProvider } from "./helpers";

interface AccountSectionProps {
  user: {
    id: string;
    email: string | null;
    display_name: string | null;
    has_password: boolean;
    apple_linked: boolean;
    google_linked: boolean;
  };
  signingOut: boolean;
  deletingAccount: boolean;
  confirmDeleteAccount: boolean;
  onSignOut: () => void;
  onRequestDeleteConfirm: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/// Account/Profile section. Rendered only when signed in. Surfaces the
/// learner's identity (display name + email + provider), a sign-out
/// button, and a click-to-confirm delete-account flow that mirrors the
/// destructive-action UX used by `confirmClearCourses` above.
export default function AccountSection({
  user,
  signingOut,
  deletingAccount,
  confirmDeleteAccount,
  onSignOut,
  onRequestDeleteConfirm,
  onCancelDelete,
  onConfirmDelete,
}: AccountSectionProps) {
  const displayName = user.display_name?.trim() || null;
  // Avatar initial — first character of the display name, falling back
  // to the email's local part. Always uppercase for visual consistency.
  // If neither is available we fall through to a generic person glyph.
  const initialSource = displayName || user.email || "";
  const initial = initialSource ? initialSource.charAt(0).toUpperCase() : "?";
  const providerLabel = describeAuthProvider(user);

  return (
    <section>
      <h3 className="fishbones-settings-section">Account</h3>
      <p className="fishbones-settings-blurb">
        Your Fishbones cloud account. Lesson progress syncs across
        devices when signed in; nothing is uploaded otherwise.
      </p>

      <div className="fishbones-settings-account-card">
        <div className="fishbones-settings-account-avatar" aria-hidden>
          {initial}
        </div>
        <div className="fishbones-settings-account-meta">
          <div className="fishbones-settings-account-name">
            {displayName || user.email || "Signed in"}
          </div>
          {user.email && displayName && (
            <div className="fishbones-settings-account-email">{user.email}</div>
          )}
          <div className="fishbones-settings-account-provider">
            {providerLabel}
          </div>
        </div>
      </div>

      <div className="fishbones-settings-data-row">
        <div>
          <div className="fishbones-settings-data-label">Sign out</div>
          <div className="fishbones-settings-data-hint">
            Removes the cloud token from this device. Your local courses
            and progress stay; you can sign back in any time.
          </div>
        </div>
        <button
          className="fishbones-settings-secondary"
          onClick={onSignOut}
          disabled={signingOut || deletingAccount}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>

      <div className="fishbones-settings-data-row">
        <div>
          <div className="fishbones-settings-data-label">Delete account</div>
          <div className="fishbones-settings-data-hint">
            Permanently deletes your Fishbones cloud account, all synced
            progress, and any uploaded courses. Local files on this
            device are not affected. Cannot be undone.
          </div>
        </div>
        {confirmDeleteAccount ? (
          <div className="fishbones-settings-confirm">
            <button
              className="fishbones-settings-secondary"
              onClick={onCancelDelete}
              disabled={deletingAccount}
            >
              Cancel
            </button>
            <button
              className="fishbones-settings-danger"
              onClick={onConfirmDelete}
              disabled={deletingAccount}
            >
              {deletingAccount ? "Deleting…" : "Really delete"}
            </button>
          </div>
        ) : (
          <button
            className="fishbones-settings-danger"
            onClick={onRequestDeleteConfirm}
            disabled={signingOut}
          >
            Delete account
          </button>
        )}
      </div>
    </section>
  );
}
