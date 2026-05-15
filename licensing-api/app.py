"""
Outlook add-in licensing API (BCC Alert / Erlix).

Standalone service — no coupling to LinkCheck or other Erlix products.

Public URL (nginx): GET https://erlix.net/api/license-status?email=...
Internal route:      GET /license-status?email=...
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

from config import LISTEN_PORT

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "license-api.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("licensing_api")

ACTIVE_EMAIL = (os.getenv("LICENSE_ACTIVE_EMAIL") or "ierlich@gmail.com").strip().lower()
ACTIVE_EXPIRES_AT = os.getenv("LICENSE_ACTIVE_EXPIRES_AT") or "2026-12-31T00:00:00Z"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


def resolve_listen_port() -> int:
    """
    Always bind to LISTEN_PORT (5003) unless PORT env is set to the same value.
    Ignores stale PORT values from old deployments.
    """
    raw = (os.getenv("PORT") or "").strip()
    if not raw:
        return LISTEN_PORT
    try:
        port = int(raw)
    except ValueError:
        log.warning("[LICENSE_API] invalid PORT=%r — using %s", raw, LISTEN_PORT)
        return LISTEN_PORT
    if port != LISTEN_PORT:
        log.warning(
            "[LICENSE_API] PORT=%s ignored — licensing-api must listen on %s (update systemd/nginx)",
            port,
            LISTEN_PORT,
        )
        return LISTEN_PORT
    return port


def _license_payload_for_email(email: str) -> dict:
    normalized = email.strip().lower()
    if not normalized:
        log.info("[LICENSE_API] missing or empty email -> expired")
        return {"status": "expired"}

    if normalized == ACTIVE_EMAIL:
        log.info("[LICENSE_API] active for %s", normalized)
        return {"status": "active", "expiresAt": ACTIVE_EXPIRES_AT}

    log.info("[LICENSE_API] expired for %s", normalized)
    return {"status": "expired"}


@app.get("/license-status")
def license_status():
    """Compatible with Outlook LicenseManager (query param: email)."""
    try:
        email = request.args.get("email") or ""
        return jsonify(_license_payload_for_email(email))
    except Exception as exc:
        log.exception("[LICENSE_API] unhandled error (returning expired): %s", exc)
        return jsonify({"status": "expired"})


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "licensing-api", "port": LISTEN_PORT})


if __name__ == "__main__":
    port = resolve_listen_port()
    log.info("[LICENSE_API] starting Flask on 0.0.0.0:%s", port)
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "").lower() == "true")
