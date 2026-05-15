"""
Minimal BCC Alert license API for Outlook add-in (no DB, no Stripe).

Public URL (via nginx): GET https://erlix.net/api/license-status?email=...

Keep in sync with the same route in LinkCheck/backend/app.py when both are deployed.
"""

from __future__ import annotations

import logging
import os
import sys

from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("bcc_license_api")

# Temporary allowlist until real billing exists (override via env for staging).
ACTIVE_EMAIL = (os.getenv("LICENSE_ACTIVE_EMAIL") or "ierlich@gmail.com").strip().lower()
ACTIVE_EXPIRES_AT = os.getenv("LICENSE_ACTIVE_EXPIRES_AT") or "2026-12-31T00:00:00Z"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


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
    """GET /license-status?email=user@example.com"""
    try:
        email = request.args.get("email") or ""
        return jsonify(_license_payload_for_email(email))
    except Exception as exc:
        log.exception("[LICENSE_API] unhandled error (returning expired): %s", exc)
        return jsonify({"status": "expired"})


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "bcc-license-api"})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5002"))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "").lower() == "true")
