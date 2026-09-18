#!/usr/bin/env python3
"""A weekly note saying whether the backups actually happened.

Not the backups themselves, deliberately. `pg_dumpall` writes CREATE ROLE with
every role password in it, and since 002 the cluster also holds abuse reports
with the reporter's name, phone number and address. Mailing that to a personal
inbox once a week would put both in a mailbox forever, and would undo the reason
the reports are on this machine instead of in a mailbox in the first place.

So this mails what a backup cannot leak: which dumps exist, how big they are,
their SHA-256, and whether the newest one is recent enough to count. Copy the
dumps off the machine with rclone or scp, where you control who holds them.

Run once with `once`, or as the weekly sidecar (see the pg-backup-report service).
"""
import hashlib
import os
import smtplib
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/backups"))
PREFIX = "pgcluster"
STALE_AFTER_HOURS = int(os.environ.get("BACKUP_STALE_HOURS", "26"))


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            sha.update(block)
    return sha.hexdigest()


def survey() -> tuple[bool, str]:
    dumps = sorted(BACKUP_DIR.glob(f"{PREFIX}-*.sql.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not dumps:
        return False, f"There are no dumps in {BACKUP_DIR}. The backup sidecar has not written one."

    newest = dumps[0]
    age = time.time() - newest.stat().st_mtime
    healthy = age < STALE_AFTER_HOURS * 3600

    lines = []
    lines.append("Newest dump is %.1f hours old.\n" % (age / 3600))
    if not healthy:
        lines.append(
            f"That is over the {STALE_AFTER_HOURS}h threshold, so the nightly backup is NOT running.\n"
        )
    lines.append("")
    for dump in dumps:
        when = datetime.fromtimestamp(dump.stat().st_mtime, timezone.utc)
        lines.append(f"{when:%Y-%m-%d %H:%M} UTC  {dump.stat().st_size / 1024:8.0f} KB  {dump.name}")
        lines.append(f"{'':22}sha256 {digest(dump)}")
    lines.append("")
    lines.append(
        "Nothing is attached. A cluster dump carries every role password and every\n"
        "abuse report on this machine, so it does not travel by mail. Copy it off\n"
        "with rclone or scp instead, and compare the checksum above."
    )
    return healthy, "\n".join(lines)


def send(healthy: bool, body: str) -> None:
    host = os.environ.get("BACKUP_SMTP_HOST", "")
    if not host:
        print("[pg-backup-report] BACKUP_SMTP_HOST is unset; printing instead of sending\n")
        print(body)
        return

    message = EmailMessage()
    message["Subject"] = ("Backups OK" if healthy else "BACKUPS ARE NOT RUNNING") + " — %s" % (
        datetime.now(timezone.utc).strftime("%d %b %Y")
    )
    message["From"] = os.environ["BACKUP_MAIL_FROM"]
    message["To"] = os.environ["BACKUP_MAIL_TO"]
    message.set_content(body)

    port = int(os.environ.get("BACKUP_SMTP_PORT", "587"))
    context = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, context=context, timeout=30)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
        server.starttls(context=context)
    with server:
        user = os.environ.get("BACKUP_SMTP_USERNAME", "")
        if user:
            server.login(user, os.environ.get("BACKUP_SMTP_PASSWORD", ""))
        server.send_message(message)
    print("[pg-backup-report] sent to", message["To"])


def seconds_to_next_run() -> float:
    """Weekly, at 08:00 local on the configured weekday (0 = Monday)."""
    weekday = int(os.environ.get("BACKUP_REPORT_WEEKDAY", "0"))
    hour = int(os.environ.get("BACKUP_REPORT_HOUR", "8"))
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    ahead = (weekday - now.weekday()) % 7
    target += timedelta(days=ahead)
    if target <= now:
        target += timedelta(days=7)
    return (target - now).total_seconds()


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "loop"
    if mode == "once":
        send(*survey())
        return 0
    while True:
        wait = seconds_to_next_run()
        print(f"[pg-backup-report] sleeping {wait / 3600:.1f}h until the next report", flush=True)
        time.sleep(wait)
        try:
            send(*survey())
        except Exception as failure:  # a mail server that is down must not end the loop
            print("[pg-backup-report] report failed:", failure, flush=True)


if __name__ == "__main__":
    sys.exit(main())
