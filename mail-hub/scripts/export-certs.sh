#!/bin/sh
# Extracts the certificate for $MAIL_HOST from Traefik's acme.json into /certs/$MAIL_HOST/{cert,key}.pem.
set -u
command -v jq >/dev/null 2>&1 || apk add --no-cache jq >/dev/null 2>&1 || { echo "[certs] cannot install jq"; sleep 60; exit 1; }
ACME=/traefik/acme.json
OUT="/certs/${MAIL_HOST}"
mkdir -p "$OUT"
while true; do
  if [ ! -f "$ACME" ]; then
    echo "[certs] $ACME not found yet (contents of /traefik: $(ls /traefik 2>/dev/null | tr '\n' ' '))"
  else
    CERT=$(jq -r --arg d "$MAIL_HOST" '[.[]?.Certificates[]? | select(.domain.main == $d or ((.domain.sans // []) | index($d)))][0].certificate // empty' "$ACME")
    KEY=$(jq -r --arg d "$MAIL_HOST" '[.[]?.Certificates[]? | select(.domain.main == $d or ((.domain.sans // []) | index($d)))][0].key // empty' "$ACME")
    if [ -z "$CERT" ] || [ -z "$KEY" ]; then
      echo "[certs] no certificate for $MAIL_HOST in acme.json yet (Traefik issues it once the domain resolves to this server)"
    else
      echo "$CERT" | base64 -d > "$OUT/cert.pem.new" && echo "$KEY" | base64 -d > "$OUT/key.pem.new"
      if ! cmp -s "$OUT/cert.pem.new" "$OUT/cert.pem" 2>/dev/null; then
        chmod 644 "$OUT/cert.pem.new"; chmod 640 "$OUT/key.pem.new"
        mv "$OUT/cert.pem.new" "$OUT/cert.pem"; mv "$OUT/key.pem.new" "$OUT/key.pem"
        echo "[certs] certificate for $MAIL_HOST written to $OUT"
      else
        rm -f "$OUT/cert.pem.new" "$OUT/key.pem.new"
      fi
    fi
  fi
  sleep 3600
done
