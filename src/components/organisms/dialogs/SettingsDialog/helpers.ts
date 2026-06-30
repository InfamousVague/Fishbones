/// Map a Resources-panel check id back to a `LanguageId`-shaped string so
/// the row can render a brand chip. Only language-bound checks return a
/// value; bundled-asset / user-data / network checks return null and the
/// row renders chip-less. Kept in sync with the toolchain entries in
/// `src-tauri/src/diagnostics.rs::run_diagnostics`.
export function languageForCheckId(id: string): string | null {
  switch (id) {
    case "toolchain-clang": return "cpp";
    case "toolchain-java": return "java";
    case "toolchain-kotlinc": return "kotlin";
    case "toolchain-dotnet": return "csharp";
    case "toolchain-swift": return "swift";
    case "toolchain-as": return "assembly";
    case "toolchain-go": return "go";
    case "toolchain-rustc": return "rust";
    case "toolchain-zig": return "zig";
    case "toolchain-elixir": return "elixir";
    case "toolchain-ruby": return "ruby";
    case "toolchain-runghc": return "haskell";
    case "solc-cdn": return "solidity";
    default: return null;
  }
}

/// Pick the most informative provider label for the signed-in account
/// row. Preference order is Apple → Google → email/password — Apple and
/// Google override an email password if both are linked, because in
/// practice if the learner used SIWA at any point, that's the
/// authoritative entry point they're likely to remember.
export function describeAuthProvider(user: {
  apple_linked: boolean;
  google_linked: boolean;
  has_password: boolean;
}): string {
  if (user.apple_linked) return "Signed in via Apple";
  if (user.google_linked) return "Signed in via Google";
  if (user.has_password) return "Signed in with email";
  return "Signed in";
}
