#!/usr/bin/env bash
#
# Run a release build with offline audio baked into the bundled course
# archives, then put the slim archives back — guaranteed.
#
# WHY A WRAPPER: the Tauri bundler ships whatever `.academy` files sit
# in src-tauri/resources/bundled-packs/ (the seed reads that exact
# path at runtime). To make a desktop install self-contained we need
# the audio-embedded copies there during `tauri build` — but ONLY
# then. They must never reach a `dev` build (40 MB × N is miserable to
# rebuild) and must never get committed (they'd bloat git). So this
# script swaps them in, runs the wrapped command, and restores the
# committed slim copies from git in an EXIT trap that fires on success,
# failure, or Ctrl-C alike.
#
# USAGE (normally via the Makefile, not by hand):
#   scripts/with-offline-audio.sh <command...>
#   e.g. scripts/with-offline-audio.sh make build
#
# ENV:
#   OFFLINE_AUDIO_CODEC   opus (default) | aac    passed to the bundler
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKS="src-tauri/resources/bundled-packs"          # git-relative
FULL_DIR="$ROOT/src-tauri/resources/bundled-packs-full"
CODEC="${OFFLINE_AUDIO_CODEC:-opus}"

# The narrated courses that ship in the installer. This is the single
# source of truth for the release audio set — keep in sync with
# CORE_NARRATED in bundle-audio-into-academy.mjs (only matters for the
# bundler's standalone `--core` convenience; here we pass ids
# explicitly so this list governs).
CORE_IDS=(
  a-to-ts
  a-to-zig
  javascript-typescript
  learning-go
  the-rust-programming-language
)

cd "$ROOT"

# ── Safety: never let restore() discard real work ────────────────
# restore() does `git checkout -- <archive>`, which throws away any
# uncommitted change to that file. So refuse to start if any narrated
# archive is dirty — the operator must commit/stash first.
for id in "${CORE_IDS[@]}"; do
  if [ -n "$(git status --porcelain -- "$PACKS/$id.academy" 2>/dev/null)" ]; then
    echo "[offline-audio] ABORT: $PACKS/$id.academy has uncommitted changes (staged or unstaged)."
    echo "  Commit or stash it first — this script restores it with 'git checkout'"
    echo "  on exit and would otherwise discard your changes."
    exit 1
  fi
done

SWAPPED=()
restore() {
  local rc=$?
  if [ ${#SWAPPED[@]} -gt 0 ]; then
    echo "[offline-audio] restoring slim bundled-packs (git checkout)…"
    for id in "${SWAPPED[@]}"; do
      git checkout -- "$PACKS/$id.academy" 2>/dev/null \
        || echo "[offline-audio] WARN: could not restore $PACKS/$id.academy — check 'git status'"
    done
  fi
  return $rc
}
trap restore EXIT

# ── 1. Generate the audio-embedded archives (from the live CDN) ──
echo "[offline-audio] generating audio-embedded archives (codec=$CODEC)…"
node "$ROOT/scripts/bundle-audio-into-academy.mjs" "${CORE_IDS[@]}" --codec "$CODEC"

# ── 2. Swap full archives in for the slim ones ───────────────────
echo "[offline-audio] swapping full archives into $PACKS/…"
for id in "${CORE_IDS[@]}"; do
  if [ -f "$FULL_DIR/$id.academy" ]; then
    cp "$FULL_DIR/$id.academy" "$PACKS/$id.academy"
    SWAPPED+=("$id")
    echo "[offline-audio]   + $id ($(du -h "$PACKS/$id.academy" | cut -f1))"
  else
    # The bundler skips courses with no narration in the live manifest.
    # Ship the committed slim archive for those rather than failing the
    # whole release.
    echo "[offline-audio]   - $id: no audio archive generated; shipping slim"
  fi
done

# ── 3. Run the wrapped build (restore() runs on exit no matter what) ─
echo "[offline-audio] running: $*"
"$@"
