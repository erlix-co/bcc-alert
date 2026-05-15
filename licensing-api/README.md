# licensing-api

Standalone Flask service for **Outlook BCC Alert** subscription checks only.

- **Not** part of LinkCheck.
- **Not** used by the Gmail extension.

## Endpoint

`GET /license-status?email=` (public: `https://erlix.net/api/license-status?email=`)

## Server layout

| Path | Role |
|------|------|
| `/root/erlix/bcc-alert` | Git checkout (source) |
| `/root/erlix/licensing-api` | Deployed runtime (copied from `licensing-api/` in repo) |

## Deploy

```bash
bash /root/erlix/bcc-alert/licensing-api/deploy/deploy.sh
```

## Nginx (required once)

```bash
sudo bash /root/erlix/bcc-alert/licensing-api/deploy/nginx-activate-license-route.sh
```

This adds `include /etc/nginx/snippets/erlix-license-status.conf;` before the generic `location /api/` block.

```bash
systemctl status licensing-api
journalctl -u licensing-api -f
```

## Nginx

Use `deploy/nginx-license-status.snippet.conf` so `/api/license-status` proxies to port **5003** (`config.LISTEN_PORT`). Do not share the `home-webhook` listen port.
