"""
Manual active-user list for licensing-api (no database).

Production path: /root/erlix/licensing-api/data/active_users.txt
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("licensing_api")

APP_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("LICENSING_DATA_DIR", str(APP_ROOT / "data")))
ACTIVE_USERS_FILE = DATA_DIR / "active_users.txt"

# Reload when file mtime changes (edits on server apply without restart).
_cache_mtime: float | None = None
_cache_emails: set[str] = set()


def _parse_active_users_file(path: Path) -> set[str]:
    emails: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        emails.add(line.lower())
    return emails


def get_active_emails() -> set[str]:
    """
    Returns normalized (lowercase) active emails from active_users.txt.
    Missing or unreadable file => empty set (all expired).
    """
    global _cache_mtime, _cache_emails

    path = ACTIVE_USERS_FILE
    if not path.is_file():
        log.warning("[LICENSE_API] missing file %s — all requests expired", path)
        _cache_mtime = None
        _cache_emails = set()
        return set()

    try:
        mtime = path.stat().st_mtime
        if _cache_mtime == mtime:
            return set(_cache_emails)

        emails = _parse_active_users_file(path)
        _cache_mtime = mtime
        _cache_emails = emails
        log.info("[LICENSE_API] loaded %d active user(s) from %s", len(emails), path)
        return set(emails)
    except OSError as exc:
        log.warning("[LICENSE_API] cannot read %s (%s) — all expired", path, exc)
        _cache_mtime = None
        _cache_emails = set()
        return set()
    except Exception as exc:
        log.exception("[LICENSE_API] failed parsing %s (%s) — all expired", path, exc)
        _cache_mtime = None
        _cache_emails = set()
        return set()


def is_active_email(email: str) -> bool:
    normalized = email.strip().lower()
    if not normalized:
        return False
    return normalized in get_active_emails()
