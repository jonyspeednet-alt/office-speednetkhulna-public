#!/usr/bin/env bash
set -u

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OFFICE_DOMAIN_ROOT="${OFFICE_DOMAIN_ROOT:-$APP_ROOT/client/dist}"
LOG_FILE="$APP_ROOT/logs/health_watchdog.log"
ECO_FILE="$APP_ROOT/ecosystem.config.js"
ENV_FILE="$APP_ROOT/.monitor.env"
SWITCH_SCRIPT="$APP_ROOT/server/scripts/switch_api_upstream.sh"
ALERT_STATE_FILE="$APP_ROOT/logs/watchdog_alert_state.txt"
STATE_FILE="$APP_ROOT/logs/health_watchdog_state.env"
LOCK_DIR="$APP_ROOT/logs/health_watchdog.lock"
WATCHDOG_FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-2}"
PM2_PING_FAIL_THRESHOLD="${PM2_PING_FAIL_THRESHOLD:-2}"

mkdir -p "$APP_ROOT/logs"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
WATCHDOG_FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-2}"
PM2_PING_FAIL_THRESHOLD="${PM2_PING_FAIL_THRESHOLD:-2}"

WEBHOOK_URL="${MONITOR_WEBHOOK_URL:-}"
export HOME="${HOME:-/srv}"
export PM2_HOME="${PM2_HOME:-/srv/.pm2}"
export PATH="/srv/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Stale-lock guard: a crash between mkdir and trap-rmdir leaves the dir
  # behind and would silence the watchdog forever. Reclaim after 5 min.
  if [[ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +5 2>/dev/null)" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

PM2_BIN="$(command -v pm2 || true)"
if [[ -z "$PM2_BIN" ]]; then
  PM2_BIN="$(ls -1 /srv/.nvm/versions/node/*/bin/pm2 2>/dev/null | tail -n 1)"
fi
if [[ -z "$PM2_BIN" ]]; then
  echo "$(date -Iseconds) pm2 binary not found in cron environment" >> "$LOG_FILE"
  exit 1
fi

active_fail_streak=0
standby_fail_streak=0
pm2_ping_fail_streak=0
if [[ -f "$STATE_FILE" ]]; then
  # Validated parse only — never source: a writer with log access could
  # inject $() command substitution = RCE as the cron user next tick.
  while IFS='=' read -r k v; do
    case "$k" in
      active_fail_streak|standby_fail_streak|pm2_ping_fail_streak)
        [[ "$v" =~ ^[0-9]+$ ]] && printf -v "$k" '%s' "$v" ;;
    esac
  done < "$STATE_FILE"
fi

persist_state() {
  cat > "$STATE_FILE" <<EOF
active_fail_streak=$active_fail_streak
standby_fail_streak=$standby_fail_streak
pm2_ping_fail_streak=$pm2_ping_fail_streak
EOF
}

send_alert() {
  local text="$1"
  [[ -z "$WEBHOOK_URL" ]] && return 0
  local now
  now="$(date +%s)"
  local last=0
  [[ -f "$ALERT_STATE_FILE" ]] && last="$(cat "$ALERT_STATE_FILE" 2>/dev/null | tr -cd '0-9')"
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if [[ "$((now-last))" -lt 120 ]]; then
    return 0
  fi
  echo "$now" > "$ALERT_STATE_FILE"
  local payload
  payload="{\"text\":\"office watchdog: $text @ $(date -Iseconds)\"}"
  curl -k -s -m 8 -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
}

ensure_pm2_apps() {
  local changed=0
  local have_a=0
  local have_b=0
  local have_w=0
  "$PM2_BIN" describe office-api-a >/dev/null 2>&1 && have_a=1
  "$PM2_BIN" describe office-api-b >/dev/null 2>&1 && have_b=1
  "$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1 && have_w=1
  local count=$((have_a + have_b))
  if [[ "$count" -lt 2 ]]; then
    "$PM2_BIN" start "$ECO_FILE" --only office-api-a,office-api-b --update-env >/dev/null 2>&1 || true
    changed=1
    echo "$(date -Iseconds) pm2 app list repaired (count=$count)" >> "$LOG_FILE"
    send_alert "pm2 app list repaired (count=$count)"
    sleep 2
  fi
  # Sender worker must stay registered: a missing worker here once got
  # cemented into dump.pm2 by the save below (2026-10-05 stale outage).
  if [[ "$have_w" -eq 0 ]]; then
    "$PM2_BIN" start "$ECO_FILE" --only whatsapp-worker --update-env >/dev/null 2>&1 || true
    changed=1
    echo "$(date -Iseconds) whatsapp-worker missing -> recreated from ecosystem.config.js" >> "$LOG_FILE"
    send_alert "whatsapp-worker missing -> recreated"
    sleep 3
  fi
  if [[ "$changed" -eq 1 ]]; then
    "$PM2_BIN" save >/dev/null 2>&1 || true
  fi
}

check_port() {
  local p="$1"
  local code
  code="$(curl -s -m 6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$p/api/health/ready" || echo 000)"
  [[ "$code" == "200" ]]
}

