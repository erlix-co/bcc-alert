# licensing-api

Flask service for Erlix product licensing.

| Client | Endpoint | Storage |
|--------|----------|---------|
| **Outlook add-in** | `GET /api/license-status?email=` | `data/active_users.txt` via `user_store.py` |
| **Gmail extension** | `POST /api/v1/licenses/check` | `data/licenses.db` (SQLite) via `license_db.py` |

- **Not** part of LinkCheck.
- Runs on port **5003** (`config.LISTEN_PORT`).

---

## Outlook (legacy - unchanged)

```bash
curl -sS "http://127.0.0.1:5003/license-status?email=user@example.com"
# {"status":"active","expiresAt":"2026-12-31T00:00:00Z"}  or  {"status":"expired"}
```

Manual activation - one email per line:

`/root/erlix/licensing-api/data/active_users.txt`

---

## Gmail v1 - `POST /api/v1/licenses/check`

### Request

```json
{
  "product": "visible-recipients-guard",
  "licenseKey": "ERLIX-DEMO-0001",
  "deviceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "version": "0.3.59"
}
```

- `licenseKey` optional - omit for trial-only flow.
- `deviceId` required (8-128 chars, `[A-Za-z0-9_-]`).
- `product` required (slug: lowercase letters, digits, hyphens).

### Responses

| status | Meaning |
|--------|---------|
| `ACTIVE` | Valid license; device registered or already known |
| `TRIAL` | No valid key; within 7-day device trial (`daysLeft`) |
| `EXPIRED` | Trial ended, invalid or expired key |
| `DEVICE_LIMIT_REACHED` | Valid key but device slot full (new device not added) |

### HTTP status codes

| Case | HTTP |
|------|------|
| Invalid JSON, non-object body, invalid `product`, invalid `deviceId` | **400** + `{"status":"EXPIRED"}` |
| Valid request; license missing or expired (business) | **200** + `{"status":"EXPIRED"}` |
| Server exception | **200** + `{"status":"EXPIRED"}` |
| `ACTIVE`, `TRIAL`, `DEVICE_LIMIT_REACHED` | **200** |

---


## Local testing

```bash
cd licensing-api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
python app.py
```

### curl - trial (no license key)

```bash
curl -sS -X POST http://127.0.0.1:5003/api/v1/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"product":"visible-recipients-guard","deviceId":"test-device-00000001","version":"0.3.59"}'
```

Expected first call: `{"status":"TRIAL","daysLeft":7}`

### curl - invalid key (HTTP 200)

```bash
curl -sS -X POST http://127.0.0.1:5003/api/v1/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"product":"visible-recipients-guard","licenseKey":"BAD-KEY","deviceId":"test-device-00000001","version":"0.3.59"}'
```

Expected: `{"status":"EXPIRED"}` (HTTP 200)

### curl - invalid product (HTTP 400)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:5003/api/v1/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"product":"","deviceId":"test-device-00000001"}'
```

Expected: `400` and body `{"status":"EXPIRED"}`

### Sample license insert (SQLite)

```bash
sqlite3 data/licenses.db <<'SQL'
INSERT INTO licenses (product, license_key, status, expires_at, devices_allowed)
VALUES (
  'visible-recipients-guard',
  'ERLIX-DEMO-0001',
  'active',
  '2026-12-31T23:59:59+00:00',
  1
);
SQL
```

### curl - ACTIVE (after insert)

```bash
curl -sS -X POST http://127.0.0.1:5003/api/v1/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"product":"visible-recipients-guard","licenseKey":"ERLIX-DEMO-0001","deviceId":"test-device-00000001","version":"0.3.59"}'
```

Expected: `{"status":"ACTIVE","expiresAt":"2026-12-31","devicesUsed":1,"devicesAllowed":1}`

### curl - DEVICE_LIMIT_REACHED (second device, `devices_allowed=1`)

```bash
curl -sS -X POST http://127.0.0.1:5003/api/v1/licenses/check \
  -H "Content-Type: application/json" \
  -d '{"product":"visible-recipients-guard","licenseKey":"ERLIX-DEMO-0001","deviceId":"test-device-00000002","version":"0.3.59"}'
```

Expected: `{"status":"DEVICE_LIMIT_REACHED"}`

### Outlook regression

```bash
curl -sS "http://127.0.0.1:5003/license-status?email=admin@erlix.onmicrosoft.com"
```

---

## Deploy (server)

```bash
bash /root/erlix/bcc-alert/licensing-api/deploy/deploy.sh
```

Nginx - legacy route (Outlook):

```bash
sudo bash /root/erlix/bcc-alert/licensing-api/deploy/nginx-activate-license-route.sh
```

Nginx - v1 route (Gmail, when snippet exists in repo):

```bash
sudo bash /root/erlix/bcc-alert/licensing-api/deploy/nginx-activate-licensing-v1-route.sh
```

Public URL after nginx:

```text
POST https://erlix.net/api/v1/licenses/check
```

---

## Server layout

| Path | Role |
|------|------|
| `/root/erlix/bcc-alert` | Git checkout |
| `/root/erlix/licensing-api` | Deployed runtime |
| `data/licenses.db` | Gmail licenses / devices / trials |
| `data/active_users.txt` | Outlook allow-list |
