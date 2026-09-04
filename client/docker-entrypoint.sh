#!/bin/sh
# Prepare TLS and the :80 routing mode, then hand over to nginx.
set -e

CERT_DIR=/etc/nginx/certs
HOST="${TLS_HOST:-localhost}"

# A real certificate mounted here always wins. Only when none is present do we
# fall back to a self-signed one, so the container still boots (the :443 server
# block refuses to load without a certificate) and TLS is available immediately.
if [ ! -s "$CERT_DIR/fullchain.pem" ] || [ ! -s "$CERT_DIR/privkey.pem" ]; then
  mkdir -p "$CERT_DIR"
  case "$HOST" in
    *[!0-9.]*) SAN="DNS:$HOST" ;;
    *)         SAN="IP:$HOST" ;;
  esac
  echo "[entrypoint] no certificate in $CERT_DIR — generating a self-signed one for $HOST ($SAN)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=$HOST" -addext "subjectAltName=$SAN" 2>/dev/null
  echo "[entrypoint] self-signed certificate created — browsers will warn until a real one is issued"
else
  echo "[entrypoint] using the certificate found in $CERT_DIR"
fi

# What :80 does with everything that is not an ACME challenge.
if [ "${FORCE_HTTPS:-0}" = "1" ]; then
  echo "[entrypoint] FORCE_HTTPS=1 — redirecting http:// to https://"
  printf 'location / { return 301 https://$host$request_uri; }\n' > /etc/nginx/http-mode.conf
else
  echo "[entrypoint] FORCE_HTTPS=0 — serving the app over plain http as well"
  printf 'include /etc/nginx/app-locations.conf;\n' > /etc/nginx/http-mode.conf
fi

# Certbot renews in its own container and drops the new files into $CERT_DIR.
# nginx only reads certificates at start/reload, so pick them up periodically.
if [ "${CERT_RELOAD:-1}" = "1" ]; then
  (
    while :; do
      sleep 21600   # 6h
      nginx -s reload 2>/dev/null || true
    done
  ) &
fi

exec "$@"
