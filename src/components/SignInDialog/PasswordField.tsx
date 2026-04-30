// Password input with a four-segment strength meter and a show/hide
// toggle. Used by SignInDialog's email tab; designed as a drop-in
// replacement for a plain `<input type="password">` so future surfaces
// (e.g. Settings → change password, an account-recovery flow) can
// adopt the same affordance without re-implementing the meter.
//
// Scoring is a deliberately small heuristic — no zxcvbn dependency.
// Real password strength is hard to score statically anyway; the meter
// is here to nudge users toward "longer with some variety" rather than
// to claim a precise crack-time. The relay still enforces its own
// minimum (>= 8 chars) on signup; this widget never blocks submit on
// its own — the parent decides whether to gate the button.

import { useId, useMemo, useState } from "react";
import "./PasswordField.css";

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export interface PasswordScore {
  /// 0 = empty, 1 = weak, 2 = fair, 3 = good, 4 = strong. Drives the
  /// segment fill count + the band color.
  score: PasswordStrength;
  /// Short label shown next to the meter ("Weak" / "Strong" / etc.).
  /// Empty string when score is 0 so the meter renders blank for an
  /// empty input.
  label: string;
  /// Optional one-line nudge ("longer or more variety helps") shown
  /// below the meter. Omitted at score 4.
  hint?: string;
  /// `true` when the input is shorter than the relay's accepted
  /// minimum and a signup attempt would 400 server-side. Parents can
  /// surface this directly to disable a Submit button.
  belowMinLength: boolean;
}

/// Most-common-passwords blocklist. Tiny on purpose — covers the
/// usual suspects without trying to be comprehensive. A password that
/// matches any of these (case-insensitive prefix) gets penalized into
/// the Weak band regardless of how it scores otherwise.
const COMMON_PREFIXES = [
  "password",
  "qwerty",
  "abc123",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "fishbones",
  "matt",
];

/// Pure-numeric or pure-alphabetic sequences ("123456789", "aaaaaa",
/// etc.) get a separate ding — long but lazy.
const LAZY_PATTERNS = [
  /^(?:0123456789|123456789?|987654321|abcdefgh|qwertyuiop)/i,
  /^(\w)\1{4,}/, // 5+ of the same character at the start
];

/// 8 chars matches the relay's signup validator
/// (api/src/routes/auth.rs `password.len() < 8`). Surfacing the same
/// number client-side means the strength meter's "Too short" message
/// matches what the server would reject.
export const PASSWORD_MIN_LENGTH = 8;

export function scorePassword(value: string): PasswordScore {
  if (value.length === 0) {
    return { score: 0, label: "", belowMinLength: true };
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      score: 1,
      label: "Too short",
      hint: `${PASSWORD_MIN_LENGTH}+ characters required`,
      belowMinLength: true,
    };
  }

  let points = 0;
  // Length brackets — diminishing returns past 16. Length is the
  // single biggest factor in real entropy, so we weight it more than
  // character classes. A 24-char passphrase of plain words is far
  // stronger than an 8-char "P@ssw0rd!" but the simple class-count
  // heuristic would rate them similarly without this weighting.
  if (value.length >= PASSWORD_MIN_LENGTH) points += 1;
  if (value.length >= 12) points += 1;
  if (value.length >= 16) points += 1;
  if (value.length >= 20) points += 1;

  // Character classes — small contribution each, capped at 3 total
  // so a long single-class passphrase ("correct horse battery staple")
  // can still reach Strong without forcing arbitrary symbol injection.
  let classPts = 0;
  if (/[a-z]/.test(value)) classPts += 1;
  if (/[A-Z]/.test(value)) classPts += 1;
  if (/\d/.test(value)) classPts += 1;
  if (/[^a-zA-Z0-9]/.test(value)) classPts += 1;
  points += Math.min(classPts, 3);

  // Penalties — applied AFTER the additive scoring so even a long
  // password full of `aaaaaa` lands in Weak.
  const lower = value.toLowerCase();
  const isCommon = COMMON_PREFIXES.some((p) => lower.startsWith(p));
  const isLazy = LAZY_PATTERNS.some((re) => re.test(value));
  if (isCommon) points -= 4;
  if (isLazy) points -= 3;

  // Map points → 4-band score. Thresholds tuned so that:
  //   - 8 chars, single class       → Weak (1)
  //   - 8 chars, mixed classes      → Fair (2)
  //   - 12+ chars, mixed classes    → Good (3)
  //   - 16+ chars, mixed classes    → Strong (4)
  //   - common/lazy pattern         → forced into Weak (1)
  const score: PasswordStrength =
    points <= 2 ? 1 : points <= 4 ? 2 : points <= 6 ? 3 : 4;

  switch (score) {
    case 1:
      return {
        score,
        label: "Weak",
        hint: isCommon
          ? "common password — pick something less guessable"
          : isLazy
            ? "looks lazy — try a passphrase or random characters"
            : "add length, mix cases, digits, symbols",
        belowMinLength: false,
      };
    case 2:
      return {
        score,
        label: "Fair",
        hint: "longer or more variety helps",
        belowMinLength: false,
      };
    case 3:
      return { score, label: "Good", hint: undefined, belowMinLength: false };
    case 4:
    default:
      return { score: 4, label: "Strong", hint: undefined, belowMinLength: false };
  }
}

