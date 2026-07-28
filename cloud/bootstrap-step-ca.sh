#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKI_ROOT="${ROOT_DIR}/cloud/.local-pki"
STEP_HOME="${PKI_ROOT}/step-ca"
MQTT_ROOT="${PKI_ROOT}/mqtt"
BROKER_DIR="${MQTT_ROOT}/broker"
HELIX_SERVER_DIR="${MQTT_ROOT}/helix-server"
DEVICE_JWK_DIR="${STEP_HOME}/jwk"

if [[ -f "${ROOT_DIR}/cloud/.env" ]]; then
  eval "$(
    python3 - <<'PY' "${ROOT_DIR}/cloud/.env"
import os
import shlex
import sys
from pathlib import Path

target_keys = {"APP_DOMAIN", "PUBLIC_APP_URL", "MQTT_BROKER_PUBLIC_HOSTS"}
for raw_line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if key not in target_keys or key in os.environ:
        continue
    print(f"export {key}={shlex.quote(value.strip())}")
PY
  )"
fi

CA_PASSWORD_FILE="${STEP_HOME}/secrets/password.txt"
PROVISIONER_PASSWORD_FILE="${STEP_HOME}/secrets/provisioner-password.txt"
BOOTSTRAP_PROVISIONER="bootstrap@helix.local"
DEVICE_PROVISIONER="helix-device"
BROKER_SERVICE_CERT_NOT_AFTER="${BROKER_SERVICE_CERT_NOT_AFTER:-43800h}"
MQTT_BROKER_PUBLIC_HOSTS="${MQTT_BROKER_PUBLIC_HOSTS:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_command docker
require_command python3

mkdir -p "${STEP_HOME}/secrets" "${BROKER_DIR}" "${HELIX_SERVER_DIR}" "${DEVICE_JWK_DIR}"

write_secret_if_missing() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    python3 - <<'PY' "${file_path}"
import pathlib
import secrets
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
path.chmod(0o600)
PY
  fi
}

write_secret_if_missing "${CA_PASSWORD_FILE}"
write_secret_if_missing "${PROVISIONER_PASSWORD_FILE}"

if [[ ! -f "${STEP_HOME}/config/ca.json" ]]; then
  docker run --rm \
    -v "${STEP_HOME}:/home/step" \
    smallstep/step-cli \
    step ca init \
      --deployment-type standalone \
      --name "Helix Local MQTT CA" \
      --dns localhost \
      --dns 127.0.0.1 \
      --dns step-ca \
      --address ":9000" \
      --provisioner "${BOOTSTRAP_PROVISIONER}" \
      --password-file /home/step/secrets/password.txt \
      --provisioner-password-file /home/step/secrets/provisioner-password.txt \
      --with-ca-url "https://127.0.0.1:9000" \
      --remote-management=false
fi

python3 - <<'PY' "${STEP_HOME}/config/ca.json"
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
authority = data.setdefault("authority", {})
claims = authority.setdefault("claims", {})
claims["defaultTLSCertDuration"] = "24h"
claims["maxTLSCertDuration"] = "168h"
claims["minTLSCertDuration"] = "5m"
authority["disableIssuedAtCheck"] = False
# Enable the CRL so revoked device certs are enforced by mosquitto + the mTLS
# gateway. CRL needs a persistent DB; step ca init writes a badgerv2 block by
# default (dataSource /home/step/db inside the container) — ensure it exists.
db = data.setdefault("db", {})
db.setdefault("type", "badgerv2")
db.setdefault("dataSource", "/home/step/db")
# cacheDuration is the CRL validity AND step-ca's (proactive) regeneration cadence
# — a revoke lands on the served CRL within ~this window. Keep it a few times the
# crl-sync interval so the staged CRL is never momentarily expired.
data["crl"] = {"enabled": True, "cacheDuration": "2m"}
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

if ! python3 - <<'PY' "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}"
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
name = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
provisioners = data.get("authority", {}).get("provisioners", [])
raise SystemExit(0 if any(item.get("name") == name for item in provisioners) else 1)
PY
then
  docker run --rm \
    -v "${STEP_HOME}:/home/step" \
    smallstep/step-cli \
    step ca provisioner add "${DEVICE_PROVISIONER}" \
      --type JWK \
      --create \
      --password-file /home/step/secrets/provisioner-password.txt \
      --ca-config /home/step/config/ca.json
fi

python3 - <<'PY' "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}" "${DEVICE_JWK_DIR}/device-provisioner.jwk.json"
import json
import pathlib
import subprocess
import sys

