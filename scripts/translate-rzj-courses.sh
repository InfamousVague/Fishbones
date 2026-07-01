#!/usr/bin/env bash
# Batch-translate course content, in two tiers:
#   TIER 1 (full 16 locales): the two flagship books (A to Zig + TRPL).
#   TIER 2 (top-5 cohorts):   the rest of the Rust / Zig / JavaScript courses.
#
# Uses scripts/translate-course.mjs (Anthropic Claude / Sonnet), reading the
# API key from .env via `node --env-file` (never sourced into the shell).
#
# RESUMABLE + idempotent — the underlying script skips lessons/locales already
# translated, so you can Ctrl-C and re-run any time; it continues where it
# left off.
#
#   ./scripts/translate-rzj-courses.sh
#   # background + logged:
#   nohup ./scripts/translate-rzj-courses.sh > logs/translate/_driver.log 2>&1 &
#
# TUNABLES (env):
#   COURSE_CONCURRENCY   courses in parallel (default 3; raise per rate limit)
#   LOCALES_FULL         locale set for the flagship books (default: all 16)
#   LOCALES_TOP5         locale set for the rest (default: hi,ar,ur,tr,bn)

set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ] || ! grep -q 'ANTHROPIC_API_KEY' .env; then
  echo "ERROR: ANTHROPIC_API_KEY not found in ./.env" >&2
  exit 1
fi

LOCALES_FULL="${LOCALES_FULL:-ru,es,fr,kr,jp,hi,ar,ur,tr,bn,tl,fa,ne,vi,id,sw}"
LOCALES_TOP5="${LOCALES_TOP5:-hi,ar,ur,tr,bn}"
CONCURRENCY="${COURSE_CONCURRENCY:-3}"
LOGDIR="logs/translate"
mkdir -p "$LOGDIR"

# Tier 1 — full 16-locale translations for the two flagship books.
FULL_COURSES=(a-to-zig the-rust-programming-language)

# Tier 2 — top-5 cohorts for the remaining Rust / Zig / JavaScript courses.
REST_COURSES=(
  # Rust
  challenges-rust-handwritten exercism-rust rust-async-book rust-by-example
  rustlings rustonomicon solana-programs testing-rust
  # Zig
  challenges-zig-handwritten exercism-zig ziglings
  # JavaScript
  challenges-javascript-handwritten crafting-interpreters-js eloquent-javascript
  exercism-javascript functional-light-js javascript-for-beginners javascript-info
  javascript-koans learning-react-native mastering-bitcoin mastering-ethereum
  mastering-lightning-network pro-git testing-javascript you-dont-know-js-yet
)

echo "[translate] tier1 (16 locales): ${FULL_COURSES[*]}"
echo "[translate] tier2 ($LOCALES_TOP5): ${#REST_COURSES[@]} courses"
echo "[translate] concurrency $CONCURRENCY · per-course logs → $LOGDIR/<course>.log"
echo ""

run_one() {
  local spec="$1" c loc
  c="${spec%%|*}"
  loc="${spec##*|}"
  echo "[translate] ▶ start  $c [$loc]"
  if node --env-file=.env scripts/translate-course.mjs "$c" --locales "$loc" \
        > "$LOGDIR/$c.log" 2>&1; then
    echo "[translate] ✓ done   $c"
  else
    echo "[translate] ✗ FAILED $c — see $LOGDIR/$c.log"
  fi
}
export -f run_one
export LOGDIR

{
  for c in "${FULL_COURSES[@]}"; do echo "$c|$LOCALES_FULL"; done
  for c in "${REST_COURSES[@]}"; do echo "$c|$LOCALES_TOP5"; done
} | xargs -P "$CONCURRENCY" -n1 bash -c 'run_one "$0"'

echo ""
echo "[translate] batch finished. Re-run to fill any gaps (idempotent)."
echo "[translate] NOTE: translated JSON is written in place under"
echo "            public/starter-courses/ — rebuild + redeploy to ship it."
