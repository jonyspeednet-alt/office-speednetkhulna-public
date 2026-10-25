#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/whatsapp-worker}"
APP_PORT="${APP_PORT:-4010}"
LOG_FILE="${LOG_FILE:-$APP_DIR/watchdog.log}"
SERVER_FILE="$APP_DIR/server.js"
START_SCRIPT="$APP_DIR/start-worker.sh"

mkdir -p "$APP_DIR"
touch "$LOG_FILE"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$1" >> "$LOG_FILE"
}

healthy() {
  curl -fsS --max-time 8 "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1
}

if healthy; then
  exit 0
fi

log "[watchdog] Health check failed. Attempting recovery."

pkill -f "$SERVER_FILE" >/dev/null 2>&1 || true
pkill -f "$APP_DIR/.wwebjs_auth/session-office_leave_approvals" >/dev/null 2>&1 || true
sleep 3

if "$START_SCRIPT" >> "$LOG_FILE" 2>&1; then
  log "[watchdog] Worker restart completed."
  exit 0
fi

log "[watchdog] Worker restart failed."
exit 1
