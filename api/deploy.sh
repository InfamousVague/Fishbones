#!/usr/bin/env bash
# Deploy the Libre API to the VPS.
#
# Layout on the remote host:
#   /opt/libre-api/libre-api      — the binary
#   /var/lib/libre-api/                — sqlite db + state
#   /etc/libre-api/api.env             — env file (read by systemd)
#   /etc/libre-api/AuthKey_*.p8        — uploaded SIWA private key
#   /etc/libre-api/apple-domain-association.txt  — uploaded by hand
#                                            after Apple gives you the
#                                            verification file.
#   /etc/systemd/system/libre-api.service
#   /etc/caddy/Caddyfile                   — rewritten on every deploy
#
# This script is *destructive* to the Caddyfile: it writes a fresh
# one with all the hosts this VPS serves (libre.academy + www,
# api.libre.academy, mattssoftware.com + www, tap.mattssoftware.com).
# Any earlier product blocks from prior deploys are intentionally
# dropped — once this script runs, only the blocks emitted below
# exist.

set -euo pipefail

cd "$(dirname "$0")"

# Load .env
if [ ! -f .env ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in values."
  exit 1
fi
set -a; source .env; set +a

if [ -z "${VPS_HOST:-}" ]; then
  echo "Error: VPS_HOST not set in .env"
  exit 1
fi

# Prompt for password if not in .env
if [ -z "${VPS_PASSWORD:-}" ]; then
  read -sp "Root password for $VPS_HOST: " VPS_PASSWORD
  echo
fi

# Check for sshpass
if ! command -v sshpass &>/dev/null; then
  echo "Installing sshpass..."
  brew install sshpass 2>/dev/null || brew install esolitos/ipa/sshpass
fi

export SSHPASS="$VPS_PASSWORD"
# A deploy opens a dozen-plus SSH connections. That burst trips the VPS's
# fail2ban / connection rate limits and bans the deploy host MID-RUN
# (symptom: "Permission denied (publickey,password)" partway through, even
# though the password is correct) — and because the service is stopped
# before the build and only restarted at the very end, a mid-run ban
# leaves libre-api DOWN. Two mitigations, in order of importance:
#   1. ControlMaster — multiplex EVERY step (ssh/scp/rsync) over ONE
#      connection, so the whole deploy is a single authentication + single
#      TCP session. No burst → no ban. ControlPersist keeps it warm across
#      the run and it self-closes when idle. This is the real fix.
#   2. Password-only + one prompt — no publickey pre-attempts and no 3×
#      password retries, so each auth is a single clean "Accepted password"
#      line. Belt-and-suspenders against fail2ban.
CM_SOCK="/tmp/libre-deploy-cm-%C"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -o ControlMaster=auto -o ControlPath=$CM_SOCK -o ControlPersist=120"
SSH="sshpass -e ssh $SSH_OPTS -p $VPS_PORT $VPS_USER@$VPS_HOST"
SCP="sshpass -e scp $SSH_OPTS -P $VPS_PORT"
RSYNC_SSH="sshpass -e ssh $SSH_OPTS -p $VPS_PORT"

echo "── Deploying libre-api to $VPS_HOST..."

# Ensure remote dirs exist
$SSH "mkdir -p /opt/libre-api /etc/libre-api /var/lib/libre-api && chmod 700 /etc/libre-api"

# Upload source and build on VPS. We rebuild on the VPS rather than
# cross-compiling locally so the resulting binary links against the
# Linux glibc / sqlite tree it'll actually run under.
echo "── Uploading source to VPS..."
rsync -avz --delete \
  -e "$RSYNC_SSH" \
  --exclude target --exclude .git --exclude .env \
  ./ "$VPS_USER@$VPS_HOST:/opt/libre-api/src/"

echo "── Installing build dependencies..."
$SSH "apt-get update -qq && apt-get install -y -qq build-essential pkg-config libssl-dev"

echo "── Building on VPS (this may take a few minutes on first run)..."
$SSH "cd /opt/libre-api/src && \
  command -v cargo >/dev/null 2>&1 || { curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; } && \
  . \"\$HOME/.cargo/env\" && \
  cargo build --release && \
  systemctl stop libre-api 2>/dev/null; \
  cp target/release/libre-api /opt/libre-api/libre-api"

# ── Apple SIWA: upload .p8 ────────────────────────────────────────
#
# The .p8 only ever needs to be uploaded once per VPS. Subsequent
# deploys can re-use whatever's already at /etc/libre-api/. The
# local file is often archived (or moved off the laptop entirely
# once it's in 1Password / a secrets vault), so a missing local
# file is a normal state — not an error. We skip the upload and
# fall back to whichever AuthKey_*.p8 the VPS already has,
# detected via a remote `ls`. If the VPS has nothing AND the local
# is missing, that's a real misconfiguration; bail.
APPLE_REMOTE_KEY_PATH=""
if [ -n "${APPLE_PRIVATE_KEY_LOCAL:-}" ] && [ -f "$APPLE_PRIVATE_KEY_LOCAL" ]; then
  KEY_BASENAME="$(basename "$APPLE_PRIVATE_KEY_LOCAL")"
  APPLE_REMOTE_KEY_PATH="/etc/libre-api/$KEY_BASENAME"
  echo "── Uploading Apple .p8 → $APPLE_REMOTE_KEY_PATH"
  $SCP "$APPLE_PRIVATE_KEY_LOCAL" "$VPS_USER@$VPS_HOST:$APPLE_REMOTE_KEY_PATH"
  $SSH "chmod 600 $APPLE_REMOTE_KEY_PATH"
else
  # Local file is missing / unset. Look for any AuthKey_*.p8 already
  # uploaded on the VPS. If found, point the env file at it and skip
  # the upload step. If none exists, only fail if the user actually
  # wants Apple SIWA (APPLE_CLIENT_ID set).
  REMOTE_KEY="$($SSH 'ls /etc/libre-api/AuthKey_*.p8 2>/dev/null | head -1' || true)"
  if [ -n "$REMOTE_KEY" ]; then
    APPLE_REMOTE_KEY_PATH="$REMOTE_KEY"
    if [ -n "${APPLE_PRIVATE_KEY_LOCAL:-}" ]; then
      echo "── Skipping Apple .p8 upload (local file missing); reusing $REMOTE_KEY"
    else
      echo "── Reusing Apple .p8 already on VPS: $REMOTE_KEY"
    fi
  elif [ -n "${APPLE_CLIENT_ID:-}" ]; then
    echo "Error: APPLE_CLIENT_ID is set but no AuthKey_*.p8 is on the VPS"
    echo "       and APPLE_PRIVATE_KEY_LOCAL=${APPLE_PRIVATE_KEY_LOCAL:-<unset>} doesn't"
    echo "       exist locally. Restore the .p8 file or unset APPLE_CLIENT_ID to deploy"
    echo "       without Apple sign-in."
    exit 1
  fi
fi

# ── Env file (systemd EnvironmentFile=) ───────────────────────────
# Permissions 600 so the Apple Service ID + Google secret aren't
# world-readable.
echo "── Writing /etc/libre-api/api.env..."
cat <<EOF | $SSH "cat > /etc/libre-api/api.env && chmod 600 /etc/libre-api/api.env"
# Generated by deploy.sh — do not edit by hand. Re-run \`./deploy.sh\`
# from your laptop to update.
PUBLIC_URL=${PUBLIC_URL:-}
DATABASE_PATH=/var/lib/libre-api/api.sqlite
HOST=127.0.0.1
PORT=${API_PORT:-9443}
WEB_BASE_URL=${WEB_BASE_URL:-https://libre.academy}

APPLE_CLIENT_ID=${APPLE_CLIENT_ID:-}
APPLE_TEAM_ID=${APPLE_TEAM_ID:-}
APPLE_KEY_ID=${APPLE_KEY_ID:-}
APPLE_PRIVATE_KEY_FILE=${APPLE_REMOTE_KEY_PATH}
APPLE_DOMAIN_ASSOCIATION_FILE=/etc/libre-api/apple-domain-association.txt

GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}

# ── Mail backend ─────────────────────────────────────────────
# Two backends, tried in order: SMTP first, then Resend, then a
# tracing::warn fallback that prints the URL so it's recoverable
# from journalctl. Configure the one(s) you want; leave the rest
# blank to disable.
#
# SMTP (self-hosted Postfix on this VPS — see api/setup-mail.sh):
#   SMTP_HOST=localhost
#   SMTP_PORT=25
#   SMTP_STARTTLS=false
#   SMTP_FROM=noreply@libre.academy
#   SMTP_FROM_NAME=Libre
# SMTP (external relay like Mailgun / SES):
#   SMTP_HOST=smtp.mailgun.org SMTP_PORT=587 SMTP_STARTTLS=true
#   SMTP_USER=postmaster@... SMTP_PASS=...
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
SMTP_FROM=${SMTP_FROM:-}
SMTP_FROM_NAME=${SMTP_FROM_NAME:-}
SMTP_STARTTLS=${SMTP_STARTTLS:-true}

# Resend HTTP API — fallback / alternative to SMTP. Free tier
# covers 100 emails/day. See https://resend.com.
RESEND_API_KEY=${RESEND_API_KEY:-}
RESEND_FROM=${RESEND_FROM:-}
RESEND_FROM_NAME=${RESEND_FROM_NAME:-}

# ── Feedback → Notion ────────────────────────────────────────
# POST /feedback relays the in-app feedback modal to a Notion
# database. NOTION_TOKEN is a secret — set it in your local
# api/.env (this script sources it) so each deploy re-writes it
# here; setting it only on the VPS would be wiped next deploy. The
# database id is not a secret.
NOTION_TOKEN=${NOTION_TOKEN:-}
NOTION_DATABASE_ID=${NOTION_DATABASE_ID:-b19f429c29af4384b2dd8696a8a1404f}

# ── Early access → Notion ────────────────────────────────────
# POST /early-access files marketing-site email signups into a
# SEPARATE Notion database (a contact list, not feedback). Same
# NOTION_TOKEN as above; the id is not a secret. Unset -> the
# route returns 503.
NOTION_EARLY_ACCESS_DATABASE_ID=${NOTION_EARLY_ACCESS_DATABASE_ID:-c69deb5d1ea6421fa3aa3327ff0eaa05}
EOF

# ── systemd unit ──────────────────────────────────────────────────
echo "── Installing systemd service..."
cat <<EOF | $SSH "cat > /etc/systemd/system/libre-api.service"
[Unit]
Description=Libre API
After=network.target

[Service]
Type=simple
ExecStart=/opt/libre-api/libre-api
WorkingDirectory=/opt/libre-api
EnvironmentFile=/etc/libre-api/api.env
Restart=always
RestartSec=5
Environment=RUST_LOG=libre_api=info

[Install]
WantedBy=multi-user.target
EOF

# ── Caddy ─────────────────────────────────────────────────────────
# Make sure Caddy is installed (a previous Tap deploy already did this
# but we re-check so a fresh VPS still works).
echo "── Setting up Caddy (reverse proxy + auto TLS)..."
$SSH "command -v caddy >/dev/null 2>&1 || {
  apt-get update -qq && apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
}"

