#!/usr/bin/env bash
set -euo pipefail

# clawdbot-restore-latest.sh
# Restores from:
#   $HOME/Backups/openclaw/latest
# back to:
#   /Users/sunny/.openclaw/workspace
#   $HOME/.openclaw
#
# ⚠️ This OVERWRITES current data (rsync --delete). Use with care.

SRC_BASE="$HOME/Backups/openclaw/latest"
SRC_CLAWD="$SRC_BASE/clawd"
SRC_CLAWDBOT="$SRC_BASE/.openclaw"

DEST_CLAWD="/Users/sunny/.openclaw/workspace"
DEST_CLAWDBOT="$HOME/.openclaw"

stamp() { /bin/date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[restore $(stamp)] $*"; }

die() { echo "ERROR: $*" >&2; exit 2; }

[[ -d "$SRC_CLAWD" ]] || die "Missing backup: $SRC_CLAWD"
[[ -d "$SRC_CLAWDBOT" ]] || die "Missing backup: $SRC_CLAWDBOT"

log "Stopping gateway (ignore errors if not running)…"
openclaw gateway stop || true

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
openclaw gateway start

log "Done. You can verify with: openclaw status"
