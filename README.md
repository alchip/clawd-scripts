# clawd-scripts

A small collection of utility scripts used with Clawdbot (cron jobs, housekeeping, and helpers).

> Notes
> - These scripts are **not** auto-trading / auto-execution. They generate outputs for humans (or for Clawdbot to relay).
> - Most scripts are designed to be run by cron/Clawdbot. When run manually, you may need to set env vars.

## Scripts

### 1) `scripts/gmail-poll.py` (Python)
Polls Gmail INBOX via IMAP and prints new messages.

- State file: `~/.clawdbot/state/gmail-poll.json` (tracks `last_uid` per account/folder)
- Output:
  - No new mail → prints exactly `NO_REPLY`
  - New mail → prints one line per email: `"<sender> — <subject>"`

Environment variables:
- Required:
  - `GMAIL_USER` – full Gmail address
  - `GMAIL_APP_PASSWORD` – Google App Password (16 chars, no spaces)
- Optional:
  - `GMAIL_FOLDER` – default `INBOX`
  - `GMAIL_MAX` – max items per run, default `10`

Example:
```bash
GMAIL_USER="you@gmail.com" \
GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
python3 scripts/gmail-poll.py
```

Implementation detail:
- Gmail IMAP UID range search can be quirky; the script uses `UID SEARCH ALL` then filters `uid > last_uid` client-side to avoid duplicate notifications.

---

### 2) `scripts/market-scan.mjs` (Node.js)
A lightweight market scan (intended for running every ~30 minutes during market hours).

- US market data: **stooq** (free, delayed)
- HK market data: **IBKR Client Portal Gateway** (optional; via `https://localhost:5005`)
- Output: short watchlist (max 4 symbols) + simple risk-managed “plan” (entry/stop/take/size)
- It prints `NO_REPLY` outside the configured market time windows (unless `--force`).

Usage:
```bash
node scripts/market-scan.mjs --market=us
node scripts/market-scan.mjs --market=hk

# Debug
node scripts/market-scan.mjs --market=hk --verbose

# Run even outside market hours
node scripts/market-scan.mjs --market=us --force
```

Notes for HK:
- Requires IBKR Client Portal Gateway running locally and authenticated.
- If not connected, the script prints `NO_REPLY` by default (cron-friendly).

---

### 3) `scripts/nx-autoclean.sh` (Shell)
Disk-safety cleanup for NoMachine/NX caches that can grow very large.

- Checks `~/.nx` size; if below threshold → exits quietly.
- Threshold: **5GB** (hard-coded)
- Logs to: `~/Documents/HealthChecks/nx-autoclean.log`

What it does (high level):
- Kills user-side NoMachine components (`nxnode`, `nxrunner`) to release open files
- Removes session artifacts under `~/.nx/node/*`, `~/.nx/temp/*`, `~/.nx/cache/*`, and old logs/pids
- Optionally clears `~/Documents/NoMachine/*`

Run manually:
```bash
bash scripts/nx-autoclean.sh
```

---

### 4) `scripts/clawdbot-log-cleanup.sh` (Shell)
Housekeeping for Clawdbot logs.

- Deletes old daily gateway logs under `/tmp/clawdbot` (default: 14 days)
- Rotates + gzips large launchd stdout/stderr logs under `~/.clawdbot/logs`
  - `gateway.log`, `gateway.err.log`
- Prunes rotated gz files (default: 30 days)

Environment variables (optional):
- `DAYS_TMP` (default `14`)
- `DAYS_ROTATED` (default `30`)
- `MAX_BYTES` (default `200000000` = 200MB)

Run manually:
```bash
bash scripts/clawdbot-log-cleanup.sh
```

---

### 5) `scripts/whisper-transcribe.sh` (Shell)
Wrapper around `whisper.cpp` (`whisper-cli`) to transcribe an audio file and print plain text to stdout.

- Default CLI path: `/opt/homebrew/bin/whisper-cli` (override with `WHISPER_CLI`)
- Default model: `~/.clawdbot/models/whisper/ggml-small.bin` (override with `WHISPER_CPP_MODEL`)
- Default language: auto (override with `WHISPER_LANG`)

It also handles common macOS audio formats:
- If the audio is not wav/mp3/flac/ogg, it will attempt conversion to wav via `/usr/bin/afconvert`.

Usage:
```bash
bash scripts/whisper-transcribe.sh /path/to/audio.caf

# Example: force language
WHISPER_LANG=en bash scripts/whisper-transcribe.sh /path/to/audio.m4a
```

---

### 6) Backup / Restore helpers
These scripts help you back up and restore Clawdbot data:

- `scripts/clawdbot-backup.sh` – rsync mirror backup to `~/Backups/clawdbot/latest`
- `scripts/clawdbot-restore-latest.sh` – restore from the latest mirror (overwrites current files)
- `scripts/clawdbot-snapshot.sh` – **manual** point-in-time snapshot (`tar.gz`) before risky upgrades
- See also: `scripts/README.backup.md`

Quick usage:
```bash
# Latest mirror backup
scripts/clawdbot-backup.sh

# Manual snapshot (recommended before core changes)
scripts/clawdbot-snapshot.sh

# Restore from latest mirror (DANGEROUS: overwrites current data)
scripts/clawdbot-restore-latest.sh
```

## License
Internal utility scripts (add a license here if you intend to open-source).
