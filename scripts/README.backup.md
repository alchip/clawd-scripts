# Clawdbot backup/restore (rsync mirror + manual snapshots)

This folder includes helper scripts to back up and restore:

- **A (workspace):** `/Users/sunny/.openclaw/workspace`
- **B (runtime data):** `~/.openclaw`

We use **two layers**:

1) **Rsync mirror** → fast, automatic, always keeps the latest state.
2) **Manual snapshot** → point-in-time tarball before risky changes.

---

## 1) Rsync mirror (latest)

### Backup (creates/updates the mirror)
Script:
- `clawdbot-backup.sh`

Destination:
- `~/Backups/clawdbot/latest/`
  - `latest/clawd/` (A)
  - `latest/.openclaw/` (B)

Run manually:
```bash
/Users/sunny/.openclaw/workspace/clawd-scripts/scripts/clawdbot-backup.sh
```

Optional environment variables (exclude big rebuildable dirs under `~/.openclaw`):
- `EXCLUDE_MODELS=1` → excludes `~/.openclaw/models/`
- `EXCLUDE_BROWSER_PROFILES=1` → excludes `~/.openclaw/browser/` + `~/.openclaw/chrome-cdp-profile/`
- `EXCLUDE_LOGS=1` → excludes `~/.openclaw/logs/`

Example (lightweight backup):
```bash
EXCLUDE_MODELS=1 EXCLUDE_BROWSER_PROFILES=1 EXCLUDE_LOGS=1 \
  /Users/sunny/.openclaw/workspace/clawd-scripts/scripts/clawdbot-backup.sh
```

### Restore (from latest mirror)
Script:
- `clawdbot-restore-latest.sh`

What it does:
- Stops the gateway (`openclaw gateway stop`)
- Restores A + B from `~/Backups/clawdbot/latest/` using `rsync --delete`
- Starts the gateway (`openclaw gateway start`)

Run:
```bash
/Users/sunny/.openclaw/workspace/clawd-scripts/scripts/clawdbot-restore-latest.sh
```

⚠️ **Warning:** restore uses `rsync --delete` and will overwrite current files.

---

## 2) Manual snapshot (tar.gz)

Use this before **key upgrades / kernel edits** so you can easily roll back.

### Create snapshot
Script:
- `clawdbot-snapshot.sh`

Destination:
- `~/Backups/clawdbot/snapshots/clawdbot-snapshot-YYYYmmdd-HHMMSS.tgz`

Run:
```bash
/Users/sunny/.openclaw/workspace/clawd-scripts/scripts/clawdbot-snapshot.sh
```

Optional environment variables (same idea as mirror; excludes apply to the `~/.openclaw` part):
```bash
EXCLUDE_MODELS=1 EXCLUDE_BROWSER_PROFILES=1 EXCLUDE_LOGS=1 \
  /Users/sunny/.openclaw/workspace/clawd-scripts/scripts/clawdbot-snapshot.sh
```

### Restore snapshot
1) Stop gateway:
```bash
openclaw gateway stop
```

2) Extract the tarball back to root (`/`). This will restore paths like `/Users/sunny/.openclaw/workspace` and `/Users/sunny/.openclaw`.
```bash
sudo tar -xzf ~/Backups/clawdbot/snapshots/clawdbot-snapshot-YYYYmmdd-HHMMSS.tgz -C /
```

3) Start + check:
```bash
openclaw gateway start
openclaw status
```

---

## Notes / Safety

- Backups may contain sensitive data (credentials, logs). Store in a private location.
- For best safety, also copy `~/Backups/clawdbot/` to an external disk occasionally.
- macOS built-in `rsync` is old; scripts avoid newer rsync flags.
