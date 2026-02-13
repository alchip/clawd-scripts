#!/usr/bin/env bash
set -euo pipefail

# clawdbot-restore-latest.sh
# Restores from:
#   $HOME/Backups/clawdbot/latest
# back to:
#   /Users/sunny/clawd
#   $HOME/.clawdbot
#
# ⚠️ This OVERWRITES current data (rsync --delete). Use with care.

SRC_BASE="$HOME/Backups/clawdbot/latest"
SRC_CLAWD="$SRC_BASE/clawd"
SRC_CLAWDBOT="$SRC_BASE/.clawdbot"

DEST_CLAWD="/Users/sunny/clawd"
DEST_CLAWDBOT="$HOME/.clawdbot"

stamp() { /bin/date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[restore $(stamp)] $*"; }

die() { echo "ERROR: $*" >&2; exit 2; }

[[ -d "$SRC_CLAWD" ]] || die "Missing backup: $SRC_CLAWD"
[[ -d "$SRC_CLAWDBOT" ]] || die "Missing backup: $SRC_CLAWDBOT"

log "Stopping gateway (ignore errors if not running)…"
clawdbot gateway stop || true

# macOS ships an older rsync (2.6.x) which doesn't support --info=...
RSYNC_COMMON=(
  -a
  --delete
  --human-readable
  --stats
)

log "Restoring A: $SRC_CLAWD/ → $DEST_CLAWD/"
mkdir -p "$DEST_CLAWD"
rsync "${RSYNC_COMMON[@]}" "$SRC_CLAWD/" "$DEST_CLAWD/"

log "Restoring B: $SRC_CLAWDBOT/ → $DEST_CLAWDBOT/"
mkdir -p "$DEST_CLAWDBOT"
rsync "${RSYNC_COMMON[@]}" "$SRC_CLAWDBOT/" "$DEST_CLAWDBOT/"

log "Starting gateway…"
clawdbot gateway start

log "Done. You can verify with: clawdbot status"
