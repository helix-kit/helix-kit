#!/bin/sh
# Generate the runtime coturn config: bind all interfaces, and advertise the
# EC2 public IP for relay candidates (essential — the instance's own NIC only
# has the private 172.31.x address, so without external-ip the relay would hand
# out an unreachable address).
set -eu

BASE=/etc/helix-turnserver.conf
GEN=/tmp/helix-turnserver.conf
PUBLIC_IP="${TURN_PUBLIC_IP:-}"
PRIVATE_IP="${TURN_PRIVATE_IP:-$(hostname -i | awk '{print $1}')}"

cp "$BASE" "$GEN"
printf '\nlistening-ip=0.0.0.0\n' >> "$GEN"

case "$PUBLIC_IP" in
  ""|"127.0.0.1"|"0.0.0.0"|"::1")
    echo "helix-coturn: TURN_PUBLIC_IP unset — starting without external-ip (relay will be unreachable off-box)" >&2
    ;;
  *)
    printf 'relay-ip=%s\n' "$PRIVATE_IP" >> "$GEN"
    printf 'external-ip=%s/%s\n' "$PUBLIC_IP" "$PRIVATE_IP" >> "$GEN"
    echo "helix-coturn: external-ip=${PUBLIC_IP}/${PRIVATE_IP}" >&2
    ;;
esac

exec turnserver -c "$GEN"
