#!/usr/bin/env bash
set -euo pipefail

NX_DIR="${HOME}/.nx"
THRESHOLD_KB=$((5*1024*1024)) # 5 GB in KiB
LOG_DIR="${HOME}/Documents/HealthChecks"
LOG_FILE="${LOG_DIR}/nx-autoclean.log"

mkdir -p "${LOG_DIR}"

stamp() { /bin/date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(stamp)] $*" | tee -a "${LOG_FILE}"; }

if [ ! -d "${NX_DIR}" ]; then
  log "No ~/.nx dir; nothing to do."
  exit 0
fi

# du output: <KB> <path>
SIZE_KB=$(du -sk "${NX_DIR}" 2>/dev/null | awk '{print $1}' || echo 0)
log "~/.nx size: ${SIZE_KB} KB (threshold ${THRESHOLD_KB} KB)"

if [ "${SIZE_KB}" -lt "${THRESHOLD_KB}" ]; then
  exit 0
fi

log "Threshold exceeded; cleaning NoMachine/NX caches/sessions (keeping config)."

# Stop user-side components that may hold deleted files open
pkill -9 -f "/Applications/NoMachine.app/Contents/MacOS/nxnode" 2>/dev/null || true
pkill -9 -f "nxrunner" 2>/dev/null || true

# Remove session artifacts while preserving config/devices
rm -rf "${NX_DIR}/node"/* 2>/dev/null || true
rm -rf "${NX_DIR}/R-"* "${NX_DIR}/K-"* "${NX_DIR}/C-"* 2>/dev/null || true
rm -rf "${NX_DIR}/temp"/* "${NX_DIR}/cache"/* 2>/dev/null || true
rm -f  "${NX_DIR}"/*.log "${NX_DIR}"/*.old "${NX_DIR}"/*.pid "${NX_DIR}"/*.tmp 2>/dev/null || true

# Optional: clean recordings dir if it exists (NoMachine may recreate)
DOCNX="${HOME}/Documents/NoMachine"
if [ -d "${DOCNX}" ]; then
  rm -rf "${DOCNX}"/* 2>/dev/null || true
fi

NEW_SIZE_KB=$(du -sk "${NX_DIR}" 2>/dev/null | awk '{print $1}' || echo 0)
log "Cleanup done. New ~/.nx size: ${NEW_SIZE_KB} KB"

# Log disk headroom
/bin/df -h /System/Volumes/Data | head -n 2 | tee -a "${LOG_FILE}" >/dev/null
