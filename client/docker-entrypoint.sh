#!/bin/sh
# Make sure a certificate exists before nginx starts, or the :443 server block
# fails to load and takes the whole container with it.
#
# A real certificate mounted at /etc/nginx/certs always wins. Only when none is
# present do we fall back to a self-signed one, so the game is reachable over
# TLS immediately — browsers will warn, but the WebSocket works, which plaintext
# does not on networks that filter it.
set -e

CERT_DIR=/etc/nginx/certs
HOST="${TLS_HOST:-localhost}"

if [ ! -s "$CERT_DIR/fullchain.pem" ] || [ ! -s "$CERT_DIR/privkey.pem" ]; then
  mkdir -p "$CERT_DIR"

  # An IP needs an IP SAN; a hostname needs a DNS SAN. Browsers ignore CN.
  case "$HOST" in
    *[!0-9.]*) SAN="DNS:$HOST" ;;
    *)         SAN="IP:$HOST" ;;
  esac

  echo "[entrypoint] no certificate in $CERT_DIR — generating a self-signed one for $HOST ($SAN)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=$HOST" \
    -addext "subjectAltName=$SAN" 2>/dev/null
  echo "[entrypoint] self-signed certificate created (browsers will show a warning)"
else
  echo "[entrypoint] using the certificate found in $CERT_DIR"
fi

exec "$@"
