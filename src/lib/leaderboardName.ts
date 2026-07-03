/// Client mirror of the relay's leaderboard-name validation
/// (api/src/alias.rs) so the claim dialog gives instant feedback. The
/// SERVER is the enforcement layer — this exists purely for UX, and the
/// error codes match the relay's 400 payloads verbatim.

export type NameError = "invalid_length" | "invalid_chars" | "profanity";

/// Basic profanity wordlist, pre-normalized (lowercase, no separators).
/// Kept in sync with the Rust `BANNED` list. Substring-matched against
/// the normalized candidate. Small on purpose — it stops drive-by
/// vulgarity, not determined adversaries.
const BANNED = [
  "fuck", "shit", "bitch", "cunt", "asshole", "dick", "cock", "pussy",
  "nigger", "nigga", "faggot", "retard", "whore", "slut", "bastard",
  "damn", "piss", "wank", "twat", "prick", "douche", "jackass",
  "nazi", "hitler", "rape", "molest", "pedo", "porn", "sex",
];

/// Fold leet-speak and strip separators: "F_u-c 4k" → "fucak"-ish forms
/// normalize into their plain spelling before the substring check.
function normalize(name: string): string {
  let out = "";
  for (const c of name.toLowerCase()) {
    if (c === "0") out += "o";
    else if (c === "1" || c === "!") out += "i";
    else if (c === "3") out += "e";
    else if (c === "4" || c === "@") out += "a";
    else if (c === "5" || c === "$") out += "s";
    else if (c === "7") out += "t";
    else if (c === " " || c === "_" || c === "-") continue;
    else if (/[a-z0-9]/.test(c)) out += c;
  }
  return out;
}

/// `null` = valid. Rules mirror the relay: 3–24 chars, [A-Za-z0-9 _-],
/// no leading/trailing whitespace, basic profanity check.
export function validateLeaderboardName(name: string): NameError | null {
  if (name.trim() !== name || name.length < 3 || name.length > 24) {
    return "invalid_length";
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return "invalid_chars";
  }
  const norm = normalize(name);
  if (BANNED.some((w) => norm.includes(w))) {
    return "profanity";
  }
  return null;
}
