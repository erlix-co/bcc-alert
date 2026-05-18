"""
Erlix licensing API.

Outlook (unchanged): GET /license-status?email=  -> user_store + active_users.txt
Gmail (v1):          POST /api/v1/licenses/check  -> license_db (SQLite)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from config import LISTEN_PORT
from license_db import check_license, init_db
from user_store import ACTIVE_USERS_FILE, is_active_email

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [LicensingAPI] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "licensing-api.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("licensing_api")

ACTIVE_EXPIRES_AT = os.getenv("LICENSE_ACTIVE_EXPIRES_AT") or "2026-12-31T00:00:00Z"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

init_db()


def resolve_listen_port() -> int:
    raw = (os.getenv("PORT") or "").strip()
    if not raw:
        return LISTEN_PORT
    try:
        port = int(raw)
    except ValueError:
        log.warning("invalid PORT=%r - using %s", raw, LISTEN_PORT)
        return LISTEN_PORT
    if port != LISTEN_PORT:
        log.warning("PORT=%s ignored - must listen on %s", port, LISTEN_PORT)
        return LISTEN_PORT
    return port


def _license_payload_for_email(email: str) -> dict:
    """Outlook legacy - do not change response shape or lowercase statuses."""
    normalized = email.strip().lower()
    if not normalized:
        log.info("invalid request (missing email) -> expired")
        return {"status": "expired"}

    if is_active_email(normalized):
        log.info("active user: %s", normalized)
        return {"status": "active", "expiresAt": ACTIVE_EXPIRES_AT}

    log.info("expired user: %s", normalized)
    return {"status": "expired"}


@app.get("/license-status")
def license_status():
    """Compatible with Outlook LicenseManager (query param: email)."""
    try:
        email = request.args.get("email") or ""
        return jsonify(_license_payload_for_email(email))
    except Exception as exc:
        log.exception("unhandled error on license-status (returning expired): %s", exc)
        return jsonify({"status": "expired"})


@app.post("/api/v1/licenses/check")
def licenses_check_v1():
    """Gmail extension licensing (JSON body)."""
    try:
        if not request.is_json:
            log.info("licenses/check rejected (Content-Type not JSON)")
            return jsonify({"status": "EXPIRED"}), 400

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"status": "EXPIRED"}), 400

        result, http_status = check_license(
            product=body.get("product"),
            license_key=body.get("licenseKey"),
            device_id=body.get("deviceId"),
            version=body.get("version"),
        )
        return jsonify(result), http_status
    except Exception as exc:
        log.exception("unhandled error on licenses/check: %s", exc)
        return jsonify({"status": "EXPIRED"})


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "licensing-api",
            "port": LISTEN_PORT,
            "activeUsersFile": str(ACTIVE_USERS_FILE),
        }
    )


if __name__ == "__main__":
    port = resolve_listen_port()
    log.info("starting Flask on 0.0.0.0:%s (users file: %s)", port, ACTIVE_USERS_FILE)
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "").lower() == "true")
