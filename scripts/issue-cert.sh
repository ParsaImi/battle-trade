#!/usr/bin/env bash
# Obtain a trusted Let's Encrypt certificate and switch the site over to it.
#
# Why this exists: a bare IP address cannot be given a publicly trusted
# certificate, and the game is unusable over plain http on networks that filter
# WebSocket frames. TLS_HOST therefore defaults to an sslip.io name, which
# resolves <ip>.sslip.io straight back to that IP and needs no registration or
# DNS of your own. Point TLS_HOST at a real domain instead whenever you have one.
#
# Run from the repo root on the server:  ./scripts/issue-cert.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env — copy .env.example to .env first"; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${TLS_HOST:?TLS_HOST must be set in .env}"
echo "==> issuing a certificate for ${TLS_HOST}"

# nginx must already be up and serving /.well-known/acme-challenge on :80.
docker compose up -d web
sleep 3

# Prove the challenge path is reachable from outside before bothering Let's
# Encrypt — a failed HTTP-01 counts against the rate limit.
TOKEN="battle-trade-preflight-$$"
mkdir -p certbot-webroot/.well-known/acme-challenge
echo "$TOKEN" > "certbot-webroot/.well-known/acme-challenge/$TOKEN"
GOT=$(curl -fsS --max-time 15 "http://${TLS_HOST}/.well-known/acme-challenge/$TOKEN" || true)
rm -f "certbot-webroot/.well-known/acme-challenge/$TOKEN"
if [ "$GOT" != "$TOKEN" ]; then
  echo "preflight failed: http://${TLS_HOST}/.well-known/acme-challenge/ is not reachable."
  echo "Check that port 80 is open and ${TLS_HOST} resolves to this machine."
  exit 1
fi
echo "==> challenge path is reachable"

# --register-unsafely-without-email: no address is handed to Let's Encrypt.
# Renewal is automatic (the certbot service), so expiry notices are not needed.
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d "${TLS_HOST}" \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --keep-until-expiring

echo "==> installing the certificate for nginx"
docker compose run --rm --entrypoint sh certbot -c \
  "cp -L /etc/letsencrypt/live/${TLS_HOST}/fullchain.pem /certs/fullchain.pem \
   && cp -L /etc/letsencrypt/live/${TLS_HOST}/privkey.pem /certs/privkey.pem"

echo "==> enabling the http -> https redirect"
if grep -q '^FORCE_HTTPS=' .env; then
  sed -i 's/^FORCE_HTTPS=.*/FORCE_HTTPS=1/' .env
else
  echo 'FORCE_HTTPS=1' >> .env
fi

# Force-recreate the web container: nginx only reads certificates at start,
# and it was last started BEFORE this certificate existed. Without the force,
# compose sees no config change and leaves the old certificate loaded.
docker compose up -d
docker compose up -d --force-recreate web
sleep 6
echo
echo "==> done. Verifying:"
curl -sS -o /dev/null -w "    https://${TLS_HOST}/        HTTP %{http_code}  (cert verified: %{ssl_verify_result} — 0 is good)\n" "https://${TLS_HOST}/"
curl -sS -o /dev/null -w "    http://${TLS_HOST}/         HTTP %{http_code}  (expect 301)\n" "http://${TLS_HOST}/"
echo
echo "    Play at: https://${TLS_HOST}/"
