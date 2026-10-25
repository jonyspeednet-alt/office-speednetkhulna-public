#!/usr/bin/env bash
# Pull-model auto-deploy: fetch main from GitHub, build, and rolling-reload PM2.
# Triggered by server/webhook/deployWebhook.js on push to main.
# Safe to run manually:  bash server/scripts/deploy_from_github.sh [sha]
set -euo pipefail

# Self-copy guard: this script rsyncs a NEWER version of itself into place
# mid-run. Bash reads the file incrementally, so it would continue executing
# shifted lines from the new file (once killed a deploy + poisoned PM2 env).
# Re-exec from a private temp copy exactly once.
if [ "${DEPLOY_SAFE_COPY:-}" != "1" ]; then
    SAFE_COPY="$(mktemp /tmp/deploy_from_github.XXXXXX.sh)"
    cp "$0" "$SAFE_COPY"
    chmod +x "$SAFE_COPY"
    DEPLOY_SAFE_COPY=1 exec bash "$SAFE_COPY" "$@"
fi

REPO="${DEPLOY_REPO:-/srv/office_repo}"
APP="${APP_ROOT:-/srv/office_app}"
ENV_FILE="$APP/secrets/.env.production"
LOG_DIR="$APP/logs"
LOCK_DIR="$APP/logs/github_deploy.lock"
BACKUP_BASE="$APP/.deploy_backups"
WANT_SHA="${1:-${GITHUB_SHA:-}}"

export HOME="/srv"
export PM2_HOME="${PM2_HOME:-/srv/.pm2}"
NODE_BIN_DIR="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -n1 || true)"
[ -n "$NODE_BIN_DIR" ] || NODE_BIN_DIR="/usr/local/bin"
export PATH="$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin"
# NEVER leak our own env into PM2 apps: this script may inherit PORT (or other
# app-specific vars) from the webhook listener. Unset them AND avoid
# `pm2` below (ecosystem.config.js already carries correct env).
# A poisoned PORT once moved whatsapp-worker onto 4567 (EADDRINUSE loop).
unset PORT

TS="$(date +%Y%m%d_%H%M%S)"
LOG="$LOG_DIR/github_deploy_${TS}.log"
mkdir -p "$LOG_DIR" "$BACKUP_BASE"

# Serialize: exit quietly if another deploy (PC or webhook) is running.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$(date -Iseconds) another deploy in progress, exiting" | tee -a "$LOG"
    exit 0
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true; [ "${DEPLOY_SAFE_COPY:-}" = "1" ] && rm -f "$0" || true' EXIT

exec > >(tee -a "$LOG") 2>&1
echo "=== github auto-deploy $TS (want: ${WANT_SHA:-latest}) ==="

PM2_BIN="$(command -v pm2 2>/dev/null || ls -1 "$HOME"/.nvm/versions/node/*/bin/pm2 2>/dev/null | tail -n 1 || echo pm2)"

health_ok() { curl -fsS -m 10 "http://127.0.0.1:$1/api/health/ready" >/dev/null 2>&1; }

# --- 0. safety gates (same as PC deploy) ---
[ -f "$ENV_FILE" ] || { echo "ERR: missing $ENV_FILE"; exit 1; }
req_key() { grep -qE "^$1=" "$ENV_FILE" || { echo "ERR: no $1 in env"; exit 1; }; }
req_key JWT_SECRET
req_key SESSION_SECRET
req_key FRONTEND_URL

# --- 1. fetch + fast-forward check ---
PREV_SHA="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" fetch --prune origin
NEW_SHA="$(git -C "$REPO" rev-parse origin/main)"
if [ -n "$WANT_SHA" ] && [ "$WANT_SHA" != "$NEW_SHA" ]; then
    echo "ERR: requested revision is not the current validated main revision"
    exit 1
fi
if [ "$PREV_SHA" = "$NEW_SHA" ]; then
    echo "no changes ($NEW_SHA), nothing to do"
    exit 0
fi
echo "deploying $PREV_SHA -> $NEW_SHA"
git -C "$REPO" reset --hard origin/main
git -C "$REPO" clean -fd -e node_modules -e dist || true

# --- 2. syntax check (same as CI) ---
echo "--- syntax check ---"
find "$REPO/server" -path '*/node_modules' -prune -o -type f -name '*.js' -print0 | xargs -0 -n1 node --check
node --check "$REPO/server/webhook/deployWebhook.js"
node --check "$REPO/ecosystem.config.js"
echo "syntax OK"

