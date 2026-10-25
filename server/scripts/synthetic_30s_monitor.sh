#!/usr/bin/env bash
set -u

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOG_FILE="$APP_ROOT/logs/synthetic_30s.log"
STATE_FILE="$APP_ROOT/logs/synthetic_state.txt"
LOCK_DIR="$APP_ROOT/logs/synthetic_monitor.lock"
ENV_FILE="$APP_ROOT/.monitor.env"
mkdir -p "$APP_ROOT/logs"

[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

WEB_BASE="${MONITOR_BASE_URL:-https://office.speednetkhulna.com}"
UPLOAD_PATH="${MONITOR_UPLOAD_PATH:-/uploads/health-check.txt}"
AUTH_URL="${MONITOR_AUTH_URL:-}"
AUTH_BEARER="${MONITOR_AUTH_BEARER:-}"
WEBHOOK_URL="${MONITOR_WEBHOOK_URL:-}"

check_url() {
  local url="$1"
  local code
  code="$(curl -k -s -m 8 -o /dev/null -w '%{http_code}' "$url" || echo 000)"
  [[ "$code" == "200" ]]
}

ok=1
check_url "$WEB_BASE/api/health/live" || ok=0
check_url "$WEB_BASE/api/health/ready" || ok=0
check_url "$WEB_BASE$UPLOAD_PATH" || ok=0

if [[ -n "$AUTH_URL" && -n "$AUTH_BEARER" ]]; then
  auth_code="$(curl -k -s -m 8 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AUTH_BEARER" "$AUTH_URL" || echo 000)"
  [[ "$auth_code" == "200" ]] || ok=0
fi

fails=0
[[ -f "$STATE_FILE" ]] && fails="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
if [[ "$ok" -eq 1 ]]; then
  fails=0
  echo "$(date -Iseconds) status=ok" >> "$LOG_FILE"
else
  fails="$((fails+1))"
  echo "$(date -Iseconds) status=fail consecutive=$fails" >> "$LOG_FILE"
fi
echo "$fails" > "$STATE_FILE"

if [[ "$fails" -ge 2 && -n "$WEBHOOK_URL" ]]; then
  payload="{\"text\":\"office monitor alert: consecutive failures=$fails at $(date -Iseconds)\"}"
  curl -k -s -m 8 -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
fi
