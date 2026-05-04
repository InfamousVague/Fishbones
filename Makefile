# Fishbones — Build, Sign, Notarize, Install
# Usage:
#   make              — full pipeline: build → sign → notarize → install
#   make build        — tauri release build
#   make sign         — post-build signing only (no rebuild)
#   make notarize     — notarize + staple the DMG
#   make install      — install notarized app to /Applications
#   make release      — bump patch, commit, tag, push (no build)
#   make local-release — bump + build + sign + notarize + upload DMG
#   make deploy       — local-release + push fishbones.academy (site + /learn)
#   make deploy-site  — push fishbones.academy only (skip the DMG rebuild)
#   make dev          — run in dev mode
#   make clean        — remove build artifacts

SHELL := /bin/bash
ROOT  := $(shell pwd)
TAURI := $(ROOT)/src-tauri

# Load credentials from .env.apple (gitignored)
-include $(ROOT)/.env.apple

export APPLE_SIGNING_IDENTITY

IDENTITY      := $(APPLE_SIGNING_IDENTITY)
APPLE_ID      ?= InfamousVagueRat@gmail.com
TEAM_ID       := $(APPLE_TEAM_ID)
TEAM_ID       ?= F6ZAL7ANAD
VERSION       := $(shell grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
ARCH          := $(shell uname -m)
ifeq ($(ARCH),arm64)
  ARCH_TAG := aarch64
else ifeq ($(ARCH),x86_64)
  ARCH_TAG := x64
else
  ARCH_TAG := $(ARCH)
endif
APP_BUNDLE    := $(TAURI)/target/release/bundle/macos/Fishbones.app
DMG           := $(TAURI)/target/release/bundle/dmg/Fishbones_$(VERSION)_$(ARCH_TAG).dmg
INSTALL_PATH  := /Applications/Fishbones.app

.PHONY: all build sign notarize staple install dev release local-release \
        deploy deploy-site clean help \
        run run-split run-phone run-watch pick-phone pick-watch run-clean

# Marketing site checkout (separate repo). The site's `npm run deploy`
# rebuilds Fishbones with FISHBONES_BASE=/learn/, stages dist-web/ under
# its own public/learn/, builds the Vite site, and rsyncs the result to
# /var/www/fishbones-academy on the VPS. Override if your laptop has the
# academy repo somewhere else.
ACADEMY_ROOT ?= $(ROOT)/../../Web/fishbones-academy

# --- iOS / watchOS run config ---------------------------------------------
WATCH_ROOT      := /Users/matt/Development/Apps/FishbonesWatch
DEVICE_CACHE    := $(ROOT)/.fishbones-devices.cache
PHONE_BUNDLE_ID := com.mattssoftware.kata
WATCH_BUNDLE_ID := com.mattssoftware.fishbones.watchkitapp
# CocoaPods needs UTF-8 locale or it bails on unicode in podspecs.
TAURI_ENV       := LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

## Default: full pipeline
all: build sign notarize install
	@echo ""
	@echo "✓ Done — Fishbones.app installed and notarized"

## Build Tauri release.
##
## TAURI_SIGNING_* env vars trigger the updater plugin to also produce
## `Fishbones.app.tar.gz` + `.sig` alongside the regular .dmg. These
## are what the OTA updater downloads — without them, installed
## clients can't auto-update. Default key path is the maintainer's
## ~/.tauri/fishbones-updater.key; override TAURI_SIGNING_KEY_PATH if
## you've stored the key elsewhere.
build:
	@echo "=== Building Tauri release ==="
	@if [ ! -f "$(TAURI_SIGNING_KEY_PATH)" ]; then \
		echo "WARN: signing key not found at $(TAURI_SIGNING_KEY_PATH);"; \
		echo "      OTA update artifacts won't be signed. Generate via:"; \
		echo "      npx @tauri-apps/cli signer generate -w $(TAURI_SIGNING_KEY_PATH)"; \
	fi
	cd $(ROOT) && \
		TAURI_SIGNING_PRIVATE_KEY="$$(cat $(TAURI_SIGNING_KEY_PATH) 2>/dev/null)" \
		TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(TAURI_SIGNING_KEY_PASSWORD)" \
		npm run tauri build -- --bundles app,dmg

## Tauri OTA-update signing key. Generated once via
## `npx @tauri-apps/cli signer generate -w ~/.tauri/fishbones-updater.key`;
## the public half of this same keypair is committed to
## `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Losing the
## private key requires shipping a manual-install version with a
## NEW pubkey to rotate the trust root — keep it backed up.
TAURI_SIGNING_KEY_PATH      ?= $(HOME)/.tauri/fishbones-updater.key
TAURI_SIGNING_KEY_PASSWORD  ?=

## Post-build: sign everything with hardened runtime + rebuild DMG
sign:
	@echo "=== Signing ==="
	cd $(TAURI) && bash scripts/post-build.sh

## Notarize the DMG with Apple
notarize:
	@echo "=== Notarizing ==="
	@if [ -z "$(APPLE_PASSWORD)" ]; then \
		echo "ERROR: APPLE_PASSWORD not set. Check .env.apple"; exit 1; \
	fi
	xcrun notarytool submit "$(DMG)" \
		--apple-id "$(APPLE_ID)" \
		--team-id "$(TEAM_ID)" \
		--password "$(APPLE_PASSWORD)" \
		--wait
	@echo "=== Stapling ==="
	xcrun stapler staple "$(DMG)"

## Staple notarization ticket to DMG (standalone)
staple:
	@echo "=== Stapling ==="
	xcrun stapler staple "$(DMG)"

## Install notarized app from DMG to /Applications
install: staple
	@echo "=== Installing ==="
	hdiutil attach "$(DMG)" -quiet -nobrowse -mountpoint /tmp/fishbones-dmg
	rm -rf "$(INSTALL_PATH)"
	ditto /tmp/fishbones-dmg/Fishbones.app "$(INSTALL_PATH)"
	hdiutil detach /tmp/fishbones-dmg -quiet
	@echo "Installed: $(INSTALL_PATH)"
	@spctl --assess --type execute --verbose "$(INSTALL_PATH)" 2>&1

## Dev mode
dev:
	cd $(ROOT) && npm run tauri dev

## Bump version, commit, tag, push (no build)
BUMP ?= patch

release:
	@CURRENT=$(VERSION); \
	IFS='.' read -r MAJOR MINOR PATCH <<< "$$CURRENT"; \
	if [ "$(BUMP)" = "major" ]; then \
		MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0; \
	elif [ "$(BUMP)" = "minor" ]; then \
		MINOR=$$((MINOR + 1)); PATCH=0; \
	else \
		PATCH=$$((PATCH + 1)); \
	fi; \
	NEW="$$MAJOR.$$MINOR.$$PATCH"; \
	echo "=== Bumping $$CURRENT → $$NEW ==="; \
	sed -i '' "s/\"version\": \"$$CURRENT\"/\"version\": \"$$NEW\"/" src-tauri/tauri.conf.json; \
	sed -i '' "s/^version = \"$$CURRENT\"/version = \"$$NEW\"/" src-tauri/Cargo.toml; \
	git add src-tauri/tauri.conf.json src-tauri/Cargo.toml; \
	git commit -m "Fishbones v$$NEW"; \
	git tag -a "v$$NEW" -m "Fishbones v$$NEW"; \
	git push origin HEAD; \
	git push origin "v$$NEW"; \
	echo ""; \
	echo "✓ v$$NEW tagged and pushed"

## Local release: build + sign + notarize + upload current version to GitHub
## (Use `make release` first if you want to bump the version.) Skips the
## /Applications install step — release publishing shouldn't require
## the user be willing to replace their local copy.
##
## After this finishes, `.github/workflows/desktop-build.yml` is also
## triggered by the same tag push (or already running). It builds Linux
## (.AppImage + .deb) and Windows (.msi + .exe) and APPENDS them to the
## same release within ~25 minutes. macOS is intentionally skipped in CI
## — the signed/notarized DMG can only be produced here, where the
## Apple Developer ID cert lives.
##
## So a complete release flow looks like:
##   make release        → bump + tag + push (triggers CI Linux+Win)
##   make local-release  → build + sign + notarize + publish DMG
##   …wait ~25 min…       CI uploads Linux + Windows assets
##   visit https://github.com/InfamousVague/Fishbones/releases/latest
local-release: build sign notarize
	@DMG_CURRENT="$(TAURI)/target/release/bundle/dmg/Fishbones_$(VERSION)_$(ARCH_TAG).dmg"; \
	UPDATER_TARBALL="$(TAURI)/target/release/bundle/macos/Fishbones.app.tar.gz"; \
	UPDATER_SIG="$$UPDATER_TARBALL.sig"; \
	if [ ! -f "$$DMG_CURRENT" ]; then \
		echo "ERROR: DMG not found at $$DMG_CURRENT"; exit 1; \
	fi; \
	if git rev-parse "v$(VERSION)" >/dev/null 2>&1; then \
		echo "Tag v$(VERSION) already exists — skipping tag creation"; \
	else \
		git tag -a "v$(VERSION)" -m "Fishbones v$(VERSION)"; \
		git push origin "v$(VERSION)"; \
	fi; \
	gh release view "v$(VERSION)" >/dev/null 2>&1 && { \
		echo "Release v$(VERSION) exists — uploading DMG as asset"; \
		gh release upload "v$(VERSION)" "$$DMG_CURRENT" --clobber; \
	} || { \
		gh release create "v$(VERSION)" \
			"$$DMG_CURRENT" \
			--title "Fishbones v$(VERSION)" \
			--notes "Signed and notarized macOS release." \
			--latest; \
	}; \
	if [ -f "$$UPDATER_TARBALL" ] && [ -f "$$UPDATER_SIG" ]; then \
		echo "Uploading OTA updater artefacts (Mac):"; \
		cp "$$UPDATER_TARBALL" "/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz"; \
		cp "$$UPDATER_SIG" "/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz.sig"; \
		gh release upload "v$(VERSION)" \
			"/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz" \
			"/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz.sig" \
			--clobber; \
		rm -f "/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz" "/tmp/Fishbones_$(VERSION)_aarch64.app.tar.gz.sig"; \
	else \
		echo "WARN: OTA updater tarball missing at $$UPDATER_TARBALL"; \
		echo "      Either TAURI_SIGNING_PRIVATE_KEY isn't set or the build"; \
		echo "      didn't produce updater artefacts. Mac users will not be"; \
		echo "      able to OTA-update from this version."; \
	fi; \
	echo ""; \
	echo "✓ v$(VERSION) released and uploaded"
	@$(MAKE) --no-print-directory update-manifest

## Build + upload `latest.json` (the Tauri OTA updater manifest) for
## the current version. Walks the release's assets, pairs each
## updater bundle with its `.sig` file, and emits the manifest shape
## the updater plugin expects. Idempotent — re-running just clobbers
## the existing latest.json.
##
## Usually invoked automatically as the final step of `local-release`.
## Run by hand when you've manually fixed up a release's assets.
update-manifest:
	@echo ""
	@echo "=== Assembling latest.json for v$(VERSION) ==="
	@node $(ROOT)/scripts/build-updater-manifest.mjs "v$(VERSION)" || { \
		echo "WARN: latest.json build failed (probably some platform's"; \
		echo "      .sig is missing). Re-run after CI finishes uploading."; \
		exit 0; \
	}

## Full ship: cut a GitHub release for the current version, then push
## fishbones.academy (site copy + /learn/ embed). The download buttons on
## the site fetch GitHub Releases at runtime, so step 1 is what
## "updates the download link" — step 2 just makes sure the embedded
## /learn/ build and any marketing copy you changed go live.
##
## Idempotent: `local-release` clobbers an existing release asset for the
## same version (so re-running after a hot-fix just replaces the DMG),
## and the site rsync uses --delete so stale assets get pruned.
##
## Skip the DMG step entirely with `make deploy-site` (e.g. when you only
## edited /learn/ source or marketing copy and there's nothing new to
## sign).
deploy: local-release deploy-site
	@echo ""
	@echo "✓ Fishbones v$(VERSION) shipped end-to-end."
	@echo "  Release: https://github.com/InfamousVague/Fishbones/releases/tag/v$(VERSION)"
	@echo "  Site:    https://fishbones.academy/"
	@echo "  Learn:   https://fishbones.academy/learn/"

## Site-only deploy: rebuild Fishbones for /learn/, build the academy
## site, rsync to VPS. Use after editing marketing copy or when the
## current version's release on GitHub is already up-to-date.
##
## The academy's deploy.mjs reads VPS_PASSWORD from this repo's
## api/.env automatically, so there's no extra credential setup.
deploy-site:
	@echo "=== Deploying fishbones.academy (site + /learn/ embed) ==="
	@if [ ! -d "$(ACADEMY_ROOT)" ]; then \
		echo "ERROR: academy site not found at $(ACADEMY_ROOT)"; \
		echo "       Set ACADEMY_ROOT=/path/to/fishbones-academy and re-run,"; \
		echo "       or clone the academy repo there."; \
		exit 1; \
	fi
	@if [ ! -f "$(ROOT)/api/.env" ]; then \
		echo "WARN: api/.env missing — academy deploy.mjs will prompt you for"; \
		echo "      VPS_SSH_PASSWORD. Set it in env or in api/.env to avoid the"; \
		echo "      prompt next time."; \
	fi
	cd "$(ACADEMY_ROOT)" && FISHBONES_SRC="$(ROOT)" npm run deploy

## Remove build artifacts
clean:
	rm -rf $(TAURI)/target/release/bundle
	@echo "Cleaned"

# --- iOS phone + watch device runner ---------------------------------------
# `make run`         — pick iPhone + Watch, build/install/launch both
# `make run-phone`   — phone only
# `make run-watch`   — watch only
# `make pick-phone`  / `make pick-watch` — refresh selection without building
# `make run-clean`   — drop the cached selection
#
# Picks are cached in .fishbones-devices.cache (gitignored). The first run on
# a fresh checkout always prompts; subsequent runs prompt "Use last? (Y/n)".

pick-phone:
	@bash $(ROOT)/scripts/pick-device.sh phone --reuse

pick-watch:
	@bash $(ROOT)/scripts/pick-device.sh watch --reuse

run-clean:
	@rm -f $(DEVICE_CACHE) && echo "Cleared $(DEVICE_CACHE)"

# When `make run` invokes us via sub-make, it already picked both devices —
# avoid prompting "Use last?" again. The standalone case has FB_SKIP_PICK
# unset, so the picker still runs.
run-phone: $(if $(FB_SKIP_PICK),,pick-phone)
	@set -eu; \
	. $(DEVICE_CACHE); \
	echo ""; \
	echo "=== Phone: $$IPHONE_NAME ($$IPHONE_KIND/$$IPHONE_UDID) ==="; \
	if [ "$$IPHONE_KIND" = "sim" ]; then \
		echo "--- tauri ios build (sim) ---"; \
		cd $(ROOT) && $(TAURI_ENV) tauri ios build --target aarch64-sim --debug; \
		APP="$(TAURI)/gen/apple/build/arm64-sim/Fishbones.app"; \
		echo "--- boot + install + launch ---"; \
		xcrun simctl boot "$$IPHONE_UDID" 2>/dev/null || true; \
		open -a Simulator; \
		xcrun simctl install "$$IPHONE_UDID" "$$APP"; \
		xcrun simctl launch "$$IPHONE_UDID" $(PHONE_BUNDLE_ID); \
	else \
		echo "--- tauri ios build (device) ---"; \
		cd $(ROOT) && $(TAURI_ENV) tauri ios build --target aarch64 --debug; \
		APP=""; \
		for cand in \
			"$(TAURI)/gen/apple/build/arm64/Fishbones.app" \
			"$(TAURI)/gen/apple/build/fishbones_iOS.xcarchive/Products/Applications/Fishbones.app"; do \
			if [ -d "$$cand" ]; then APP="$$cand"; echo "Found .app: $$cand"; break; fi; \
		done; \
		if [ -z "$$APP" ]; then \
			IPA="$(TAURI)/gen/apple/build/arm64/Fishbones.ipa"; \
			if [ -f "$$IPA" ]; then \
				echo "--- no .app found; extracting from $$IPA ---"; \
				EXTRACT_DIR="$(TAURI)/gen/apple/build/arm64/_ipa-extract"; \
				rm -rf "$$EXTRACT_DIR"; mkdir -p "$$EXTRACT_DIR"; \
				unzip -q -o "$$IPA" -d "$$EXTRACT_DIR"; \
				APP=$$(ls -d "$$EXTRACT_DIR"/Payload/*.app 2>/dev/null | head -1); \
				[ -d "$$APP" ] && echo "Extracted .app: $$APP"; \
			fi; \
		fi; \
		if [ -z "$$APP" ] || [ ! -d "$$APP" ]; then \
			echo "ERROR: no Fishbones.app or .ipa produced under $(TAURI)/gen/apple/build/."; \
			echo "Build likely failed — scroll up for tauri/xcodebuild errors,"; \
			echo "or try 'tauri ios dev --target $$IPHONE_UDID' for a guided run."; \
			exit 1; \
		fi; \
		echo "--- devicectl install + launch ---"; \
		xcrun devicectl device install app --device "$$IPHONE_UDID" "$$APP"; \
		xcrun devicectl device process launch --device "$$IPHONE_UDID" --terminate-existing $(PHONE_BUNDLE_ID); \
	fi; \
	echo "✓ Phone launched."

run-watch: $(if $(FB_SKIP_PICK),,pick-watch)
	@set -eu; \
	. $(DEVICE_CACHE); \
	echo ""; \
	echo "=== Watch: $$WATCH_NAME ($$WATCH_KIND/$$WATCH_UDID) ==="; \
	cd $(WATCH_ROOT); \
	if [ "$$WATCH_KIND" = "sim" ]; then \
		echo "--- xcodebuild (watchOS sim) ---"; \
		xcodebuild -project FishbonesWatch.xcodeproj -scheme FishbonesWatch \
			-destination "platform=watchOS Simulator,id=$$WATCH_UDID" \
			-configuration Debug -derivedDataPath build/DerivedData \
			build CODE_SIGNING_ALLOWED=NO | tail -40; \
		APP="$(WATCH_ROOT)/build/DerivedData/Build/Products/Debug-watchsimulator/FishbonesWatch.app"; \
		echo "--- boot + install + launch ---"; \
		xcrun simctl boot "$$WATCH_UDID" 2>/dev/null || true; \
		open -a Simulator; \
		xcrun simctl install "$$WATCH_UDID" "$$APP"; \
		xcrun simctl launch "$$WATCH_UDID" $(WATCH_BUNDLE_ID); \
	else \
		echo "--- xcodebuild (watchOS device, signed) ---"; \
		xcodebuild -project FishbonesWatch.xcodeproj -scheme FishbonesWatch \
			-destination "platform=watchOS,id=$$WATCH_UDID" \
			-configuration Debug -derivedDataPath build/DerivedData \
			build | tail -40; \
		APP="$(WATCH_ROOT)/build/DerivedData/Build/Products/Debug-watchos/FishbonesWatch.app"; \
		if [ ! -d "$$APP" ]; then \
			echo "ERROR: $$APP not found. Check signing settings (DEVELOPMENT_TEAM=F6ZAL7ANAD)."; \
			exit 1; \
		fi; \
		echo "--- devicectl install + launch ---"; \
		xcrun devicectl device install app --device "$$WATCH_UDID" "$$APP"; \
		xcrun devicectl device process launch --device "$$WATCH_UDID" --terminate-existing $(WATCH_BUNDLE_ID); \
	fi; \
	echo "✓ Watch launched."

# `run` chains both pickers up-front (so all prompts happen before any build),
# then delegates to the per-target recipes with FB_SKIP_PICK=1 so they don't
# re-prompt for the same selection.
run:
	@bash $(ROOT)/scripts/pick-device.sh phone --reuse
	@bash $(ROOT)/scripts/pick-device.sh watch --reuse
	@$(MAKE) --no-print-directory FB_SKIP_PICK=1 run-phone
	@$(MAKE) --no-print-directory FB_SKIP_PICK=1 run-watch

# `run-split` picks both devices in this window, then spawns each build into
# its own Terminal/iTerm window so phone + watch logs stream side-by-side.
# Set FB_TERM=iterm or FB_TERM=terminal to override auto-detection.
run-split:
	@bash $(ROOT)/scripts/pick-device.sh phone --reuse
	@bash $(ROOT)/scripts/pick-device.sh watch --reuse
	@bash $(ROOT)/scripts/run-split.sh

help:
	@echo "Build / release targets:"
	@echo "  make              — full pipeline: build → sign → notarize → install"
	@echo "  make build        — Tauri release build"
	@echo "  make sign         — post-build signing (no rebuild)"
	@echo "  make notarize     — notarize + staple DMG"
	@echo "  make install      — install to /Applications"
	@echo "  make release      — bump patch ($(VERSION) → next), tag, push (no build)"
	@echo "  make local-release — full local build + sign + notarize + upload to GitHub"
	@echo ""
	@echo "Web deploy targets (fishbones.academy):"
	@echo "  make deploy       — local-release + rsync site + /learn/ to VPS"
	@echo "  make deploy-site  — site only (skip the DMG rebuild)"
	@echo ""
	@echo "iOS / watchOS run targets (interactive device picker):"
	@echo "  make run          — pick + run phone AND watch (sequential, this window)"
	@echo "  make run-split    — pick + run phone AND watch in two new terminal windows"
	@echo "  make run-phone    — pick + run phone only"
	@echo "  make run-watch    — pick + run watch only"
	@echo "  make pick-phone   — refresh phone selection only"
	@echo "  make pick-watch   — refresh watch selection only"
	@echo "  make run-clean    — drop the cached device selection"
