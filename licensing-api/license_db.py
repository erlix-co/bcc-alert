"""
Gmail licensing - SQLite helpers (sqlite3 only).

Outlook licensing is unchanged (user_store.py + active_users.txt).
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator

log = logging.getLogger("licensing_api")

APP_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("LICENSING_DATA_DIR", str(APP_ROOT / "data")))
DB_PATH = DATA_DIR / "licenses.db"

TRIAL_DAYS = 7
PRODUCT_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
LICENSE_KEY_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{3,63}$")

PRODUCT_MAX_LEN = 64
DEVICE_ID_MAX_LEN = 128
LICENSE_KEY_MAX_LEN = 64


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _date_only(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


@contextmanager
def _connection() -> Generator[sqlite3.Connection, None, None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if missing (idempotent)."""
    with _connection() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS licenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT NOT NULL,
                license_key TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                expires_at TEXT,
                devices_allowed INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (product, license_key)
            );

            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                license_id INTEGER NOT NULL,
                device_id TEXT NOT NULL,
                first_seen TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
                UNIQUE (license_id, device_id)
            );

            CREATE TABLE IF NOT EXISTS trials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT NOT NULL,
                device_id TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (product, device_id)
            );

            CREATE INDEX IF NOT EXISTS idx_devices_license_id ON devices (license_id);
            """
        )
    log.info("database ready at %s", DB_PATH)


def _validate_product(product: str | None) -> str | None:
    if not product or len(product) > PRODUCT_MAX_LEN:
        return None
    product = product.strip().lower()
    if not PRODUCT_SLUG_RE.match(product):
        return None
    return product


def _validate_device_id(device_id: str | None) -> str | None:
    if not device_id or len(device_id) > DEVICE_ID_MAX_LEN:
        return None
    device_id = device_id.strip()
    if not DEVICE_ID_RE.match(device_id):
        return None
    return device_id


def _validate_license_key(license_key: str | None) -> str | None:
    if not license_key:
        return None
    key = license_key.strip().upper()
    if len(key) > LICENSE_KEY_MAX_LEN or not LICENSE_KEY_RE.match(key):
        return None
    return key


def _license_is_active(row: sqlite3.Row, now: datetime) -> bool:
    if str(row["status"]).lower() != "active":
        return False
    expires = _parse_dt(row["expires_at"])
    if expires and expires < now:
        return False
    return True


def _touch_device(conn: sqlite3.Connection, license_id: int, device_id: str) -> None:
    conn.execute(
        """
        UPDATE devices SET last_seen = datetime('now')
        WHERE license_id = ? AND device_id = ?
        """,
        (license_id, device_id),
    )


def _register_device(conn: sqlite3.Connection, license_id: int, device_id: str) -> None:
    conn.execute(
        """
        INSERT INTO devices (license_id, device_id)
        VALUES (?, ?)
        """,
        (license_id, device_id),
    )


def _count_devices(conn: sqlite3.Connection, license_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM devices WHERE license_id = ?",
        (license_id,),
    ).fetchone()
    return int(row["c"]) if row else 0


def _device_registered(conn: sqlite3.Connection, license_id: int, device_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM devices WHERE license_id = ? AND device_id = ?",
        (license_id, device_id),
    ).fetchone()
    return row is not None


def _active_license_payload(row: sqlite3.Row, devices_used: int) -> dict[str, Any]:
    expires = _parse_dt(row["expires_at"])
    return {
        "status": "ACTIVE",
        "expiresAt": _date_only(expires) if expires else None,
        "devicesUsed": devices_used,
        "devicesAllowed": int(row["devices_allowed"]),
    }


def _check_license_key_path(
    conn: sqlite3.Connection,
    product: str,
    license_key: str,
    device_id: str,
    now: datetime,
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, status, expires_at, devices_allowed
        FROM licenses
        WHERE product = ? AND license_key = ?
        """,
        (product, license_key),
    ).fetchone()

    if not row or not _license_is_active(row, now):
        log.info("license key invalid or expired product=%s", product)
        return {"status": "EXPIRED"}

    license_id = int(row["id"])
    allowed = int(row["devices_allowed"])

    if _device_registered(conn, license_id, device_id):
        _touch_device(conn, license_id, device_id)
        used = _count_devices(conn, license_id)
        log.info("ACTIVE (known device) product=%s used=%d/%d", product, used, allowed)
        return _active_license_payload(row, used)

    used = _count_devices(conn, license_id)
    if used >= allowed:
        log.info(
            "DEVICE_LIMIT_REACHED product=%s used=%d allowed=%d",
            product,
            used,
            allowed,
        )
        return {"status": "DEVICE_LIMIT_REACHED"}

    _register_device(conn, license_id, device_id)
    used += 1
    log.info("ACTIVE (new device) product=%s used=%d/%d", product, used, allowed)
    return _active_license_payload(row, used)


def _trial_days_left(started_at: str, now: datetime) -> int:
    start = _parse_dt(started_at)
    if not start:
        return 0
    end = start + timedelta(days=TRIAL_DAYS)
    if now >= end:
        return 0
    remaining = end - now
    # Whole days remaining, rounded up (partial day counts as 1 day left).
    return max(0, int((remaining.total_seconds() + 86399) // 86400))


def _check_trial_path(
    conn: sqlite3.Connection,
    product: str,
    device_id: str,
    now: datetime,
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT started_at FROM trials
        WHERE product = ? AND device_id = ?
        """,
        (product, device_id),
    ).fetchone()

    if not row:
        conn.execute(
            """
            INSERT INTO trials (product, device_id, started_at)
            VALUES (?, ?, ?)
            """,
            (product, device_id, now.isoformat()),
        )
        log.info("TRIAL started product=%s days=%d", product, TRIAL_DAYS)
        return {"status": "TRIAL", "daysLeft": TRIAL_DAYS}

    days_left = _trial_days_left(str(row["started_at"]), now)
    if days_left <= 0:
        log.info("TRIAL expired product=%s", product)
        return {"status": "EXPIRED"}

    log.info("TRIAL active product=%s daysLeft=%d", product, days_left)
    return {"status": "TRIAL", "daysLeft": days_left}


def check_license(
    product: str | None,
    license_key: str | None,
    device_id: str | None,
    version: str | None = None,
) -> tuple[dict[str, Any], int]:
    """
    POST /api/v1/licenses/check handler body.

    Returns (payload, http_status). UPPERCASE status in payload.
    HTTP 400 only for invalid product or deviceId; business outcomes use 200.
    """
    _ = version  # reserved for future logging

    product_norm = _validate_product(product)
    device_norm = _validate_device_id(device_id)
    if not product_norm or not device_norm:
        log.info("check rejected (invalid product or deviceId)")
        return {"status": "EXPIRED"}, 400

    key_raw = (license_key or "").strip()
    key_norm = _validate_license_key(license_key) if key_raw else None
    if key_raw and not key_norm:
        log.info("check rejected (invalid licenseKey format)")
        return {"status": "EXPIRED"}, 200

    now = _utc_now()

    try:
        with _connection() as conn:
            if key_norm:
                return _check_license_key_path(conn, product_norm, key_norm, device_norm, now), 200
            return _check_trial_path(conn, product_norm, device_norm, now), 200
    except Exception as exc:
        log.exception("check failed: %s", exc)
        return {"status": "EXPIRED"}, 200
