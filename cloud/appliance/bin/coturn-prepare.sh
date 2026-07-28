#!/usr/bin/env bash
# Render the turnserver config: the static policy from /etc/helix/coturn plus the
# deployment-specific bits coturn cannot read from the environment itself — the
# listening/relay/external IPs, the auth secret + realm, and the TLS certificate.
# Native (appliance/AMI) counterpart of cloud/coturn/entrypoint.sh.
set -eu

BASE=/etc/helix/coturn/turnserver.conf
OUT=/run/helix-turnserver.conf
PUBLIC_IP="${TURN_PUBLIC_IP:-}"
# The private IPv4 specifically. `hostname -i` lists IPv6 first on a dual-stack box,
# and pairing a public IPv4 with a private IPv6 in external-ip is meaningless — the
# relay then hands out an address the peer cannot use.
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

# Behind NAT (EC2), coturn must advertise the public address while binding the
# private one, or it hands out relay candidates nobody can reach.
case "${PUBLIC_IP}" in
  ""|127.0.0.1|0.0.0.0|::1|localhost)
    echo "coturn-prepare: TURN_PUBLIC_IP unset; no external-ip mapping (TURN will not work from the internet)" >&2 ;;
  *)
    {
      printf 'relay-ip=%s\n' "${PRIVATE_IP}"
      printf 'external-ip=%s/%s\n' "${PUBLIC_IP}" "${PRIVATE_IP}"
    } >> "${OUT}" ;;
esac

# turns:5349 (TURN over TLS) is the path that survives networks which block UDP
# and inspect traffic — it looks like HTTPS, and it is the only thing that worked
# from a corporate VPN in testing. Reuse the certificate Caddy already manages for
# this domain rather than provisioning a second one.
# Caddy appends its own "caddy/" under XDG_DATA_HOME (which the unit sets to
# /var/lib/helix/caddy), hence the doubled path — not a typo.
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
