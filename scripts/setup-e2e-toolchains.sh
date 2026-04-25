#!/usr/bin/env bash
# Install every local toolchain the Playwright E2E sweep needs.
#
# Safe to re-run: each step probes the tool first and only installs
# when missing. Non-destructive — never touches shell rc files or
# system PATH. Prints exact PATH-export lines at the end for the
# toolchains that Homebrew keg-only installs (notably openjdk).
#
# Usage:
#     ./scripts/setup-e2e-toolchains.sh           # interactive
#     ./scripts/setup-e2e-toolchains.sh --yes     # auto-install
#     npm run setup:toolchains                    # same, via npm
#
# Exits 0 when everything needed is present OR installed successfully;
# non-zero if any install step fails. Xcode Command Line Tools are
# probed but left to the user — Apple's installer is a GUI prompt
# and scripting it requires sudo.

set -euo pipefail

AUTO_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=1 ;;
    --help|-h)
      sed -n 's/^# //p; s/^#$//p' "$0" | head -24
      exit 0
      ;;
  esac
done

# ---- Styling ---------------------------------------------------------
bold() { printf '\033[1m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }
gray() { printf '\033[90m%s\033[0m' "$1"; }

OS="$(uname -s)"
if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  echo "$(red "Unsupported OS: $OS"). This script targets macOS + Linux."
  exit 1
fi

# Prepend Homebrew keg-only locations to our PATH so the probes match
# what the E2E suite sees. `local-run.ts` does the same trick at Node
# module-load time; mirroring it here means the "javac missing" report
# stops lying when the user has openjdk brew-installed but keg-only.
# Only dirs that actually exist get prepended (no-op otherwise).
augment_path() {
  local extras=(
    "/opt/homebrew/bin"
    "/opt/homebrew/sbin"
    "/usr/local/bin"
    "/opt/homebrew/opt/openjdk/bin"
    "/usr/local/opt/openjdk/bin"
    "/opt/homebrew/opt/kotlin/bin"
    "/usr/local/opt/kotlin/bin"
    "$HOME/.cargo/bin"
    "$HOME/.dotnet/tools"
  )
  for p in "${extras[@]}"; do
    if [[ -d "$p" && ":$PATH:" != *":$p:"* ]]; then
      PATH="$p:$PATH"
    fi
  done
  export PATH
}
augment_path

# ---- Brew check (macOS) ---------------------------------------------
if [[ "$OS" == "Darwin" ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "$(red "Homebrew isn't installed.")"
    echo "  Install from https://brew.sh and re-run this script."
    exit 1
  fi
fi

# ---- Helpers ---------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

# Probe a binary with a version flag; returns 0 when the tool runs
# cleanly. Java needs its own logic because /usr/bin/javac on macOS
# is Apple's stub that exits non-zero until a real JDK is installed.
probe() {
  local bin="$1" flag="${2:---version}"
  if ! have "$bin"; then return 1; fi
  "$bin" "$flag" >/dev/null 2>&1
}

ask() {
  local prompt="$1"
  if [[ "$AUTO_YES" == "1" ]]; then
    echo "$prompt $(gray "[auto-yes]")"
    return 0
  fi
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

brew_install() {
  local pkg="$1" kind="${2:-formula}"
  if [[ "$kind" == "cask" ]]; then
    brew install --cask "$pkg"
  else
    brew install "$pkg"
  fi
}

PENDING_INSTALLS=()
POST_HINTS=()

check_and_queue() {
  local label="$1" probe_bin="$2" probe_flag="$3" pkg="$4" kind="${5:-formula}"
  printf '  %-14s' "$label"
  if probe "$probe_bin" "$probe_flag"; then
    echo "$(green "✓ installed")"
  else
    echo "$(yellow "✗ missing")$(gray " — brew $kind $pkg")"
    PENDING_INSTALLS+=("$label|$probe_bin|$probe_flag|$pkg|$kind")
  fi
}

echo "$(bold "Fishbones E2E toolchain check")"
echo
echo "$(gray "Probing each toolchain the Playwright suite runs against…")"
echo

# JavaScript/TypeScript/Python run in the browser — no system deps.
# Rust/Go/C/C++/Java/Kotlin/C#/Assembly/Swift need local binaries.
#
# Checked per-language with the version flag the tool actually accepts
# (java is quirky; openjdk stubs on macOS exit non-zero until real).
check_and_queue "rustc"    rustc    --version  rust         formula
check_and_queue "go"       go       version    go           formula
check_and_queue "cc"       cc       --version  ""           skip    # Xcode CLT
check_and_queue "c++"      c++      --version  ""           skip
check_and_queue "javac"    javac    -version   openjdk      formula
check_and_queue "java"     java     -version   openjdk      formula
check_and_queue "kotlinc"  kotlinc  -version   kotlin       formula
check_and_queue "dotnet"   dotnet   --version  dotnet-sdk   cask
check_and_queue "swift"    swift    --version  ""           skip    # Xcode CLT
check_and_queue "as"       as       --version  ""           skip    # Xcode CLT
# ld: Apple's rejects --version, GNU ld accepts it. Try -v first.
printf '  %-14s' "ld"
if have ld && (ld -v >/dev/null 2>&1 || ld --version >/dev/null 2>&1); then
  echo "$(green "✓ installed")"
else
  echo "$(yellow "✗ missing")$(gray " — Xcode CLT / binutils")"
  PENDING_INSTALLS+=("ld|ld|-v||skip")
fi

echo

# Separate skippable-installs from brew-installables.
BREW_INSTALLS=()
SYSTEM_MISSING=()
for entry in "${PENDING_INSTALLS[@]:-}"; do
  if [[ -z "$entry" ]]; then continue; fi
  IFS='|' read -r _label _bin _flag pkg kind <<< "$entry"
  if [[ "$kind" == "skip" ]]; then
    SYSTEM_MISSING+=("$entry")
  else
    BREW_INSTALLS+=("$pkg|$kind")
  fi
done

# Dedupe brew installs (openjdk appears twice because both javac + java
# point at it; we only need to install once).
UNIQUE_BREW=()
seen=""
for pair in "${BREW_INSTALLS[@]:-}"; do
  if [[ -z "$pair" ]]; then continue; fi
  case "$seen" in *"|$pair|"*) continue ;; esac
  UNIQUE_BREW+=("$pair")
  seen="$seen|$pair|"
done

if [[ "${#UNIQUE_BREW[@]}" -eq 0 && "${#SYSTEM_MISSING[@]}" -eq 0 ]]; then
  echo "$(green "All toolchains present. You're good to run npm run test:e2e.")"
  exit 0
fi

if [[ "${#UNIQUE_BREW[@]}" -gt 0 ]]; then
  echo "$(bold "Missing from Homebrew:")"
  for pair in "${UNIQUE_BREW[@]}"; do
    IFS='|' read -r pkg kind <<< "$pair"
    echo "  • $pkg $(gray "($kind)")"
  done
  echo

  if ask "Install these now?"; then
    for pair in "${UNIQUE_BREW[@]}"; do
      IFS='|' read -r pkg kind <<< "$pair"
      echo
      echo "$(bold "→ brew install $([ "$kind" = cask ] && echo '--cask ')$pkg")"
      if [[ "$kind" == "cask" ]]; then
        brew install --cask "$pkg"
      else
        brew install "$pkg"
      fi
    done
  else
    echo "$(gray "Skipped. Install manually later — the Playwright suite will")"
    echo "$(gray "show those languages as skip in the reporter until you do.")"
  fi
fi

if [[ "${#SYSTEM_MISSING[@]}" -gt 0 ]]; then
  echo
  echo "$(bold "System tools (not brew-installable):")"
  for entry in "${SYSTEM_MISSING[@]}"; do
    IFS='|' read -r label _bin _flag _pkg _kind <<< "$entry"
    echo "  • $label $(gray "— install Xcode Command Line Tools: xcode-select --install")"
  done
fi

# Homebrew's openjdk is keg-only on macOS — the `java`/`javac` wrappers
# in /opt/homebrew/bin don't symlink automatically. Our PATH
# augmentation at the top of this script (and mirrored in
# tests/e2e/helpers/local-run.ts at Node module-load) makes the E2E
# suite see openjdk just fine. BUT the user's regular shell still
# doesn't, so `javac` outside this repo reports missing. Print the
# path-fix hint only when that's actually the situation — not on a
# machine where openjdk is already system-wide.
if [[ "$OS" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  if brew list openjdk >/dev/null 2>&1; then
    JDK_PREFIX="$(brew --prefix openjdk 2>/dev/null || true)"
    if [[ -n "$JDK_PREFIX" && ! -e "/Library/Java/JavaVirtualMachines/openjdk.jdk" ]]; then
      POST_HINTS+=(
        "$(green "✓") The E2E suite is ready — it finds openjdk via PATH augmentation in local-run.ts."
        ""
        "For Java availability in your REGULAR shell (outside this repo), pick one:"
        "  • Per-shell:   add to ~/.zshrc / ~/.bashrc →  export PATH=\"$JDK_PREFIX/bin:\$PATH\""
        "  • System-wide: sudo ln -sfn $JDK_PREFIX/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk"
      )
    fi
  fi
fi

# dotnet-script is the tool `run_csharp` shells out to. It's a global
# .NET tool, installed via `dotnet tool install`. Not a brew package.
if have dotnet && ! dotnet script --version >/dev/null 2>&1; then
  echo
  echo "$(yellow "dotnet script tool is missing")$(gray " (needed for C# challenge runs).")"
  if ask "Install dotnet-script now?"; then
    dotnet tool install -g dotnet-script || true
    POST_HINTS+=(
      "Make sure ~/.dotnet/tools is on PATH (the installer tells you if not)."
    )
  fi
fi

if [[ "${#POST_HINTS[@]}" -gt 0 ]]; then
  echo
  echo "$(bold "Post-install notes")"
  for hint in "${POST_HINTS[@]}"; do
    echo "  $hint"
  done
fi

echo
echo "$(green "Done.") Re-run this script any time — it skips tools already present."