# --- 3. backup live code ---
BK="$BACKUP_BASE/$TS-$PREV_SHA"
mkdir -p "$BK"
cp -a "$APP/server" "$BK/server" 2>/dev/null || true
cp -a "$APP/ecosystem.config.js" "$BK/" 2>/dev/null || true
cp -a "$APP/client/dist" "$BK/dist" 2>/dev/null || true
cp -a "$APP/client-partner/dist" "$BK/partner-dist" 2>/dev/null || true
cp -a "$APP/whatsapp-worker" "$BK/whatsapp-worker" 2>/dev/null || true
echo "backup: $BK"

rollback() {
    echo "!!! ROLLBACK to $PREV_SHA !!!"
    rm -rf "$APP/server" && cp -a "$BK/server" "$APP/server"
    cp -a "$BK/ecosystem.config.js" "$APP/ecosystem.config.js" 2>/dev/null || true
    rm -rf "$APP/client/dist" && cp -a "$BK/dist" "$APP/client/dist"
    if [ -d "$BK/partner-dist" ]; then rm -rf "$APP/client-partner/dist" && cp -a "$BK/partner-dist" "$APP/client-partner/dist"; fi
    rm -rf "$APP/whatsapp-worker" && cp -a "$BK/whatsapp-worker" "$APP/whatsapp-worker"
    "$PM2_BIN" reload "$APP/ecosystem.config.js" --only office-api-a,office-api-b --env production >/dev/null 2>&1 || true
    # Best-effort: keep the sender worker registered after a rollback too.
    "$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1 \
        || "$PM2_BIN" start "$APP/ecosystem.config.js" --only whatsapp-worker --env production >/dev/null 2>&1 || true
    echo "rollback done"
}

# --- 4. sync backend + worker (excludes live-only files) ---
echo "--- sync backend ---"
rsync -a --delete --exclude 'node_modules' --exclude '.env' "$REPO/server/" "$APP/server/"
rsync -a --exclude 'node_modules' --exclude '.env' --exclude '.wwebjs_auth' --exclude '.wwebjs_cache' "$REPO/whatsapp-worker/" "$APP/whatsapp-worker/"
cp -a "$REPO/ecosystem.config.js" "$APP/ecosystem.config.js"
find "$APP/server" -type d -exec chmod u+rwx {} \; && find "$APP/server" -type f -exec chmod u+rw {} \;
chmod 700 "$APP/secrets" 2>/dev/null || true
chmod 600 "$ENV_FILE"

# --- 5. npm install (backend + worker) ---
echo "--- npm install ---"
(
    cd "$APP/server" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund
)
(
    cd "$APP/whatsapp-worker" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund
)

# --- 6. build frontend on server, atomic swap ---
# NOTE: listener runs with NODE_ENV=production (inherited), which makes plain
# `npm ci` skip devDependencies (vite lives there). Unset it for the install
# (keep it for `npm run build` — vite wants production mode for minification).
echo "--- frontend build ---"
(
    cd "$REPO/client" && env -u NODE_ENV npm ci --no-audit --no-fund && VITE_RELEASE_SHA="$NEW_SHA" npm run build
) || { echo "ERR: frontend build failed"; rollback; exit 1; }
[ -f "$REPO/client/dist/index.html" ] || { echo "ERR: build produced no dist"; rollback; exit 1; }
STAGE="$APP/client/dist_new_$TS"
rm -rf "$STAGE" && cp -a "$REPO/client/dist" "$STAGE"
if [ -d "$APP/client/dist" ]; then mv "$APP/client/dist" "$APP/client/dist_prev_$TS"; fi
mv "$STAGE" "$APP/client/dist" || { echo "ERR: frontend swap failed"; rollback; exit 1; }
rm -rf "$APP/client/dist_prev_$TS"
echo "frontend swap ok"

(
    cd "$REPO/client-partner" && env -u NODE_ENV npm ci --no-audit --no-fund && VITE_RELEASE_SHA="$NEW_SHA" npm run build
) || { echo "ERR: partner frontend build failed"; rollback; exit 1; }
[ -f "$REPO/client-partner/dist/index.html" ] || { echo "ERR: partner build produced no dist"; rollback; exit 1; }
mkdir -p "$APP/client-partner"
PARTNER_STAGE="$APP/client-partner/dist_new_$TS"
rm -rf "$PARTNER_STAGE" && cp -a "$REPO/client-partner/dist" "$PARTNER_STAGE"
if [ -d "$APP/client-partner/dist" ]; then mv "$APP/client-partner/dist" "$APP/client-partner/dist_prev_$TS"; fi
mv "$PARTNER_STAGE" "$APP/client-partner/dist" || { echo "ERR: partner frontend swap failed"; rollback; exit 1; }
rm -rf "$APP/client-partner/dist_prev_$TS"
echo "partner frontend swap ok"
echo 'ok' > "$APP/uploads/health-check.txt" && chmod 664 "$APP/uploads/health-check.txt"

