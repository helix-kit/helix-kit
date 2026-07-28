#!/usr/bin/env bash
# Render the turnserver config: static policy plus deployment-specific IPs, auth
# secret/realm, and TLS cert. Native counterpart of cloud/coturn/entrypoint.sh.
set -eu

BASE=/etc/helix/coturn/turnserver.conf
OUT=/run/helix-turnserver.conf
PUBLIC_IP="${TURN_PUBLIC_IP:-}"
# The private IPv4 specifically; pairing a public IPv4 with a private IPv6 is meaningless.
PRIVATE_IP="${TURN_PRIVATE_IP:-$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)}"
REALM="${TURN_REALM:-${APP_DOMAIN:-helix.local}}"

if [ -z "${TURN_STATIC_AUTH_SECRET:-}" ]; then
  echo "coturn-prepare: TURN_STATIC_AUTH_SECRET is not set — refusing to start." >&2
  echo "coturn-prepare: seed-env.sh generates it into secrets.env." >&2
  exit 1
fi

cp "${BASE}" "${OUT}"
chmod 0600 "${OUT}"

{
  printf '\n# --- rendered by coturn-prepare.sh ---\n'
  printf 'listening-ip=0.0.0.0\n'
  printf 'static-auth-secret=%s\n' "${TURN_STATIC_AUTH_SECRET}"
  printf 'realm=%s\n' "${REALM}"
} >> "${OUT}"

# Behind NAT, coturn must advertise the public address while binding the private one.
case "${PUBLIC_IP}" in
  ""|127.0.0.1|0.0.0.0|::1|localhost)
    echo "coturn-prepare: TURN_PUBLIC_IP unset; no external-ip mapping (TURN will not work from the internet)" >&2 ;;
  *)
    {
      printf 'relay-ip=%s\n' "${PRIVATE_IP}"
      printf 'external-ip=%s/%s\n' "${PUBLIC_IP}" "${PRIVATE_IP}"
    } >> "${OUT}" ;;
esac

# turns:5349 reuses the certificate Caddy already manages for this domain.
# Caddy appends its own "caddy/" under XDG_DATA_HOME, hence the doubled path — not a typo.
CADDY_CERTS=/var/lib/helix/caddy/caddy/certificates
if [ -n "${APP_DOMAIN:-}" ] && [ -d "${CADDY_CERTS}" ]; then
  CERT=$(find "${CADDY_CERTS}" -name "${APP_DOMAIN}.crt" -print -quit 2>/dev/null || true)
  KEY=$(find "${CADDY_CERTS}" -name "${APP_DOMAIN}.key" -print -quit 2>/dev/null || true)
  if [ -n "${CERT}" ] && [ -n "${KEY}" ]; then
    {
      printf 'cert=%s\n' "${CERT}"
      printf 'pkey=%s\n' "${KEY}"
    } >> "${OUT}"
  else
    echo "coturn-prepare: no Caddy certificate for ${APP_DOMAIN} yet; turns:5349 stays down until it is issued" >&2
  fi
fi