# Write a fresh Caddyfile.
#
# IMPORTANT: this Caddyfile must include EVERY host this VPS serves,
# not just the API. Caddy is a single-process router; any host
# omitted here goes dark on the next reload. We list these hosts:
#
#   - libre.academy + www.libre.academy   — Libre marketing + /learn
#                                           embed + /courses archives
#   - api.libre.academy                   — Libre relay backend
#   - mattssoftware.com + www.mattssoftware.com
#                                         — Matt's Software portfolio
#                                           (Libre tile links OUT to
#                                           libre.academy; no embed)
#   - tap.mattssoftware.com               — Tap relay (separate
#                                           product, same VPS)
#   - stats.mattssoftware.com + stats.libre.academy
#                                         — self-hosted Plausible
#                                           analytics (Docker, :8000)
#
# Static-site hosts use `try_files` for SPA fallback so client-side
# routes (`/reset-password`, `/oauth/done`, `/courses/:id`, …) hit
# index.html and let the React Router resolve them — without that,
# Caddy returns 404 and the SPA never gets a chance to mount.
# Course-archive downloads (`/courses/<slug>.academy`) are handled
# before the SPA fallback so a missing archive 404s cleanly instead
# of returning the marketing-site HTML.
cat <<EOF | $SSH "cat > /etc/caddy/Caddyfile"
# Generated by api/deploy.sh — do not edit by hand. Re-run
# ./deploy.sh from your laptop to update.

