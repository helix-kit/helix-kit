#!/usr/bin/env bash
# =============================================================================
# pki-init.sh — generate the local MQTT PKI using the baked-in `step` binary.
#
# Faithful port of cloud/bootstrap-step-ca.sh, but it calls the locally
# installed `step` / `step-ca` binaries instead of `docker run smallstep/...`
# (there is no Docker inside the appliance). Idempotent: skips anything already
# present. Runs as a oneshot BEFORE step-ca.service and mosquitto.service.
# =============================================================================
set -euo pipefail

STEP_HOME=/var/lib/helix/step-ca
MQTT_ROOT=/var/lib/helix/mqtt
BROKER_DIR="${MQTT_ROOT}/broker"
HELIX_SERVER_DIR="${MQTT_ROOT}/helix-server"
DEVICE_JWK_DIR="${STEP_HOME}/jwk"

BOOTSTRAP_PROVISIONER="bootstrap@helix.local"
DEVICE_PROVISIONER="helix-device"
BROKER_SERVICE_CERT_NOT_AFTER="${BROKER_SERVICE_CERT_NOT_AFTER:-43800h}"
MQTT_BROKER_PUBLIC_HOSTS="${MQTT_BROKER_PUBLIC_HOSTS:-}"
export STEPPATH="${STEP_HOME}"

mkdir -p "${STEP_HOME}/secrets" "${BROKER_DIR}" "${HELIX_SERVER_DIR}" "${DEVICE_JWK_DIR}"

CA_PASSWORD_FILE="${STEP_HOME}/secrets/password.txt"
PROVISIONER_PASSWORD_FILE="${STEP_HOME}/secrets/provisioner-password.txt"

write_secret_if_missing() {
  [[ -f "$1" ]] && return 0
  python3 -c 'import pathlib,secrets,sys;p=pathlib.Path(sys.argv[1]);p.write_text(secrets.token_urlsafe(32)+"\n");p.chmod(0o600)' "$1"
}
write_secret_if_missing "${CA_PASSWORD_FILE}"
write_secret_if_missing "${PROVISIONER_PASSWORD_FILE}"

if [[ ! -f "${STEP_HOME}/config/ca.json" ]]; then
  echo "pki-init: initialising step-ca"
  step ca init \
    --deployment-type standalone \
    --name "Helix Local MQTT CA" \
    --dns localhost --dns 127.0.0.1 --dns step-ca \
    --address ":9000" \
    --provisioner "${BOOTSTRAP_PROVISIONER}" \
    --password-file "${CA_PASSWORD_FILE}" \
    --provisioner-password-file "${PROVISIONER_PASSWORD_FILE}" \
    --with-ca-url "https://127.0.0.1:9000" \
    --remote-management=false
fi

# Tighten cert durations (same as the original bootstrap) and enable the CRL so
# revoked device certs are enforced by mosquitto + the mTLS gateway. CRL needs a
# persistent DB (step ca init writes a badgerv2 block by default; ensure it).
python3 - "${STEP_HOME}/config/ca.json" "${STEP_HOME}/db" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
db_path = sys.argv[2]
data = json.loads(path.read_text())
authority = data.setdefault("authority", {})
claims = authority.setdefault("claims", {})
claims["defaultTLSCertDuration"] = "24h"
claims["maxTLSCertDuration"] = "168h"
claims["minTLSCertDuration"] = "5m"
authority["disableIssuedAtCheck"] = False
db = data.setdefault("db", {})
db.setdefault("type", "badgerv2")
db.setdefault("dataSource", db_path)
# cacheDuration is the CRL validity AND step-ca's (proactive) regeneration cadence
# — a revoke lands on the served CRL within ~this window. Keep it a few times the
# crl-sync interval so the staged CRL is never momentarily expired.
data["crl"] = {"enabled": True, "cacheDuration": "2m"}
path.write_text(json.dumps(data, indent=2) + "\n")
PY

