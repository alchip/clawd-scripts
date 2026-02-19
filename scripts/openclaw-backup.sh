#!/usr/bin/env bash
set -euo pipefail

# clawdbot-backup.sh
# Rsync mirror backup of:
#   A) /Users/sunny/.openclaw/workspace
#   B) $HOME/.openclaw
# to:
#   $HOME/Backups/openclaw/latest
#
# Notes:
# - This mirrors (with --delete). Use snapshots for point-in-time archives.
# - You can exclude large rebuildable directories by setting env vars below.

SRC_CLAWD="/Users/sunny/.openclaw/workspace"
SRC_CLAWDBOT="$HOME/.openclaw"

DEST_BASE="$HOME/Backups/openclaw"
DEST_LATEST="$DEST_BASE/latest"

# Optional excludes (set to 1 to exclude)
EXCLUDE_MODELS="${EXCLUDE_MODELS:-0}"
EXCLUDE_BROWSER_PROFILES="${EXCLUDE_BROWSER_PROFILES:-0}"
EXCLUDE_LOGS="${EXCLUDE_LOGS:-0}"

mkdir -p "$DEST_LATEST"

stamp() { /bin/date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[backup $(stamp)] $*"; }

# macOS ships an older rsync (2.6.x) which doesn't support --info=...
RSYNC_COMMON=(
  -a
  --delete
  --human-readable
  --stats
)

EXCLUDES=()
if [[ "$EXCLUDE_MODELS" == "1" ]]; then
  EXCLUDES+=(--exclude 'models/')
fi
if [[ "$EXCLUDE_BROWSER_PROFILES" == "1" ]]; then
  EXCLUDES+=(--exclude 'browser/' --exclude 'chrome-cdp-profile/')
fi
if [[ "$EXCLUDE_LOGS" == "1" ]]; then
  EXCLUDES+=(--exclude 'logs/')
fi

log "Backing up A: $SRC_CLAWD → $DEST_LATEST/clawd/"
mkdir -p "$DEST_LATEST/clawd"
rsync "${RSYNC_COMMON[@]}" "$SRC_CLAWD/" "$DEST_LATEST/clawd/"

log "Backing up B: $SRC_CLAWDBOT → $DEST_LATEST/.openclaw/"
mkdir -p "$DEST_LATEST/.openclaw"
if (( ${#EXCLUDES[@]} )); then
  rsync "${RSYNC_COMMON[@]}" "${EXCLUDES[@]}" "$SRC_CLAWDBOT/" "$DEST_LATEST/.openclaw/"
else
  rsync "${RSYNC_COMMON[@]}" "$SRC_CLAWDBOT/" "$DEST_LATEST/.openclaw/"
fi

log "Done. Latest backup at: $DEST_LATEST"
