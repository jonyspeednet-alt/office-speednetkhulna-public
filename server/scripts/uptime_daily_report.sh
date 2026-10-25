#!/usr/bin/env bash
set -u

APP_ROOT="/srv/office_app"
LOG_DIR="$APP_ROOT/logs"
WATCHDOG_LOG="$LOG_DIR/health_watchdog.log"
SYN_LOG="$LOG_DIR/synthetic_30s.log"
PM2_LOG="/srv/.pm2/pm2.log"
ENV_FILE="$APP_ROOT/.monitor.env"
OUT_LOG="$LOG_DIR/uptime_daily_report.log"

mkdir -p "$LOG_DIR"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

WEBHOOK_URL="${MONITOR_WEBHOOK_URL:-}"
TARGET_DAY="$(TZ=Asia/Dhaka date '+%Y-%m-%d')"

count_lines() {
  local file="$1"
  local pattern="$2"
  if [[ ! -f "$file" ]]; then
    echo 0
    return 0
  fi
  awk -v p="$pattern" '$0 ~ p { c++ } END { print c+0 }' "$file" 2>/dev/null
}

wd_repaired="$(count_lines "$WATCHDOG_LOG" "$TARGET_DAY.*pm2 app list repaired")"
wd_both_down="$(count_lines "$WATCHDOG_LOG" "$TARGET_DAY.*both backends unhealthy")"
wd_switches="$(count_lines "$WATCHDOG_LOG" "$TARGET_DAY.*switch upstream")"
syn_fail="$(count_lines "$SYN_LOG" "$TARGET_DAY.*status=fail")"
syn_ok="$(count_lines "$SYN_LOG" "$TARGET_DAY.*status=ok")"
pm2_new_daemon="$(count_lines "$PM2_LOG" "$TARGET_DAY.*New PM2 Daemon started")"

current_health_code="$(curl -k -s -m 8 -o /dev/null -w '%{http_code}' https://office.speednetkhulna.com/api/health/ready || echo 000)"

summary="date=$TARGET_DAY health=$current_health_code repaired=$wd_repaired both_down=$wd_both_down switches=$wd_switches syn_fail=$syn_fail syn_ok=$syn_ok pm2_daemon_starts=$pm2_new_daemon"
echo "$(date -Iseconds) $summary" >> "$OUT_LOG"

if [[ -n "$WEBHOOK_URL" ]]; then
  payload="{\"text\":\"office daily uptime summary: $summary\"}"
  curl -k -s -m 8 -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
fi

echo "$summary"
