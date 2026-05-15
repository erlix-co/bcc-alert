#!/usr/bin/env bash
# Convenience wrapper: deploy licensing-api and Outlook add-in in sequence.
# Prefer separate webhooks calling licensing-api/deploy/deploy.sh and deploy/deploy-addin.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

bash "${REPO_DIR}/licensing-api/deploy/deploy.sh"
bash "${SCRIPT_DIR}/deploy-addin.sh"
