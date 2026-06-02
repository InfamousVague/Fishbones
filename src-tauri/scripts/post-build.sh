#!/bin/bash
# Post-build: Sign the Libre .app bundle with hardened runtime + secure
# timestamp, then rebuild the DMG with an Applications symlink for
# drag-to-install. Run after `cargo tauri build`.
#
# Reads APPLE_SIGNING_IDENTITY from ../.env.apple (the repo root). When
# no identity is set we exit cleanly so local dev builds (which don't
# need signing) keep working.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"

# Find the built .app bundle
APP_BUNDLE=$(find "$TAURI_DIR/target/release/bundle/macos" -name "*.app" -maxdepth 1 2>/dev/null | head -1)

if [ -z "$APP_BUNDLE" ]; then
    echo "No .app bundle found in target/release/bundle/macos — skipping post-build"
    exit 0
fi

# Load signing identity from .env.apple (repo root).
ENV_FILE="$TAURI_DIR/../.env.apple"
if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
fi

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

if [ -z "$IDENTITY" ]; then
    echo "WARNING: No APPLE_SIGNING_IDENTITY in .env.apple — skipping code signing"
    exit 0
fi

echo "=== Signing with: $IDENTITY ==="

# Sign every nested Mach-O binary under Contents/Resources FIRST.
# Apple notarization fails the entire bundle if any inner executable
# is unsigned / missing hardened runtime / missing a secure timestamp,
# so we can't rely on the outer `.app` sign alone. Notable inner
# binaries that need this:
#   - Contents/Resources/resources/solana/bin/* (Solana CLI tools
#     fetched by scripts/fetch-solana-cli.mjs and dropped into
#     bundleResources by tauri.conf.json's resources field)
#   - Contents/Resources/resources/node/bin/node (the bundled Node
#     used by the AI ingest pipeline; same fetch pattern)
#   - Any future third-party binary added to bundleResources
#
# `file` filters to actual Mach-O executables — text scripts, JSON,
# certs etc. live in the same directory tree but don't need signing.
# `--options runtime --timestamp` enable hardened runtime + Apple's
# secure timestamp service; both are notarization requirements.
echo "=== Signing nested Mach-O binaries ==="
NESTED_COUNT=0
while IFS= read -r BIN; do
    if file "$BIN" 2>/dev/null | grep -q "Mach-O"; then
        codesign --force --options runtime --timestamp \
            --sign "$IDENTITY" \
            "$BIN" >/dev/null 2>&1 || echo "  WARN: failed to sign $BIN"
        NESTED_COUNT=$((NESTED_COUNT + 1))
    fi
done < <(find "$APP_BUNDLE/Contents/Resources" -type f 2>/dev/null)
echo "Signed: $NESTED_COUNT nested Mach-O binaries"

# Sign the main binary with hardened runtime + entitlements. The binary
# name matches the `[package] name` in Cargo.toml — `libre`.
codesign --force --options runtime --timestamp \
    --sign "$IDENTITY" \
    --entitlements "$TAURI_DIR/Entitlements.plist" \
    "$APP_BUNDLE/Contents/MacOS/libre"
echo "Signed: main binary"

# Sign the entire .app bundle (outermost, must be last). Inner Mach-O
# binaries were signed above so the outer signature's Code Directory
# hashes them all and notarization sees a fully-signed bundle.
codesign --force --options runtime --timestamp \
    --sign "$IDENTITY" \
    --entitlements "$TAURI_DIR/Entitlements.plist" \
    "$APP_BUNDLE"
echo "Signed: $APP_BUNDLE"

# Verify
echo ""
echo "=== Verification ==="
codesign --verify --deep --strict "$APP_BUNDLE" && echo "Signature valid" || echo "WARNING: Signature verification failed"
spctl --assess --type execute --verbose "$APP_BUNDLE" 2>&1 || true

# Rebuild DMG with properly signed app + Applications symlink for
# drag-to-install. Arch tag matches the host we built on.
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
VERSION=$(node -e "console.log(require('$TAURI_DIR/tauri.conf.json').version)" 2>/dev/null || echo "0.0.0")
ARCH=$(uname -m)
case "$ARCH" in
    arm64) ARCH_TAG="aarch64" ;;
    x86_64) ARCH_TAG="x64" ;;
    *) ARCH_TAG="$ARCH" ;;