# Global server options: disable HTTP/2 across every site on this
# VPS so the API host's WebSocket endpoint works on every client.
# Background: WebSockets are an HTTP/1.1 protocol (RFC 6455). When
# Caddy advertises h2 in ALPN, the iOS WKWebView happily negotiates
# h2 for wss://api.libre.academy/sync/ws, sends a GET
# with Upgrade headers, and Caddy strips those headers before
# forwarding (RFC 7540 forbids Upgrade in HTTP/2). The backend
# (axum) only knows how to do RFC 6455 upgrades, sees a plain GET,
# and 400s. Disabling h2 forces clients onto h1.1 (where WS works
# natively) or h3 (where Caddy's QUIC stack handles WS internally).
# The static-content sites lose a small amount of asset-multiplex
# perf, but they all advertise Alt-Svc: h3 so capable clients
# upgrade past h1.1 anyway.
{
    servers {
        protocols h1 h3
    }
}

# Libre marketing + /learn embed + /courses archives. SPA fallback
# so client-side routes serve index.html and the React Router
# handles them. The single try_files line below also handles the
# course-archive downloads at /courses/<slug>.academy — those are
# real files on disk so try_files serves them directly instead of
# falling through to index.html. CORS headers are scoped to the
# /audio/* and /courses/*.academy paths via named matchers.
libre.academy, www.libre.academy {
    root * /var/www/libre-academy
    encode zstd gzip

    # CORS for /audio/* (lesson narration manifests + MP3s) and
    # /courses/*.academy (course archive downloads). The Libre
    # desktop + iOS Tauri shells fetch these cross-origin — the
    # WebView's effective origin is \`tauri://localhost\` on iOS/
    # Mac and \`http://tauri.localhost\` on Windows, neither of
    # which is libre.academy. Without CORS the fetches fail
    # preflight, useLessonAudio returns null and Discover-page
    # installs error out. Wildcard origin is safe — these are
    # public-read assets; CORS is purely about whether the JS
    # layer can SEE the response, not authentication.
    @audio path /audio/*
    header @audio Access-Control-Allow-Origin "*"
    header @audio Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    header @audio Access-Control-Allow-Headers "*"
    header @audio Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
    header @audio Access-Control-Max-Age "86400"

    # ONLY match \`.academy\` archive files — NOT every path under
    # /courses/*. The marketing site's React Router has a /courses
    # listing page and individual /courses/<slug> detail routes,
    # and Vite's dynamic-import chunks computed relative to those
    # pages resolve to URLs like /courses/assets/chunk-foo.js. A
    # broad \`path /courses/*\` matcher (used in the first cut of
    # this Caddyfile) intercepted those JS-module requests and
    # short-circuited the SPA fallback, breaking the page with
    # "Importing a module script failed". Scoping the matcher to
    # the .academy extension lets the rest fall through to the
    # try_files block below where SPA routing works correctly.
    @courseArchive path_regexp courseArchive ^/courses/[^/]+\.academy$
    header @courseArchive Access-Control-Allow-Origin "*"
    header @courseArchive Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    header @courseArchive Access-Control-Allow-Headers "*"
    header @courseArchive Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
    header @courseArchive Access-Control-Max-Age "86400"

    # CORS for /starter-courses/* (manifest.json, <id>.json,
    # <id>.jpg). The desktop Tauri shell fetches the catalog
    # manifest + per-course JSON + cover JPEGs cross-origin from
    # the WebView's \`tauri://localhost\` origin, just like the
    # audio CDN. Without CORS the manifest fetch returns
    # transparently but the JS layer can't see the body, so
    # Discover renders empty.
    @starterCourses path /starter-courses/*
    header @starterCourses Access-Control-Allow-Origin "*"
    header @starterCourses Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    header @starterCourses Access-Control-Allow-Headers "*"
    header @starterCourses Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
    header @starterCourses Access-Control-Max-Age "86400"

    # SPA + prerendered pages. scripts/prerender.mjs (in the
    # Web/libre.academy repo) emits a flat <route>.html for every
    # public route so crawlers that don't run JS see real content.
    # Probe order: real files (assets/, audio/, courses/<slug>.academy)
    # first, then the prerendered <route>.html, then a directory
    # index, then /index.html for any route without a prerender. React
    # boots on top of whichever HTML is served.
    try_files {path} {path}.html {path}/index.html /index.html
    file_server
}

# Matt's Software marketing site. Vite SPA mirrored from the
# InfamousVague/mattssoftware repo via its deploy workflow (rsync
# to /var/www/mattssoftware on every push to main). The Libre tile
# on the home page links OUT to https://libre.academy — there is
# no longer an embedded /fishbones/learn build at this host, so
# the special-cased handler for that path has been removed.
mattssoftware.com, www.mattssoftware.com {
    root * /var/www/mattssoftware
    encode zstd gzip
    try_files {path} /index.html
    file_server
}

# Drop-in vhosts owned by OTHER products on this VPS (currently the
# Tap relay's tap.caddy, written by Apps/tap/deploy.sh). Each product
# deploys its own conf.d file so neither deploy script can clobber
# the other's sites — the 2026-06 TLS outage was tap's deploy
# overwriting this whole file with just its own block.
import /etc/caddy/conf.d/*.caddy

# Libre API. Protocols are inherited from the global servers
# block above (h1 + h3, no h2) so the WS handshake works.
${API_DOMAIN:-api.libre.academy} {
    reverse_proxy 127.0.0.1:${API_PORT:-9443}
}

# Plausible analytics (self-hosted Community Edition, Docker on
# 127.0.0.1:8000). Both hostnames proxy the SAME instance; the
# dashboard BASE_URL is stats.libre.academy, while mattssoftware.com
# just loads the tracking script + posts events. This block is
# load-bearing: it was once absent from this heredoc, so a deploy
# silently dropped it and both subdomains went dark with a TLS
# "internal error" (no site = no cert). Keep it here.
stats.mattssoftware.com, stats.libre.academy {
    reverse_proxy 127.0.0.1:8000
}
EOF

# ── Start / restart ───────────────────────────────────────────────
echo "── Starting services..."
# conf.d must exist before Caddy parses the import line above (a
# matching-nothing glob is fine, a missing parent dir is not on
# older Caddy builds — and tap's deploy expects the dir anyway).
$SSH "mkdir -p /etc/caddy/conf.d && \
  systemctl daemon-reload && \
  systemctl enable --now caddy && \
  systemctl restart caddy && \
  systemctl enable --now libre-api && \
  systemctl restart libre-api"

# Health check. The service binds to 127.0.0.1 so the curl-from-VPS
# check is the right one — no TLS in the loopback hop.
echo "── Checking API health..."
sleep 2
$SSH "curl -sf http://127.0.0.1:${API_PORT:-9443}/health" \
  && echo " ✓ Libre API is running" \
  || echo " ✗ Libre API not responding yet (check logs: journalctl -u libre-api)"

echo ""
echo "── Deploy complete!"
echo "   Libre site: https://libre.academy"
echo "   Libre API:  https://${API_DOMAIN:-api.libre.academy}"
echo "   Tap:        https://${TAP_DOMAIN:-tap.mattssoftware.com}"
echo "   Logs:       ssh $VPS_USER@$VPS_HOST journalctl -u libre-api -f"
echo ""
echo "── DNS reminder"
echo "   Make sure api.libre.academy has an A/AAAA record pointing"
echo "   at this VPS (\$VPS_HOST). Caddy auto-provisions TLS on the"
echo "   first hit. Course archives served from /var/www/libre-"
echo "   academy/courses/ — drop your .academy files there."

echo ""
echo "── Apple domain-verification reminder"
echo "   Once you save the SIWA Service ID config, Apple gives you a"
echo "   small text file. Upload it like:"
echo ""
echo "     scp ~/Downloads/apple-developer-domain-association.txt \\"
echo "         $VPS_USER@$VPS_HOST:/etc/libre-api/apple-domain-association.txt"
echo ""
echo "   Then click Verify in the Apple Developer portal."
