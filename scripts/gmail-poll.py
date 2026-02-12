#!/usr/bin/env python3
"""Gmail INBOX poller.

- Connects via IMAP (imap.gmail.com) using an App Password.
- Tracks last seen UID in ~/.clawdbot/state/gmail-poll.json.
- Prints NO_REPLY if no new messages.
- Otherwise prints one line per new message: "<from> — <subject>".

Env:
  GMAIL_USER: full email address
  GMAIL_APP_PASSWORD: 16-char Google App Password (no spaces)

Optional env:
  GMAIL_FOLDER: default INBOX
  GMAIL_MAX: max subjects per run (default 10)
"""

from __future__ import annotations

import imaplib
import json
import os
import re
import ssl
from email import message_from_bytes
from email.header import decode_header
from pathlib import Path

STATE_PATH = Path.home() / ".clawdbot" / "state" / "gmail-poll.json"


def _decode_subject(raw: str | bytes | None) -> str:
    if raw is None:
        return "(no subject)"
    if isinstance(raw, bytes):
        raw_bytes = raw
        try:
            raw = raw.decode("utf-8", errors="replace")
        except Exception:
            raw = str(raw_bytes)

    parts = decode_header(raw)
    out = []
    for part, charset in parts:
        if isinstance(part, bytes):
            try:
                out.append(part.decode(charset or "utf-8", errors="replace"))
            except Exception:
                out.append(part.decode("utf-8", errors="replace"))
        else:
            out.append(part)
    s = "".join(out).strip()
    s = re.sub(r"\s+", " ", s)
    return s if s else "(no subject)"


def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", "utf-8")
    tmp.replace(STATE_PATH)


def main() -> int:
    user = os.environ.get("GMAIL_USER", "").strip()
    app_pw = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    folder = os.environ.get("GMAIL_FOLDER", "INBOX").strip() or "INBOX"
    max_n = int(os.environ.get("GMAIL_MAX", "10"))

    if not user or not app_pw:
        # Be quiet by default; cron will show ok.
        print("NO_REPLY")
        return 0

    state = _load_state()
    key = f"{user}:{folder}"
    last_uid = int(state.get(key, {}).get("last_uid", 0) or 0)

    ctx = ssl.create_default_context()
    M = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=ctx)
    try:
        M.login(user, app_pw)
        typ, _ = M.select(folder, readonly=True)
        if typ != "OK":
            print("NO_REPLY")
            return 0

        # Find UIDs greater than last_uid.
        # Incremental search: we want messages whose *UID* is > last_uid.
        # With imaplib, pass SEARCH terms as separate arguments so the server
        # parses them correctly.
        if last_uid > 0:
            query_uid_range = f"{last_uid + 1}:*"
        else:
            # First run: seed state to current highest UID, do not spam.
            typ, data = M.uid("SEARCH", None, "ALL")
            if typ == "OK" and data and data[0]:
                uids = [int(x) for x in data[0].split() if x.isdigit()]
                if uids:
                    state[key] = {"last_uid": max(uids)}
                    _save_state(state)
            print("NO_REPLY")
            return 0

        # Gmail's UID SEARCH with ranges can be quirky. Use ALL then filter in
        # client-side to guarantee monotonic behavior.
        typ, data = M.uid("SEARCH", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            print("NO_REPLY")
            return 0

        all_uids = [int(x) for x in data[0].split() if x.isdigit()]
        if not all_uids:
            print("NO_REPLY")
            return 0

        uids = sorted([u for u in all_uids if u > last_uid])
        if not uids:
            print("NO_REPLY")
            return 0

        newest_uid = uids[-1]

        # Fetch last max_n to avoid huge bursts.
        uids_to_fetch = uids[-max_n:]
        subjects: list[str] = []

        for uid in uids_to_fetch:
            typ, msg_data = M.uid(
                "FETCH",
                str(uid),
                "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])",
            )
            if typ != "OK" or not msg_data:
                continue
            # msg_data is list of tuples: (b'UID ...', header_bytes)
            header_bytes = None
            for item in msg_data:
                if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], (bytes, bytearray)):
                    header_bytes = bytes(item[1])
                    break
            if not header_bytes:
                continue
            msg = message_from_bytes(header_bytes)
            subj = _decode_subject(msg.get("Subject"))
            from_raw = msg.get("From")
            from_s = _decode_subject(from_raw)  # decode_header also works for From
            subjects.append(f"{from_s} — {subj}")

        state[key] = {"last_uid": newest_uid}
        _save_state(state)

        if not subjects:
            print("NO_REPLY")
            return 0

        for s in subjects:
            print(s)
        return 0

    finally:
        try:
            M.logout()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
