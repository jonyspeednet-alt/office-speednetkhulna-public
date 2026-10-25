#!/usr/bin/env bash
# office_pg_backup.sh — Daily PostgreSQL backup (local + encrypted Google Drive)
# Runs via cron. Reads DB creds from secrets/.env.production.
set -euo pipefail
umask 077

# ── Config ───────────────────────────────────────────────
APP_ROOT="/srv/office_app"
ENV_FILE="$APP_ROOT/secrets/.env.production"
BACKUP_DIR="$APP_ROOT/backups/db"
LOG_FILE="$APP_ROOT/backups/backup.log"
RCLONE_CONF="/srv/.config/rclone/rclone.conf"
RCLONE_REMOTE="mega-crypt:"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="$BACKUP_DIR/office_db_${TIMESTAMP}.dump"

# ── Helpers ──────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fail() { log "FATAL: $*"; exit 1; }

# Rotate the shared cron log (no logrotate on box): keep last 5000 lines
if [ -f "$APP_ROOT/backups/backup.log" ] && [ "$(wc -l < "$APP_ROOT/backups/backup.log" 2>/dev/null || echo 0)" -gt 5000 ]; then
  tail -n 2000 "$APP_ROOT/backups/backup.log" > "$APP_ROOT/backups/backup.log.tmp" 2>/dev/null \
    && mv "$APP_ROOT/backups/backup.log.tmp" "$APP_ROOT/backups/backup.log" 2>/dev/null || true
fi

# ── Ensure dirs ──────────────────────────────────────────
mkdir -p "$BACKUP_DIR" || fail "Cannot create $BACKUP_DIR"

# ── Load DB creds ────────────────────────────────────────
db_host=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
db_port=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
db_user=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
db_name=$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)
export PGPASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$db_host" ] || [ -z "$db_name" ] || [ -z "$db_user" ] || [ -z "$PGPASSWORD" ]; then
  fail "Missing DB creds in $ENV_FILE"
fi

log "=== PG_BACKUP START (db=$db_name user=$db_user host=$db_host:$db_port) ==="

# ── pg_dump (custom format, max compression) ──────────────
if pg_dump -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" \
    -Fc -Z9 -f "$DUMP_FILE" 2>&1; then
  chmod 600 "$DUMP_FILE"
  DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
  log "Local dump OK: $DUMP_FILE ($DUMP_SIZE)"
else
  rm -f "$DUMP_FILE"
  fail "pg_dump failed (exit=$?)"
fi

# ── Local retention ───────────────────────────────────────
deleted=$(find "$BACKUP_DIR" -name 'office_db_*.dump' -mtime +$RETENTION_DAYS -delete -print | wc -l)
log "Local cleanup: deleted $deleted dumps older than $RETENTION_DAYS days"

# ── Verify dump integrity (pg_restore --list) ─────────────
if pg_restore --list "$DUMP_FILE" >/dev/null 2>&1; then
  log "Dump integrity check: OK"
else
  log "WARNING: pg_restore --list failed for $DUMP_FILE"
fi

# ── Encrypt + upload to Google Drive ──────────────────────
if [ -f "$RCLONE_CONF" ]; then
  # rclone.conf holds Mega secrets — must not be world-readable
  if [ -n "$(find "$RCLONE_CONF" -maxdepth 0 -perm /077 2>/dev/null)" ]; then
    log "WARNING: $RCLONE_CONF is group/other-readable — run: chmod 600 $RCLONE_CONF"
  fi
  if rclone copy "$DUMP_FILE" "${RCLONE_REMOTE}" \
      --config "$RCLONE_CONF" \
      --no-traverse \
      --log-level INFO 2>&1 | tail -5; then
    log "Cloud upload OK: ${RCLONE_REMOTE}$(basename $DUMP_FILE)"
  else
    log "WARNING: rclone upload failed (exit=$?)"
  fi

  # Cloud retention: delete encrypted files OLDER than RETENTION_DAYS (--min-age = only files older than X)
  # Scoped to DB dumps only — root also holds files/ prefix (see files backup)
  rclone delete "${RCLONE_REMOTE}" \
    --include 'office_db_*.dump' \
    --min-age "${RETENTION_DAYS}d" \
    --config "$RCLONE_CONF" \
    --log-level INFO 2>&1 | tail -3 || \
    log "WARNING: cloud retention cleanup failed"
else
  log "WARNING: rclone.conf not found — cloud upload skipped"
fi

# ── DB size for logs ─────────────────────────────────────
DB_SIZE=$(psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" \
  -tAc "SELECT pg_size_pretty(pg_database_size('$db_name'));" 2>/dev/null || echo "?")
log "Current DB size: $DB_SIZE"

log "=== PG_BACKUP DONE ==="
unset PGPASSWORD
