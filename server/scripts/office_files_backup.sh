#!/usr/bin/env bash
# office_files_backup.sh — Daily non-DB data backup (uploads + WhatsApp session + secrets)
# Runs via cron. Uploads an encrypted tar.gz to Mega (mega-crypt:).
set -euo pipefail
umask 077

# ── Config ───────────────────────────────────────────────
APP_ROOT="/srv/office_app"
BACKUP_DIR="$APP_ROOT/backups/files"
RCLONE_CONF="/srv/.config/rclone/rclone.conf"
RCLONE_REMOTE="mega-crypt:"
RCLONE_SUB="files/"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TAR_FILE="$BACKUP_DIR/office_files_${TIMESTAMP}.tar.gz"

# ── Helpers ──────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "FATAL: $*"; exit 1; }

# Rotate the shared cron log (no logrotate on box): keep last 5000 lines
if [ -f "$APP_ROOT/backups/backup.log" ] && [ "$(wc -l < "$APP_ROOT/backups/backup.log" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 2000 "$APP_ROOT/backups/backup.log" > "$APP_ROOT/backups/backup.log.tmp" 2>/dev/null \
    && mv "$APP_ROOT/backups/backup.log.tmp" "$APP_ROOT/backups/backup.log" 2>/dev/null || true
fi

mkdir -p "$BACKUP_DIR" || fail "Cannot create $BACKUP_DIR"

# ── Build include list (only paths that exist) ───────────
INCLUDES=()
add_if_exists() {
  if [ -e "$1" ]; then INCLUDES+=("${1#$APP_ROOT/}"); fi
}

add_if_exists "$APP_ROOT/uploads"
add_if_exists "$APP_ROOT/whatsapp-worker/.wwebjs_auth"
add_if_exists "$APP_ROOT/whatsapp-worker/.wwebjs_cache"
add_if_exists "$APP_ROOT/server/reports"
add_if_exists "$APP_ROOT/secrets/.env.production"
add_if_exists "$APP_ROOT/secrets/mikrotik_support_devices.enc.json"

if [ "${#INCLUDES[@]}" -eq 0 ]; then
  fail "No backup-worthy paths found under $APP_ROOT"
fi

log "=== FILES_BACKUP START (items: ${INCLUDES[*]}) ==="

# ── Tar.gz (relative to APP_ROOT) ────────────────────────
if (cd "$APP_ROOT" && tar czf "$TAR_FILE" "${INCLUDES[@]}" 2>&1); then
  chmod 600 "$TAR_FILE"
  TAR_SIZE=$(du -sh "$TAR_FILE" | cut -f1)
  log "Local tar OK: $TAR_FILE ($TAR_SIZE)"
else
  rm -f "$TAR_FILE"
  fail "tar failed (exit=$?)"
fi

# ── Local retention ───────────────────────────────────────
deleted=$(find "$BACKUP_DIR" -name 'office_files_*.tar.gz' -mtime +$RETENTION_DAYS -delete -print | wc -l)
log "Local cleanup: deleted $deleted tars older than $RETENTION_DAYS days"

# ── Encrypt + upload to Mega ──────────────────────────────
if [ -f "$RCLONE_CONF" ]; then
  # rclone.conf holds Mega secrets — must not be world-readable
  if [ -n "$(find "$RCLONE_CONF" -maxdepth 0 -perm /077 2>/dev/null)" ]; then
    log "WARNING: $RCLONE_CONF is group/other-readable — run: chmod 600 $RCLONE_CONF"
  fi
  if ! rclone copy "$TAR_FILE" "${RCLONE_REMOTE}${RCLONE_SUB}" \
      --config "$RCLONE_CONF" \
      --no-traverse \
      --log-level INFO 2>&1 | tail -5; then
    log "WARNING: rclone upload failed (exit=$?)"
    exit 1
  fi
  log "Cloud upload OK: ${RCLONE_REMOTE}${RCLONE_SUB}$(basename $TAR_FILE)"

  # Cloud retention (only files older than RETENTION_DAYS in files/ subdir)
  rclone delete "${RCLONE_REMOTE}${RCLONE_SUB}" \
    --min-age "${RETENTION_DAYS}d" \
    --config "$RCLONE_CONF" \
    --log-level INFO 2>&1 | tail -3 || \
    log "WARNING: cloud retention cleanup failed"
else
  log "WARNING: rclone.conf not found — cloud upload skipped"
fi

log "=== FILES_BACKUP DONE ==="