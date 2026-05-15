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
    return jsonify({"ok": True, "service": "licensing-api"})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5002"))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG", "").lower() == "true")
