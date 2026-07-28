#!/usr/bin/env bash
# =============================================================================
# crl-sync.sh — fetch step-ca's CRL and stage it where the enforcers read it.
#
# step-ca is authoritative for the CRL (it signs it with the intermediate CA).
# Both mosquitto (crlfile) and the Helix Server mTLS gateway (Node `crl` option)
# reject client certs whose serial is on that list, so a revoked device cert is
# refused at the next handshake. This script pulls /crl over the CA-pinned HTTPS
# endpoint, normalises it to PEM, and writes it atomically into:
#   - /var/lib/helix/mosquitto/certs/crl.pem   (broker reads it via crlfile)
#   - /var/lib/helix/mqtt/helix-server/crl.pem (gateway watches + hot-reloads it)
#
# Modes:
#   once    fetch a single time (best-effort), used by mosquitto-prepare so the
#           file exists before the broker starts.
#   daemon  fetch on a loop, reloading mosquitto when the CRL changes. The Helix
#           Server watches its own copy and refreshes its TLS context itself.
# =============================================================================
set -euo pipefail

MODE="${1:-once}"
CA_URL="${MQTT_STEP_CA_URL:-https://127.0.0.1:9000}"
ROOT_CA="/var/lib/helix/step-ca/certs/root_ca.crt"
# Root-signed CRL covering the intermediate (empty, static). The mTLS gateway
# (Node) runs OpenSSL with CRL_CHECK_ALL, which demands a CRL for every cert in
# the chain — so the staged file must carry the intermediate's CRL AND this one.
ROOT_CRL="/var/lib/helix/step-ca/certs/root_crl.pem"
BROKER_CRL="/var/lib/helix/mosquitto/certs/crl.pem"
SERVER_CRL="/var/lib/helix/mqtt/helix-server/crl.pem"
INTERVAL="${CRL_SYNC_INTERVAL_SECONDS:-15}"

log() { echo "crl-sync: $*"; }

# step-ca serves the CRL at /crl (DER by default). Fetch to a temp file, then
# normalise to PEM regardless of the wire format so OpenSSL/mosquitto accept it.
fetch_to() {
  local dest="$1" tmp der pem
  tmp="$(mktemp)"
  der="${tmp}.der"
  pem="${tmp}.pem"
  if ! curl -fsS --cacert "${ROOT_CA}" "${CA_URL}/crl" -o "${der}" 2>/dev/null; then
    rm -f "${tmp}" "${der}" "${pem}"
    return 1
  fi
  if openssl crl -inform DER -in "${der}" -outform PEM -out "${pem}" 2>/dev/null; then
    :
  elif openssl crl -inform PEM -in "${der}" -outform PEM -out "${pem}" 2>/dev/null; then
    :
  else
    rm -f "${tmp}" "${der}" "${pem}"
    return 1
  fi
  # Append the static root CRL so CRL_CHECK_ALL (Node gateway) covers the
  # intermediate; harmless for mosquitto's leaf-only check.
  if [[ -f "${ROOT_CRL}" ]]; then
    cat "${ROOT_CRL}" >> "${pem}"
  fi
  install -m 0644 "${pem}" "${dest}"
  rm -f "${tmp}" "${der}" "${pem}"
  return 0
}

# Returns 0 when the CRL changed, 3 when unchanged, 1 when the fetch failed.
stage_all() {
  local before=""
  if [[ -f "${BROKER_CRL}" ]]; then
    before="$(sha256sum "${BROKER_CRL}" | cut -d' ' -f1)"
  fi

  mkdir -p "$(dirname "${BROKER_CRL}")" "$(dirname "${SERVER_CRL}")"
  local scratch
  scratch="$(mktemp)"
  if ! fetch_to "${scratch}"; then
    rm -f "${scratch}"
    return 1
  fi

  install -m 0644 -o mosquitto -g mosquitto "${scratch}" "${BROKER_CRL}" 2>/dev/null \
    || install -m 0644 "${scratch}" "${BROKER_CRL}"
  install -m 0644 -o helix -g helix "${scratch}" "${SERVER_CRL}" 2>/dev/null \
    || install -m 0644 "${scratch}" "${SERVER_CRL}"
  rm -f "${scratch}"

  local after
  after="$(sha256sum "${BROKER_CRL}" | cut -d' ' -f1)"
  if [[ "${before}" == "${after}" ]]; then
    return 3
  fi
  return 0
}

wait_for_ca() {
  local tries="${1:-30}"
  for ((i = 0; i < tries; i++)); do
    if curl -fsS --cacert "${ROOT_CA}" "${CA_URL}/health" -o /dev/null 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

case "${MODE}" in
  once)
    wait_for_ca 30 || log "step-ca not ready; attempting CRL fetch anyway"
    if stage_all; then
      log "initial CRL staged"
    elif [[ $? -eq 3 ]]; then
      log "initial CRL unchanged"
    else
      log "initial CRL fetch failed"
    fi
    # Fail closed: without a CRL the broker cannot enforce revocation, so refuse
    # to let it start rather than silently accepting revoked certs.
    if [[ ! -f "${BROKER_CRL}" ]]; then
      log "no CRL available; refusing to continue (broker would skip revocation)"
      exit 1
    fi
    ;;
  daemon)
    log "starting CRL sync loop (interval ${INTERVAL}s)"
    while true; do
      if stage_all; then
        log "CRL updated; reloading mosquitto"
        systemctl reload helix-mosquitto.service 2>/dev/null || true
      fi
      sleep "${INTERVAL}"
    done
    ;;
  *)
    echo "usage: crl-sync.sh [once|daemon]" >&2
    exit 2
    ;;
esac
