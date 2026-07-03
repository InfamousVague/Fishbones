import { useCallback, useEffect, useState } from "react";
import { profileKey } from "@/lib/profileStore";
import {
  validateLeaderboardName,
  type NameError,
} from "@/lib/leaderboardName";

/// The viewer's public leaderboard identity + the claim flow.
///
/// The global leaderboard never shows account display names (privacy —
/// OAuth fills those with real names); every user appears under a
/// deterministic pseudonym until they explicitly claim a handle. This
/// hook backs the "claim your spot" banner on the leaderboard tab:
///
///   GET /leaderboard/name  → { name, claimed }
///   PUT /leaderboard/name  → 204 | 400 { error }
///
/// Standalone on purpose: reads the same token storage useLibreCloud
/// owns (same profileKey slot) rather than importing the hook — the
/// banner lives in a leaf panel and shouldn't pull the whole cloud
/// hook's state machine along.
const TOKEN_KEY = profileKey("libre:cloud:token-v1");
const URL_OVERRIDE_KEY = "libre:cloud:url-override-v1";
const DEFAULT_RELAY_URL = "https://api.libre.academy";

function relayUrl(): string {
  try {
    return localStorage.getItem(URL_OVERRIDE_KEY) || DEFAULT_RELAY_URL;
  } catch {
    return DEFAULT_RELAY_URL;
  }
}
function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export interface UseLeaderboardName {
  /// The name the global board currently shows for this user (claimed
  /// handle or pseudonym). Null while loading / signed out.
  alias: string | null;
  /// Whether the user has already claimed a custom handle.
  claimed: boolean;
  loading: boolean;
  /// Claim `name`. Resolves null on success, or an error code
  /// (client-validated first for instant feedback; server re-validates).
  claim: (name: string) => Promise<NameError | "network" | null>;
}

export function useLeaderboardName(signedIn: boolean): UseLeaderboardName {
  const [alias, setAlias] = useState<string | null>(null);
  // Default to claimed=true so the banner never flashes for signed-out
  // users, while loading, or against an older relay without the route
  // (404 → stay hidden).
  const [claimed, setClaimed] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tok = token();
    if (!signedIn || !tok) {
      setAlias(null);
      setClaimed(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(`${relayUrl()}/leaderboard/name`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
      .then(async (res) => {
        if (cancelled || !res.ok) return; // 401/404 → banner stays hidden
        const body = (await res.json()) as { name: string; claimed: boolean };
        if (cancelled) return;
        setAlias(body.name);
        setClaimed(body.claimed);
      })
      .catch(() => {
        /* offline — banner stays hidden */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const claim = useCallback(
    async (name: string): Promise<NameError | "network" | null> => {
      const invalid = validateLeaderboardName(name);
      if (invalid) return invalid;
      const tok = token();
      if (!tok) return "network";
      try {
        const res = await fetch(`${relayUrl()}/leaderboard/name`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name }),
        });
        if (res.status === 204 || res.ok) {
          setAlias(name);
          setClaimed(true);
          return null;
        }
        if (res.status === 400) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          const code = body?.error;
          if (
            code === "invalid_length" ||
            code === "invalid_chars" ||
            code === "profanity"
          ) {
            return code;
          }
        }
        return "network";
      } catch {
        return "network";
      }
    },
    [],
  );

  return { alias, claimed, loading, claim };
}
