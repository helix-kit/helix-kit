#!/usr/bin/env bash
# Stage mosquitto config + PKI into the /mosquitto layout the bundled
# mosquitto.conf expects (it uses absolute /mosquitto/... paths), then symlink
# /mosquitto -> the volume. Mirrors cloud/mosquitto/docker-entrypoint.sh.
set -euo pipefail
ROOT=/var/lib/helix/mosquitto
mkdir -p "${ROOT}/config" "${ROOT}/certs" "${ROOT}/data" "${ROOT}/pki/helix-server"

cp /etc/helix/mosquitto/mosquitto.conf "${ROOT}/config/mosquitto.conf"
# Native acl_file: merge the ORIGINAL device + service ACL files (cloud/mosquitto)
# — they're already native mosquitto syntax, so no appliance-specific copy needed.
# Global (not per-listener) but identity-scoped, so enforcement is equivalent.
cat /etc/helix/mosquitto/device.acl /etc/helix/mosquitto/service.acl \
  > "${ROOT}/config/acl"

cp /var/lib/helix/mqtt/broker/server.crt  "${ROOT}/certs/server.crt"
cp /var/lib/helix/mqtt/broker/server.key  "${ROOT}/certs/server.key"
cp /var/lib/helix/mqtt/broker/root_ca.crt "${ROOT}/certs/root_ca.crt"
cp /var/lib/helix/mqtt/helix-server/client.crt "${ROOT}/pki/helix-server/client.crt"
cp /var/lib/helix/mqtt/helix-server/client.key "${ROOT}/pki/helix-server/client.key"

chown -R mosquitto:mosquitto "${ROOT}"
chmod 0600 "${ROOT}/certs/server.key"
chmod 0600 "${ROOT}/config/acl"
ln -sfn "${ROOT}" /mosquitto