esac
DMG_PATH="$DMG_DIR/Libre_${VERSION}_${ARCH_TAG}.dmg"
if [ -d "$DMG_DIR" ]; then
    echo ""
    echo "=== Rebuilding DMG with signed app ==="
    rm -f "$DMG_PATH"
    # Create staging folder with app + Applications symlink for drag-to-install
    DMG_STAGE=$(mktemp -d)
    cp -R "$APP_BUNDLE" "$DMG_STAGE/"
    ln -s /Applications "$DMG_STAGE/Applications"
    hdiutil create -volname "Libre" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH"
    rm -rf "$DMG_STAGE"
    # Sign the DMG
    codesign --force --sign "$IDENTITY" "$DMG_PATH"
    echo "DMG rebuilt and signed: $DMG_PATH"
fi

# --- Regenerate the OTA updater bundle from the freshly signed .app -
#
# Tauri's build creates `Libre.app.tar.gz` + `.sig` during the
# initial bundle step, BEFORE the nested-binary signing pass above.
# If we ship that build-time tarball as the OTA bundle, existing
# users who auto-update receive an .app whose nested Mach-O
# binaries lack hardened runtime / secure timestamp / Developer ID
# — Gatekeeper rejects them on next launch.
#
# Fix: re-tar the now-signed .app and re-sign the tarball with
# Tauri's updater key so the OTA bundle matches the DMG's signed
# contents. Without this step, the local-release pipeline ships a
# DMG that installs cleanly but an OTA bundle that breaks existing
# installs on update — an asymmetry that's hard to debug because
# fresh installs always succeed.
UPDATER_KEY="${TAURI_SIGNING_KEY_PATH:-$HOME/.tauri/fishbones-updater.key}"
UPDATER_TARBALL="$TAURI_DIR/target/release/bundle/macos/Libre.app.tar.gz"

if [ ! -f "$UPDATER_KEY" ]; then
    echo ""
    echo "WARN: OTA updater key not found at $UPDATER_KEY"
    echo "      Skipping OTA bundle regeneration. Existing users will"
    echo "      not be able to auto-update to this release."
elif [ ! -d "$APP_BUNDLE" ]; then
    echo ""
    echo "WARN: signed .app missing at $APP_BUNDLE — skipping OTA regen"
else
    echo ""
    echo "=== Regenerating OTA updater bundle ==="
    rm -f "$UPDATER_TARBALL" "$UPDATER_TARBALL.sig"
    # tar from the .app's parent dir so the archive contains
    # `Libre.app/...` and not the full absolute path. The Tauri
    # updater expects the archive to extract to a single .app at
    # the top level, which is what `Libre.app` here gives us.
    (cd "$(dirname "$APP_BUNDLE")" && tar czf "$UPDATER_TARBALL" "$(basename "$APP_BUNDLE")")
    echo "Tarball: $UPDATER_TARBALL ($(ls -lh "$UPDATER_TARBALL" | awk '{print $5}'))"

    # Sign the tarball with Tauri's updater key. The matching public
    # key is committed to tauri.conf.json's `plugins.updater.pubkey`,
    # so the installed updater verifies this signature against that
    # fixed pubkey at update-apply time. Run from the project root so
    # npx finds the local @tauri-apps/cli.
    PROJECT_ROOT="$(dirname "$TAURI_DIR")"
    (cd "$PROJECT_ROOT" && \
        npx --yes @tauri-apps/cli signer sign \
            --private-key "$(cat "$UPDATER_KEY")" \
            --password "${TAURI_SIGNING_KEY_PASSWORD:-}" \
            "$UPDATER_TARBALL" >/dev/null 2>&1)

    if [ -f "$UPDATER_TARBALL.sig" ]; then
        echo "Signature: $UPDATER_TARBALL.sig"
    else
        echo "WARN: OTA signature was not created — auto-update will fail"
        echo "      signature verification on the installed client side."
    fi
fi

echo ""
echo "=== Post-build complete ==="
echo ""
echo "To notarize:"
echo "  make notarize"
