#!/usr/bin/env bash
set -euo pipefail

# clawdbot-snapshot.sh
# Creates a point-in-time snapshot tarball (manual run) containing:
#   - /Users/sunny/clawd
#   - /Users/sunny/.clawdbot
# Output:
#   ~/Backups/clawdbot/snapshots/clawdbot-snapshot-YYYYmmdd-HHMMSS.tgz

SRC_CLAWD="/Users/sunny/clawd"
SRC_CLAWDBOT="$HOME/.clawdbot"

DEST_BASE="$HOME/Backups/clawdbot/snapshots"
mkdir -p "$DEST_BASE"

STAMP=$(date +"%Y%m%d-%H%M%S")
OUT="$DEST_BASE/clawdbot-snapshot-$STAMP.tgz"

# Optional excludes (set to 1 to exclude from the snapshot)
EXCLUDE_MODELS="${EXCLUDE_MODELS:-0}"
EXCLUDE_BROWSER_PROFILES="${EXCLUDE_BROWSER_PROFILES:-0}"
EXCLUDE_LOGS="${EXCLUDE_LOGS:-0}"

stamp() { /bin/date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[snapshot $(stamp)] $*"; }

# Build tar exclude list (paths are relative to /Users/sunny)
TAR_EXCLUDES=()
if [[ "$EXCLUDE_MODELS" == "1" ]]; then
  TAR_EXCLUDES+=(--exclude='.clawdbot/models')
fi
if [[ "$EXCLUDE_BROWSER_PROFILES" == "1" ]]; then
  TAR_EXCLUDES+=(--exclude='.clawdbot/browser' --exclude='.clawdbot/chrome-cdp-profile')
fi
if [[ "$EXCLUDE_LOGS" == "1" ]]; then
  TAR_EXCLUDES+=(--exclude='.clawdbot/logs')
fi

log "Creating snapshot: $OUT"
log "Including: $SRC_CLAWD and $SRC_CLAWDBOT"

# Store as absolute paths under /Users/sunny/... for easy restore with: sudo tar -xzf ... -C /
# We do this by tarring from / and providing the absolute paths.
# macOS tar supports -C; we'll use / as base.

TAR_ARGS=(/usr/bin/tar -czf "$OUT")
if (( ${#TAR_EXCLUDES[@]} )); then
  TAR_ARGS+=("${TAR_EXCLUDES[@]}")
fi
TAR_ARGS+=(-C / "Users/sunny/clawd" "Users/sunny/.clawdbot")

"${TAR_ARGS[@]}"

log "Snapshot done. File size: $(du -h "$OUT" | awk '{print $1}')"
log "To restore: clawdbot gateway stop; sudo tar -xzf '$OUT' -C /; clawdbot gateway start"