ca_config = pathlib.Path(sys.argv[1])
provisioner_name = sys.argv[2]
output_path = pathlib.Path(sys.argv[3])
config = json.loads(ca_config.read_text(encoding="utf-8"))
encrypted_key = None
for provisioner in config.get("authority", {}).get("provisioners", []):
    if provisioner.get("name") == provisioner_name:
        encrypted_key = provisioner.get("encryptedKey")
        break
if not encrypted_key:
    raise SystemExit(f"unable to locate encrypted key for provisioner {provisioner_name}")
decrypted = subprocess.run(
    [
        "docker",
        "run",
        "--rm",
        "-i",
        "-v",
        f"{ca_config.parents[1]}:/home/step",
        "smallstep/step-cli",
        "sh",
        "-c",
        "step crypto jwe decrypt --password-file /home/step/secrets/provisioner-password.txt",
    ],
    input=encrypted_key.encode("utf-8"),
    stdout=subprocess.PIPE,
    check=True,
)
output_path.write_bytes(decrypted.stdout)
output_path.chmod(0o600)
PY

# Stamp a CRL distribution point on device leaf certs matching step-ca's CRL
# IssuingDistributionPoint (CA first DNS = localhost), so OpenSSL's CRL scope
# check (mosquitto crlfile + mTLS gateway) accepts valid certs and rejects
# revoked ones. Without it OpenSSL errors "different CRL scope" for every cert.
mkdir -p "${STEP_HOME}/templates"
cat > "${STEP_HOME}/templates/device-leaf.tpl" <<'TPL'
{
	"subject": {{ toJson .Subject }},
	"sans": {{ toJson .SANs }},
	"keyUsage": ["digitalSignature"],
	"extKeyUsage": ["serverAuth", "clientAuth"],
	"crlDistributionPoints": ["https://localhost/1.0/crl"]
}
TPL
python3 - <<'PY' "${STEP_HOME}/config/ca.json" "${DEVICE_PROVISIONER}"
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
name = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
for prov in data.get("authority", {}).get("provisioners", []):
    if prov.get("name") == name:
        prov.setdefault("options", {}).setdefault("x509", {})[
            "templateFile"
        ] = "/home/step/templates/device-leaf.tpl"
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

issue_leaf_certificate() {
  local subject="$1"
  local cert_path="$2"
  local key_path="$3"
  shift 3

  local sans=()
  for san in "$@"; do
    sans+=("--san" "${san}")
  done

  docker run --rm \
    -v "${STEP_HOME}:/home/step" \
    -v "$(dirname "${cert_path}"):/out" \
    smallstep/step-cli \
    step certificate create "${subject}" "/out/$(basename "${cert_path}")" "/out/$(basename "${key_path}")" \
      --ca /home/step/certs/intermediate_ca.crt \
      --ca-key /home/step/secrets/intermediate_ca_key \
      --ca-password-file /home/step/secrets/password.txt \
      --bundle \
      --force \
      --insecure \
      --kty EC \
      --curve P-256 \
      --no-password \
      --not-after "${BROKER_SERVICE_CERT_NOT_AFTER}" \
      "${sans[@]}"
}

read_broker_certificate_sans() {
  python3 - <<'PY'
import os
import urllib.parse

defaults = ["mosquitto", "localhost", "127.0.0.1", "host.docker.internal"]
seen = set()
result = []

def add(value: str) -> None:
    candidate = value.strip()
    if not candidate or candidate in seen:
        return
    seen.add(candidate)
    result.append(candidate)

for value in defaults:
    add(value)

for env_name in ("APP_DOMAIN", "MQTT_BROKER_PUBLIC_HOSTS"):
    raw = os.environ.get(env_name, "")
    for item in raw.split(","):
        add(item)

public_app_url = os.environ.get("PUBLIC_APP_URL", "").strip()
if public_app_url:
    parsed = urllib.parse.urlparse(public_app_url)
    if parsed.hostname:
        add(parsed.hostname)

for value in result:
    print(value)
PY
}

mapfile -t broker_sans < <(read_broker_certificate_sans)

issue_leaf_certificate "mosquitto" \
  "${BROKER_DIR}/server.crt" \
  "${BROKER_DIR}/server.key" \
  "${broker_sans[@]}"

issue_leaf_certificate "helix-server" \
  "${HELIX_SERVER_DIR}/client.crt" \
  "${HELIX_SERVER_DIR}/client.key" \
  "helix-server"

# Server cert for the Helix Server mTLS listener (:8443); shares the broker SANs.
issue_leaf_certificate "helix-server" \
  "${HELIX_SERVER_DIR}/server.crt" \
  "${HELIX_SERVER_DIR}/server.key" \
  "${broker_sans[@]}"

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

echo "Local MQTT PKI ready under ${PKI_ROOT}"