# whatsapp-worker exposes /health (not /api/health/ready) on :4010.
check_worker() {
  curl -fsS -m 6 http://127.0.0.1:4010/health >/dev/null 2>&1
}

if ! "$PM2_BIN" ping >/dev/null 2>&1; then
  pm2_ping_fail_streak=$((pm2_ping_fail_streak + 1))
  echo "$(date -Iseconds) pm2 ping failed streak=$pm2_ping_fail_streak" >> "$LOG_FILE"
  if [[ "$pm2_ping_fail_streak" -ge "$PM2_PING_FAIL_THRESHOLD" ]]; then
    "$PM2_BIN" resurrect >/dev/null 2>&1 || true
    sleep 3
    "$PM2_BIN" ping >/dev/null 2>&1 || "$PM2_BIN" start "$ECO_FILE" --only office-api-a,office-api-b --update-env >/dev/null 2>&1 || true
    # resurrect from a stale dump may lack the worker — re-add explicitly.
    "$PM2_BIN" describe whatsapp-worker >/dev/null 2>&1 \
      || "$PM2_BIN" start "$ECO_FILE" --only whatsapp-worker --update-env >/dev/null 2>&1 || true
    "$PM2_BIN" save >/dev/null 2>&1 || true
    echo "$(date -Iseconds) pm2 daemon recovered after ping failures" >> "$LOG_FILE"
    pm2_ping_fail_streak=0
  fi
  persist_state
  exit 0
fi
pm2_ping_fail_streak=0

ensure_pm2_apps

active_port="5002"
standby_port="5003"
[[ "$active_port" == "5003" ]] && standby_port="5002"

active_ok=0
standby_ok=0
check_port "$active_port" && active_ok=1
check_port "$standby_port" && standby_ok=1

if [[ "$active_ok" -eq 0 ]]; then
  active_fail_streak=$((active_fail_streak + 1))
else
  active_fail_streak=0
fi
if [[ "$standby_ok" -eq 0 ]]; then
  standby_fail_streak=$((standby_fail_streak + 1))
else
  standby_fail_streak=0
fi

if [[ "$active_fail_streak" -ge "$WATCHDOG_FAIL_THRESHOLD" ]]; then
  if [[ "$active_port" == "5002" ]]; then
    "$PM2_BIN" restart office-api-a --update-env >/dev/null 2>&1 || true
  else
    "$PM2_BIN" restart office-api-b --update-env >/dev/null 2>&1 || true
  fi
fi

if [[ "$standby_fail_streak" -ge "$WATCHDOG_FAIL_THRESHOLD" ]]; then
  if [[ "$standby_port" == "5002" ]]; then
    "$PM2_BIN" restart office-api-a --update-env >/dev/null 2>&1 || true
  else
    "$PM2_BIN" restart office-api-b --update-env >/dev/null 2>&1 || true
  fi
fi

sleep 2
check_port "$active_port" && active_ok=1 || active_ok=0
check_port "$standby_port" && standby_ok=1 || standby_ok=0

if [[ "$active_ok" -eq 0 && "$standby_ok" -eq 1 && "$active_fail_streak" -ge "$WATCHDOG_FAIL_THRESHOLD" ]]; then
  "$SWITCH_SCRIPT" "$standby_port" >/dev/null 2>&1
  echo "$(date -Iseconds) switch upstream $active_port -> $standby_port" >> "$LOG_FILE"
  active_fail_streak=0
elif [[ "$active_ok" -eq 0 && "$standby_ok" -eq 0 && "$active_fail_streak" -ge "$WATCHDOG_FAIL_THRESHOLD" && "$standby_fail_streak" -ge "$WATCHDOG_FAIL_THRESHOLD" ]]; then
  "$PM2_BIN" restart office-api-a --update-env >/dev/null 2>&1 || true
  "$PM2_BIN" restart office-api-b --update-env >/dev/null 2>&1 || true
  echo "$(date -Iseconds) both backends unhealthy -> restarted both" >> "$LOG_FILE"
  send_alert "both backends unhealthy -> restarted both"
  active_fail_streak=0
  standby_fail_streak=0
fi

# Sender worker healer (runs every tick, ~1min): process alive but 10s state
# pushes stopped => restart via ecosystem (correct PORT=4010). Stale sender
# cards on /support?tab=sms clear within ~30s of recovery.
if ! check_worker; then
  "$PM2_BIN" reload "$ECO_FILE" --only whatsapp-worker --update-env >/dev/null 2>&1 \
    || "$PM2_BIN" start "$ECO_FILE" --only whatsapp-worker --update-env >/dev/null 2>&1 || true
  sleep 5
  if check_worker; then
    echo "$(date -Iseconds) whatsapp-worker unhealthy -> restarted" >> "$LOG_FILE"
    send_alert "whatsapp-worker unhealthy -> restarted"
    "$PM2_BIN" save >/dev/null 2>&1 || true
  else
    echo "$(date -Iseconds) whatsapp-worker still unhealthy after restart" >> "$LOG_FILE"
  fi
fi

persist_state
