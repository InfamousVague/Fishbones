import type { RunResult } from "./types";

/// Friendly placeholder for languages whose runtime is reserved but
/// not yet wired to a host subprocess or vendored WASM. Returns a
/// `desktopOnly`-shaped RunResult so the existing OutputPane upsell
/// banner picks it up — same UI a learner sees for C/C++/Java today
/// when the toolchain isn't installed.
///
/// As we wire each language's real runner (ruby.wasm, `runghc`,
/// `aptos move test`, etc.) we drop its case from the switch below
/// and the corresponding `case "<lang>": return runComingSoon(...)`
/// in `runtimes/index.ts` flips to a real runtime call. Until then
/// the lesson surface still works — the picker shows the language,
/// templates render, syntax highlighting works, the user just gets
/// a "coming soon" Run button instead of execution.

interface ComingSoon {
  /// Short label for the OutputPane banner — used as the headline.
  readonly label: string;
  /// One-line install hint shown under the headline. References the
  /// canonical CLI / package the host needs.
  readonly hint: string;
  /// `true` when the runtime is going to be a host-toolchain
  /// subprocess (Ruby / Elixir / Move / Cairo / Sway). On the web
  /// build the upsell banner mentions desktop install. `false` for
  /// languages where the eventual runtime will be browser-vendored
  /// (none in this set today, but future Ruby via ruby.wasm could
  /// lift the desktop-only label).
  readonly hostToolchain: true;
}

const COMING_SOON: Record<string, ComingSoon> = {
  ruby: {
    label: "Ruby runtime — coming soon",
    hint: "Will run via ruby.wasm in the browser (vendored WASM build of MRI Ruby). Until that lands, install Ruby on your host (`brew install ruby` / `apt install ruby`) and the desktop runner will pick it up.",
    hostToolchain: true,
  },
  elixir: {
    label: "Elixir runtime — coming soon",
    hint: "Needs the Elixir CLI on the host. Install with `brew install elixir` (macOS) or `asdf install elixir 1.16` (cross-platform). Web build runs against a future Elixir-on-WASM port — track BEAM-on-WASM progress.",
    hostToolchain: true,
  },
  move: {
    label: "Move runtime — coming soon",
    hint: "Aptos / Sui share Move. Install the Aptos CLI (`brew install aptos`) or the Sui CLI (`brew install sui`) and the desktop runner will dispatch `aptos move test` / `sui move test` based on the lesson's manifest.",
    hostToolchain: true,
  },
  cairo: {
    label: "Cairo runtime — coming soon",
    hint: "StarkNet's Cairo 1 toolchain installs via Scarb (`curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh`). Once it's on PATH the desktop runner shells out to `scarb cairo-run`.",
    hostToolchain: true,
  },
  sway: {
    label: "Sway runtime — coming soon",
    hint: "Fuel's `forc` toolchain installs via `curl https://install.fuel.network | sh`. Once on PATH the desktop runner shells out to `forc test`.",
    hostToolchain: true,
  },
  haskell: {
    label: "Haskell runtime — coming soon",
    hint: "GHC + runghc installs via GHCup (`curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh`). Web build will route to a sandboxed compile service in a future iteration; until then, install on the host.",
    hostToolchain: true,
  },
  scala: {
    label: "Scala runtime — coming soon",
    hint: "Use Coursier's `scala-cli` for the smallest install footprint (`brew install Virtuslab/scala-cli/scala-cli` / `curl -sSL https://github.com/VirtusLab/scala-cli/releases/latest/download/scala-cli-x86_64-pc-linux.gz | gunzip > scala-cli`). Desktop runner will dispatch to `scala-cli run`.",
    hostToolchain: true,
  },
  dart: {
    label: "Dart runtime — coming soon",
    hint: "Install the Dart SDK via `brew install dart-sdk` or via `apt install dart`. Web build will route to a sandboxed DartPad-style compile service; desktop runner shells out to `dart run`.",
    hostToolchain: true,
  },
};

export function runComingSoon(language: string): RunResult {
  const meta = COMING_SOON[language];
  return {
    logs: [],
    durationMs: 0,
    desktopOnly: {
      language,
      reason: meta?.hint ?? "This language's runtime is being wired up — check back soon.",
    },
  };
}
