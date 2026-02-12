#!/usr/bin/env bash
set -euo pipefail

# Clawdbot log cleanup
# - Removes old daily gateway logs under /tmp/clawdbot
# - Rotates + gzips large launchd stdout/stderr logs under ~/.clawdbot/logs

DAYS_TMP=${DAYS_TMP:-14}
DAYS_ROTATED=${DAYS_ROTATED:-30}
MAX_BYTES=${MAX_BYTES:-200000000}  # 200MB

TMP_DIR="/tmp/clawdbot"
LOG_DIR="$HOME/.clawdbot/logs"
ROT_DIR="$LOG_DIR/rotated"

mkdir -p "$ROT_DIR"

stamp() { date +%Y%m%d-%H%M%S; }

rotate_if_big() {
  local f="$1"
  [[ -f "$f" ]] || return 0

  # macOS: stat -f%z gives size in bytes
  local sz
  sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
  if [[ "$sz" -ge "$MAX_BYTES" ]]; then
    local base
    base=$(basename "$f")
    local out="$ROT_DIR/${base}.$(stamp)"
    cp -p "$f" "$out"
    # truncate original (keep file for launchd)
    : > "$f"
    gzip -f "$out"
  fi
}

# 1) Remove old daily gateway logs
if [[ -d "$TMP_DIR" ]]; then
  # Only remove files that match the daily pattern.
  find "$TMP_DIR" -type f -name 'clawdbot-*.log' -mtime "+$DAYS_TMP" -print -delete || true
fi

# 2) Rotate large launchd logs
rotate_if_big "$LOG_DIR/gateway.log"
rotate_if_big "$LOG_DIR/gateway.err.log"

# 3) Prune rotated logs
find "$ROT_DIR" -type f -name 'gateway*.gz' -mtime "+$DAYS_ROTATED" -print -delete || true

exit 0
