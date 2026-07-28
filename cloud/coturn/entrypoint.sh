#!/bin/sh
# Render the turnserver config for the compose delivery: the static policy from
# the mounted base file, plus the deployment-specific lines coturn cannot read
# from the environment itself (IPs, auth secret, realm). Container counterpart of
# cloud/appliance/bin/coturn-prepare.sh.
set -eu

BASE_CONFIG_PATH="/etc/helix-turnserver.conf"
GENERATED_CONFIG_PATH="/tmp/helix-turnserver.conf"
PUBLIC_IP="${TURN_PUBLIC_IP:-}"
# The private IPv4 specifically. `hostname -i` lists IPv6 first on a dual-stack host,
# and pairing a public IPv4 with a private IPv6 in external-ip is meaningless — the
# relay then hands out an address the peer cannot use.
PRIVATE_IP="${TURN_PRIVATE_IP:-$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)}"
PRIVATE_IP="${PRIVATE_IP:-$(hostname -i | awk '{print $1}')}"
REALM="${TURN_REALM:-${APP_DOMAIN:-helix.local}}"

if [ -z "${TURN_STATIC_AUTH_SECRET:-}" ]; then
  echo "helix-coturn-entrypoint: TURN_STATIC_AUTH_SECRET is not set — refusing to start." >&2
  echo "helix-coturn-entrypoint: set it in cloud/.env (see .env.example)." >&2
  exit 1
fi

is_loopback_ip() {
  case "$1" in
    ""|"127.0.0.1"|"0.0.0.0"|"::1"|"localhost")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cp "${BASE_CONFIG_PATH}" "${GENERATED_CONFIG_PATH}"
chmod 0600 "${GENERATED_CONFIG_PATH}"

{
  printf '\n# --- rendered by entrypoint.sh ---\n'
  printf 'listening-ip=0.0.0.0\n'
  printf 'static-auth-secret=%s\n' "${TURN_STATIC_AUTH_SECRET}"
  printf 'realm=%s\n' "${REALM}"
} >> "${GENERATED_CONFIG_PATH}"

# Behind NAT, coturn must advertise the public address while binding the private
# one, or it hands out relay candidates nobody can reach.
if ! is_loopback_ip "${PUBLIC_IP}"; then
  printf 'relay-ip=%s\n' "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"
  printf 'external-ip=%s/%s\n' "${PUBLIC_IP}" "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"
else
  echo "helix-coturn-entrypoint: TURN_PUBLIC_IP is not set to a reachable host IP; starting without external-ip mapping" >&2
fi

exec turnserver -c "${GENERATED_CONFIG_PATH}"