# Add the device JWK provisioner if absent.
if ! python3 - "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
provs = data.get("authority", {}).get("provisioners", [])
raise SystemExit(0 if any(p.get("name") == sys.argv[2] for p in provs) else 1)
PY
then
  echo "pki-init: adding device provisioner ${DEVICE_PROVISIONER}"
  step ca provisioner add "${DEVICE_PROVISIONER}" \
    --type JWK --create \
    --password-file "${PROVISIONER_PASSWORD_FILE}" \
    --ca-config "${STEP_HOME}/config/ca.json"
fi

# Export the decrypted device provisioner JWK for the cloud app.
if [[ ! -f "${DEVICE_JWK_DIR}/device-provisioner.jwk.json" ]]; then
  python3 - "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}" \
           "${PROVISIONER_PASSWORD_FILE}" "${DEVICE_JWK_DIR}/device-provisioner.jwk.json" <<'PY'
import json, pathlib, subprocess, sys
config = json.loads(pathlib.Path(sys.argv[1]).read_text())
name, pwfile, out = sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4])
enc = next((p.get("encryptedKey") for p in config["authority"]["provisioners"]
            if p.get("name") == name), None)
if not enc:
    raise SystemExit(f"no encrypted key for {name}")
res = subprocess.run(["step", "crypto", "jwe", "decrypt", "--password-file", pwfile],
                     input=enc.encode(), stdout=subprocess.PIPE, check=True)
out.write_bytes(res.stdout); out.chmod(0o600)
PY
fi

# Stamp a CRL distribution point on device leaf certs that matches step-ca's CRL
# IssuingDistributionPoint (derived from the CA's first DNS name = localhost), so
# OpenSSL's CRL scope check (mosquitto crlfile + the mTLS gateway) accepts valid
# certs and rejects revoked ones. Without a matching DP OpenSSL errors with
# "different CRL scope" and refuses every device cert.
TEMPLATE_DIR="${STEP_HOME}/templates"
mkdir -p "${TEMPLATE_DIR}"
cat > "${TEMPLATE_DIR}/device-leaf.tpl" <<'TPL'
{
	"subject": {{ toJson .Subject }},
	"sans": {{ toJson .SANs }},
	"keyUsage": ["digitalSignature"],
	"extKeyUsage": ["serverAuth", "clientAuth"],
	"crlDistributionPoints": ["https://localhost/1.0/crl"]
}
TPL
python3 - "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}" \
         "${TEMPLATE_DIR}/device-leaf.tpl" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
name, template = sys.argv[2], sys.argv[3]
data = json.loads(path.read_text())
for prov in data.get("authority", {}).get("provisioners", []):
    if prov.get("name") == name:
        prov.setdefault("options", {}).setdefault("x509", {})["templateFile"] = template
path.write_text(json.dumps(data, indent=2) + "\n")
PY

issue_leaf() {
  local subject="$1" cert="$2" key="$3"; shift 3
  local sans=(); for s in "$@"; do sans+=(--san "$s"); done
  step certificate create "${subject}" "${cert}" "${key}" \
    --ca "${STEP_HOME}/certs/intermediate_ca.crt" \
    --ca-key "${STEP_HOME}/secrets/intermediate_ca_key" \
    --ca-password-file "${CA_PASSWORD_FILE}" \
    --bundle --force --insecure --kty EC --curve P-256 --no-password \
    --not-after "${BROKER_SERVICE_CERT_NOT_AFTER}" "${sans[@]}"
}

mapfile -t broker_sans < <(python3 <<'PY'
import os, urllib.parse
seen, out = set(), []
def add(v):
    v = v.strip()
    if v and v not in seen:
        seen.add(v); out.append(v)
for v in ["mosquitto", "localhost", "127.0.0.1", "host.docker.internal"]:
    add(v)
for name in ("APP_DOMAIN", "MQTT_BROKER_PUBLIC_HOSTS"):
    for item in os.environ.get(name, "").split(","):
        add(item)
u = os.environ.get("PUBLIC_APP_URL", "").strip()
if u and (h := urllib.parse.urlparse(u).hostname):
    add(h)
print("\n".join(out))
PY
)

