#!/usr/bin/env bash
set -euo pipefail

TARGET_PORT="${1:-}"

if [[ "$TARGET_PORT" != "5002" && "$TARGET_PORT" != "5003" ]]; then
  echo "usage: $0 5002|5003" >&2
  exit 1
fi

mkdir -p "$HOME/.pm2"
export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
PM2_BIN="$(command -v pm2 2>/dev/null || ls -1 "$HOME/.nvm/versions/node/"*/bin/pm2 2>/dev/null | tail -n 1 || echo pm2)"

if [[ "$TARGET_PORT" == "5002" ]]; then
  "$PM2_BIN" restart office-api-a --update-env >/dev/null 2>&1 || true
else
  "$PM2_BIN" restart office-api-b --update-env >/dev/null 2>&1 || true
fi
echo "active_upstream=${TARGET_PORT}"