export interface PasswordFieldProps {
  value: string;
  onChange: (next: string) => void;
  /// Visible field label. Defaults to "Password".
  label?: string;
  /// Optional small helper text below the input. The strength meter
  /// renders below this; pass `null` to hide both helper + the
  /// "create-account" copy entirely.
  helper?: string | null;
  /// Show or hide the strength meter. Default `true`. Set `false` for
  /// pure-login surfaces where strength scoring of the EXISTING
  /// password adds nothing — the user already chose it.
  showStrength?: boolean;
  /// Forwarded to the underlying input. Use `"current-password"` for
  /// dual-mode dialogs (matches the Sign-in default), `"new-password"`
  /// for explicit create-account flows so password managers offer to
  /// generate one.
  autoComplete?: string;
  /// Whether the field is required for form submission. Forwarded to
  /// the input.
  required?: boolean;
  /// Disable the input + the show/hide button. Used while a submit
  /// is in flight.
  disabled?: boolean;
  /// Auto-focus on mount. The SignInDialog uses this on the password
  /// input only when prefilling email from a remembered account.
  autoFocus?: boolean;
  /// Optional id override — useful when an external `<label htmlFor>`
  /// needs to match. We generate one with `useId` by default.
  inputId?: string;
  /// Optional error message — replaces the helper line when set and
  /// tints the input border red. Used by the SignInDialog's confirm-
  /// password field to surface "Passwords don't match" without
  /// taking up an extra row.
  error?: string | null;
}

/// Dot icon variants — drawn inline so we don't pull a third icon set
/// just for two glyphs. Stroke-only, sized to the surrounding control.
function EyeOpen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosed() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.4 10.4 0 0 1 12 6c6.5 0 10 7 10 7a17.5 17.5 0 0 1-3.7 4.3M6.6 6.6A17.6 17.6 0 0 0 2 13s3.5 7 10 7c1.7 0 3.2-.4 4.5-1" />
      <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
    </svg>
  );
}

export default function PasswordField({
  value,
  onChange,
  label = "Password",
  helper = `At least ${PASSWORD_MIN_LENGTH} characters if creating a new account.`,
  showStrength = true,
  autoComplete = "current-password",
  required = false,
  disabled = false,
  autoFocus = false,
  inputId,
  error,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const id = inputId ?? generatedId;

  const score = useMemo(() => scorePassword(value), [value]);
  const hasError = !!error;

  return (
    <div className={`fishbones-pwfield${hasError ? " fishbones-pwfield--invalid" : ""}`}>
      <label className="fishbones-pwfield__label" htmlFor={id}>
        {label}
      </label>

      <div className="fishbones-pwfield__row">
        <input
          id={id}
          className="fishbones-pwfield__input"
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          // We deliberately don't set `minLength` on the input itself —
          // the parent form may want to allow short passwords on a
          // login attempt (the user might have a legacy account
          // pre-dating today's policy). Strength scoring reports
          // `belowMinLength` and the parent decides whether to block.
          spellCheck={false}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError
              ? `${id}-error`
              : showStrength
                ? `${id}-strength`
                : undefined
          }
        />
        <button
          type="button"
          className="fishbones-pwfield__toggle"
          onClick={() => setRevealed((v) => !v)}
          disabled={disabled}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          tabIndex={value.length === 0 ? -1 : 0}
        >
          {revealed ? <EyeClosed /> : <EyeOpen />}
        </button>
      </div>

      {showStrength && value.length > 0 && !hasError && (
        <div
          id={`${id}-strength`}
          className={`fishbones-pwfield__strength fishbones-pwfield__strength--s${score.score}`}
          // aria-live so screen readers hear the strength change as
          // the user types. Polite (not assertive) so we don't
          // interrupt a keystroke flow on every character.
          aria-live="polite"
        >
          <div className="fishbones-pwfield__bar" aria-hidden>
            <span className="fishbones-pwfield__bar-seg" data-on={score.score >= 1 || undefined} />
            <span className="fishbones-pwfield__bar-seg" data-on={score.score >= 2 || undefined} />
            <span className="fishbones-pwfield__bar-seg" data-on={score.score >= 3 || undefined} />
            <span className="fishbones-pwfield__bar-seg" data-on={score.score >= 4 || undefined} />
          </div>
          <span className="fishbones-pwfield__label-strength">{score.label}</span>
        </div>
      )}

      {/* Error takes precedence over the helper; both targets the
          same slot so the form doesn't reflow when validity flips.
          Polite aria-live so screen readers announce a newly-
          appearing mismatch without interrupting typing. */}
      {hasError ? (
        <small id={`${id}-error`} className="fishbones-pwfield__error" aria-live="polite">
          {error}
        </small>
      ) : helper !== null ? (
        <small className="fishbones-pwfield__helper">
          {/* When there's an active hint from scorePassword, swap it
              in for the static helper — it's more actionable than
              the generic "8+ chars" copy. */}
          {value.length > 0 && score.hint ? score.hint : helper}
        </small>
      ) : null}
    </div>
  );
}
