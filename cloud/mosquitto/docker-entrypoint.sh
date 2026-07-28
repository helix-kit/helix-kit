#!/bin/sh
set -eu

MOSQUITTO_USER="mosquitto"
MOSQUITTO_GROUP="mosquitto"

copy_file() {
  src="$1"
  dest="$2"
  mode="$3"

  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  chown "${MOSQUITTO_USER}:${MOSQUITTO_GROUP}" "$dest"
  chmod "$mode" "$dest"
}

copy_tree_files() {
  src_dir="$1"
  dest_dir="$2"
  file_mode="$3"

  mkdir -p "$dest_dir"
  for src in "$src_dir"/*; do
    [ -e "$src" ] || continue
    dest="${dest_dir}/$(basename "$src")"
    cp "$src" "$dest"
    chown "${MOSQUITTO_USER}:${MOSQUITTO_GROUP}" "$dest"
    chmod "$file_mode" "$dest"
  done
}

copy_file /bootstrap/config/mosquitto.conf /mosquitto/config/mosquitto.conf 0644
copy_file /bootstrap/config/device.acl /mosquitto/config/device.acl 0700
copy_file /bootstrap/config/service.acl /mosquitto/config/service.acl 0700

copy_tree_files /bootstrap/certs /mosquitto/certs 0644
copy_tree_files /bootstrap/pki/helix-server /mosquitto/pki/helix-server 0644

if [ -f /mosquitto/certs/server.key ]; then
  chmod 0600 /mosquitto/certs/server.key
fi
if [ -f /mosquitto/pki/helix-server/client.key ]; then
  chmod 0600 /mosquitto/pki/helix-server/client.key
fi

# --- CRL: step-ca is authoritative; pull it to /mosquitto/certs/crl.pem (the
# crlfile the config references) so revoked device certs are rejected. Fetch
# once before the broker binds (fail closed) then refresh in the background,
# SIGHUP-ing the broker (PID 1 after exec) when the list changes.
STEP_CA_URL="${MQTT_STEP_CA_URL:-https://step-ca:9000}"
CRL_DEST="/mosquitto/certs/crl.pem"
CRL_INTERVAL="${CRL_SYNC_INTERVAL_SECONDS:-15}"

fetch_crl() {
  _tmp="$(mktemp)"
  if ! curl -fsS --cacert /mosquitto/certs/root_ca.crt "${STEP_CA_URL}/crl" -o "${_tmp}.der" 2>/dev/null; then
    rm -f "${_tmp}" "${_tmp}.der"
    return 1
  fi
  if openssl crl -inform DER -in "${_tmp}.der" -outform PEM -out "${_tmp}.pem" 2>/dev/null ||
    openssl crl -inform PEM -in "${_tmp}.der" -outform PEM -out "${_tmp}.pem" 2>/dev/null; then
    install -m 0644 -o "${MOSQUITTO_USER}" -g "${MOSQUITTO_GROUP}" "${_tmp}.pem" "${CRL_DEST}"
    rm -f "${_tmp}" "${_tmp}.der" "${_tmp}.pem"
    return 0
  fi
  rm -f "${_tmp}" "${_tmp}.der" "${_tmp}.pem"
  return 1
}

i=0
until fetch_crl; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "helix-mosquitto: could not fetch CRL from ${STEP_CA_URL}; refusing to start" >&2
    exit 1
  fi
  sleep 1
done
echo "helix-mosquitto: initial CRL staged at ${CRL_DEST}"

(
  while true; do
    sleep "${CRL_INTERVAL}"
    before="$(sha256sum "${CRL_DEST}" 2>/dev/null | cut -d' ' -f1)"
    if fetch_crl; then
      after="$(sha256sum "${CRL_DEST}" 2>/dev/null | cut -d' ' -f1)"
      if [ "${before}" != "${after}" ]; then
        echo "helix-mosquitto: CRL changed; reloading broker"
        kill -HUP 1 2>/dev/null || true
      fi
    fi
  done
) &

exec "$@"