issue_leaf "mosquitto" "${BROKER_DIR}/server.crt" "${BROKER_DIR}/server.key" "${broker_sans[@]}"
issue_leaf "helix-server" "${HELIX_SERVER_DIR}/client.crt" "${HELIX_SERVER_DIR}/client.key" "helix-server"
# Server cert for the Helix Server mTLS listener (:4001); shares the broker SANs.
issue_leaf "helix-server" "${HELIX_SERVER_DIR}/server.crt" "${HELIX_SERVER_DIR}/server.key" "${broker_sans[@]}"

# Generate a root-signed CRL covering the intermediate CA. step-ca only serves
# the intermediate's CRL (revoked leaves); the mTLS gateway runs OpenSSL with
# CRL_CHECK_ALL, which also demands a CRL for the intermediate, so crl-sync
# appends this to the served CRL. It is empty + long-lived (the intermediate is
# never revoked); regenerating it every init is harmless.
ROOT_CRL_DIR=$(mktemp -d)
: > "${ROOT_CRL_DIR}/index.txt"
echo 1000 > "${ROOT_CRL_DIR}/crlnumber"
cat > "${ROOT_CRL_DIR}/openssl.cnf" <<EOF
[ca]
default_ca = CA_default
[CA_default]
database = ${ROOT_CRL_DIR}/index.txt
crlnumber = ${ROOT_CRL_DIR}/crlnumber
default_md = sha256
default_crl_days = 3650
EOF
openssl ca -gencrl -config "${ROOT_CRL_DIR}/openssl.cnf" \
  -cert "${STEP_HOME}/certs/root_ca.crt" \
  -keyfile "${STEP_HOME}/secrets/root_ca_key" \
  -passin "file:${CA_PASSWORD_FILE}" \
  -out "${STEP_HOME}/certs/root_crl.pem"
rm -rf "${ROOT_CRL_DIR}"

# The mTLS trust store must be intermediate + root, not root alone. Device leaves
# are issued by the intermediate, and the enforced CRL is signed by the
# intermediate too — so OpenSSL (mosquitto :8883, the :4001 gateway) needs the
# intermediate in the CA store both to build the client chain and to validate the
# CRL's signature. With root only it fails every client with "unable to get CRL
# issuer certificate" -> "unknown ca", regardless of what chain the client sends.
cat "${STEP_HOME}/certs/intermediate_ca.crt" "${STEP_HOME}/certs/root_ca.crt" > "${BROKER_DIR}/root_ca.crt"
cat "${STEP_HOME}/certs/intermediate_ca.crt" "${STEP_HOME}/certs/root_ca.crt" > "${HELIX_SERVER_DIR}/root_ca.crt"
chmod 0644 "${BROKER_DIR}/root_ca.crt" "${HELIX_SERVER_DIR}/root_ca.crt"
chmod 0600 "${BROKER_DIR}/server.key" "${HELIX_SERVER_DIR}/client.key" "${HELIX_SERVER_DIR}/server.key"

# step-ca + mosquitto run as their own users; let them read what they need.
chown -R stepca:stepca "${STEP_HOME}" 2>/dev/null || true
chown -R mosquitto:mosquitto "${MQTT_ROOT}/broker" 2>/dev/null || true
# Helix Server + cloud app run as helix and read the client cert + JWK.
chown -R helix:helix "${HELIX_SERVER_DIR}" 2>/dev/null || true
chmod 0644 "${DEVICE_JWK_DIR}/device-provisioner.jwk.json" 2>/dev/null || true
# The cloud app reads this public CA file directly from MQTT_STEP_CA_ROOT_CERT_PATH
# while issuing device certificates.
chmod 0755 "${STEP_HOME}/certs" 2>/dev/null || true
chmod 0644 "${STEP_HOME}/certs/root_ca.crt" 2>/dev/null || true

echo "pki-init: MQTT PKI ready under ${MQTT_ROOT}"
