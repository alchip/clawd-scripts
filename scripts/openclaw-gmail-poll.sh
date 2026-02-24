#!/usr/bin/env bash
set -euo pipefail

SECRETS_FILE="$HOME/.openclaw/secrets/gmail.env"

if [[ -f "$SECRETS_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
fi

exec python3 /Users/sunny/.openclaw/workspace/clawd-scripts/scripts/gmail-poll.py
