#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/whatsapp-worker}"
APP_PORT="${APP_PORT:-4010}"
NODE_BIN="${NODE_BIN:-$HOME/.local/bin/node}"
LOG_FILE="${LOG_FILE:-$APP_DIR/worker.log}"
PID_FILE="${PID_FILE:-$APP_DIR/worker.pid}"
SERVER_FILE="$APP_DIR/server.js"

mkdir -p "$APP_DIR"

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[worker-start] Node.js binary not found."
  exit 1
fi

if [ ! -f "$SERVER_FILE" ]; then
  echo "[worker-start] server.js not found at $SERVER_FILE"
  exit 1
fi

LISTENER_PID="$(ss -ltnp 2>/dev/null | grep ":$APP_PORT " | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -n1 || true)"
if [ -n "$LISTENER_PID" ]; then
  CMDLINE="$(tr '\0' ' ' < "/proc/$LISTENER_PID/cmdline" 2>/dev/null || true)"
  if echo "$CMDLINE" | grep -q "$SERVER_FILE"; then
    echo "[worker-start] Worker already running on port $APP_PORT (pid=$LISTENER_PID)"
    exit 0
  fi
fi

nohup "$NODE_BIN" "$SERVER_FILE" >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
sleep 6

if curl -fsS --max-time 8 "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then
  echo "[worker-start] Worker started successfully (pid=$NEW_PID)"
  exit 0
fi

echo "[worker-start] Worker failed health check after start."
exit 1