# --- 7. PM2 rolling reload with health gates ---
echo "--- pm2 rolling reload ---"
if "$PM2_BIN" pid office-api-a >/dev/null 2>&1 && "$PM2_BIN" pid office-api-b >/dev/null 2>&1; then
    "$PM2_BIN" reload "$APP/ecosystem.config.js" --only office-api-a --env production >/dev/null
    sleep 4
    health_ok 5002 || { echo "ERR: office-api-a unhealthy"; rollback; exit 1; }
    "$PM2_BIN" reload "$APP/ecosystem.config.js" --only office-api-b --env production >/dev/null
    sleep 4
    health_ok 5003 || { echo "ERR: office-api-b unhealthy"; rollback; exit 1; }
else
    "$PM2_BIN" start "$APP/ecosystem.config.js" --only office-api-a,office-api-b --env production >/dev/null
    sleep 6
fi
# --- whatsapp-worker: must survive every deploy (incident 2026-10-05:
# worker vanished from `pm2 list`, dump.pm2 saved without it, /support?tab=sms
# went `stale`). describe-guard (not pid): a crashed-but-registered worker and
# a deleted worker both converge to `start from ecosystem`. Reload (not
# restart) goes through the ecosystem file with --env production so the
# correct PORT=4010 always applies AND new fields (memory/log paths) take
# effect — bare `pm2 restart whatsapp-worker` once kept a poisoned PORT=4567,
# and config-file `restart` silently kept stale 256M/log paths (2026-10-05).
# Skip the reload when neither the worker nor the ecosystem changed: every
# reload bounces both sender browsers back to re-init (QR), so frontend-only
# deploys must NOT disturb linked numbers.
WORKER_CHANGED=""
if git -C "$REPO" diff --name-only "$PREV_SHA" "$NEW_SHA" -- whatsapp-worker/ ecosystem.config.js 2>/dev/null | grep -q .; then
    WORKER_CHANGED=1
fi
if [ -n "$WORKER_CHANGED" ]; then
    echo "whatsapp-worker or ecosystem changed -> reloading worker"
    if "$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1; then
        "$PM2_BIN" reload "$APP/ecosystem.config.js" --only whatsapp-worker --env production >/dev/null \
            || "$PM2_BIN" start "$APP/ecosystem.config.js" --only whatsapp-worker --env production >/dev/null \
            || true  # failures converge on the hard gate below (rollback), never set -e
    else
        echo "whatsapp-worker missing -> creating from ecosystem.config.js"
        "$PM2_BIN" start "$APP/ecosystem.config.js" --only whatsapp-worker --env production >/dev/null
    fi
else
    echo "whatsapp-worker unchanged -> keeping live sender sessions (no reload)"
    if ! "$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1; then
        echo "whatsapp-worker missing -> creating from ecosystem.config.js"
        "$PM2_BIN" start "$APP/ecosystem.config.js" --only whatsapp-worker --env production >/dev/null
    fi
fi
# Hard gate BEFORE `pm2 save`: a missing worker must abort + roll back, never
# be cemented into dump.pm2 by a silent save (that is what made the 2026-10-05
# outage survive reboots via `pm2 resurrect`).
"$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1 \
    || { echo "ERR: whatsapp-worker missing after ensure"; rollback; exit 1; }
# NOTE: github-webhook is deliberately NOT restarted here — recycling the very
# listener that spawned this deploy caused an EADDRINUSE crash loop on :4567.
# Its code changes rarely; restart it manually after such a change.
sleep 3
"$PM2_BIN" save >/dev/null || true

# --- 8. post gates ---
health_ok 5002 || { echo "ERR: post gate 5002"; rollback; exit 1; }
health_ok 5003 || { echo "ERR: post gate 5003"; rollback; exit 1; }
curl -fsS -m 10 http://127.0.0.1:8080/api/health/ready >/dev/null || { echo "ERR: post gate nginx"; rollback; exit 1; }
# Worker liveness (process alive, not WA login state — /health is OK even while
# a session waits for QR scan, so this never blocks on unscanned senders).
curl -fsS -m 10 http://127.0.0.1:4010/health >/dev/null \
    || echo "WARN: whatsapp-worker health gate failed (process/user check `pm2 describe whatsapp-worker`)"

# prune old backups (keep 5)
ls -dt "$BACKUP_BASE"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

echo "=== DONE: auto-deploy $NEW_SHA live ==="
