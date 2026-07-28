#!/usr/bin/env bash
# =============================================================================
# seed-env.sh — first-boot environment seeding for the Helix appliance.
#
# Goal: the operator never hand-manages the ~60 env vars the multi-container
# stack needs. This script GENERATES every secret + every internal URL exactly
# once, onto the persistent data volume, and leaves only a tiny site.env (public
# URL + outbound integrations) for the human.
#
# Files written under /var/lib/helix/env/ (the persistent volume, so secrets
# survive container replacement and stay matched to the Postgres data dir):
#   secrets.env   generated ONCE, never regenerated (rotating would orphan data)
#   internal.env  regenerated every boot — deterministic 127.0.0.1 wiring
#   site.env      seeded from /etc/helix/site.env (operator mount) or defaults
#
# Every systemd unit loads all three via EnvironmentFile=. Because all services
# now share one network namespace, the internal URLs collapse to 127.0.0.1 and
# need no operator input at all.
# =============================================================================
set -euo pipefail

ENV_DIR=/var/lib/helix/env
SECRETS="${ENV_DIR}/secrets.env"
INTERNAL="${ENV_DIR}/internal.env"
SITE="${ENV_DIR}/site.env"
SITE_SRC=/etc/helix/site.env
STEP_HOME=/var/lib/helix/step-ca

mkdir -p "${ENV_DIR}"

# FS storage root for STORAGE_PROVIDER=FS — owned by the app user so the cloud
# app (and the /api/internal/fs-storage route) can read/write objects.
mkdir -p /var/lib/helix/storage
chown helix:helix /var/lib/helix/storage 2>/dev/null || true

umask 077

rand() { python3 -c 'import secrets;print(secrets.token_hex(32))'; }

# ---- secrets.env — generate ONCE -------------------------------------------
if [[ ! -f "${SECRETS}" ]]; then
  echo "seed-env: generating secrets (first boot)"
  PG_HELIX_PASSWORD="$(rand)"
  PG_INNGEST_PASSWORD="$(rand)"
  {
    echo "# Generated once on first boot. Do not edit — values are bound to on-disk data."
    echo "POSTGRES_USER=helix"
    echo "POSTGRES_PASSWORD=${PG_HELIX_PASSWORD}"
    echo "POSTGRES_DB=helix"
    echo "INNGEST_POSTGRES_USER=inngest"
    echo "INNGEST_POSTGRES_PASSWORD=${PG_INNGEST_PASSWORD}"
    echo "INNGEST_POSTGRES_DB=inngest"
    echo "BETTER_AUTH_SECRET=$(rand)"
    echo "HELIX_SERVER_AUTH_SECRET=$(rand)"
    echo "WORKFLOW_SERVICE_TOKEN=$(rand)"
    echo "INNGEST_EVENT_KEY=$(rand)"
    echo "INNGEST_SIGNING_KEY=$(rand)"
    echo "TURBO_TOKEN=$(rand)"
    echo "HELIX_PACKAGE_RELEASE_TOKEN=$(rand)"
    # Shared secret between the cloud app (appliance.triggerUpgrade) and the
    # root update-agent it signals on 127.0.0.1:9787.
    echo "HELIX_UPDATE_AGENT_TOKEN=$(rand)"
    # VAPID web-push keypair (raw; the cloud app derives what it needs).
    echo "VAPID_PRIVATE_KEY=$(rand)"
  } > "${SECRETS}"
  chmod 600 "${SECRETS}"
else
  echo "seed-env: secrets.env already present — keeping"
fi

# Secrets added after a box was first seeded must be back-filled: secrets.env is
# written once, so a key added only to the block above would never reach an
# existing appliance. Append-if-missing keeps old and new boxes converged.
#
# TURN_STATIC_AUTH_SECRET signs the ephemeral TURN credentials /api/ice-config
# hands out (coturn's `use-auth-secret` REST model); coturn verifies them with the
# same secret. It replaces the shared static password TURN used to ship with.
if ! grep -q '^TURN_STATIC_AUTH_SECRET=' "${SECRETS}"; then
  echo "seed-env: back-filling TURN_STATIC_AUTH_SECRET"
  echo "TURN_STATIC_AUTH_SECRET=$(rand)" >> "${SECRETS}"
fi

# ---- internal.env — deterministic, regenerated every boot -------------------
# All internal service URLs are localhost because every service is a unit in the
# same container. This is the bulk of what used to be operator-managed env.
# shellcheck disable=SC1090
source "${SECRETS}"
cat > "${INTERNAL}" <<EOF
# Auto-generated each boot. Internal 127.0.0.1 wiring — do not edit.
NODE_ENV=production
# All Node processes run in UTC so naive \`timestamp\` columns are read/written
# consistently (device_event etc. store UTC wall-clock).
TZ=UTC
HOSTNAME=0.0.0.0

DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}
INNGEST_POSTGRES_URI=postgres://${INNGEST_POSTGRES_USER}:${INNGEST_POSTGRES_PASSWORD}@127.0.0.1:5432/${INNGEST_POSTGRES_DB}
OPENFGA_DATASTORE_URI=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?sslmode=disable

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
INNGEST_REDIS_URI=redis://127.0.0.1:6379

OPENFGA_API_URL=http://127.0.0.1:8080
OPENFGA_STORE_NAME=helix

INNGEST_BASE_URL=http://127.0.0.1:8288
HELIX_INNGEST_BASE_URL=http://127.0.0.1:8288
HELIX_WORKFLOW_SCHEDULER_URL=http://127.0.0.1:3010
HELIX_WORKFLOW_BASE_URL=http://127.0.0.1:3000
WORKFLOW_MAX_CONCURRENCY=5

EVENT_QUEUE_BROKERS=127.0.0.1:9092
EVENT_QUEUE_TOPIC=helix.device-events.v1
DEVICE_EVENT_RETENTION_SECONDS=604800

# PKI / MQTT (step-ca issues the broker + client certs into ${STEP_HOME}).
MQTT_STEP_CA_URL=https://127.0.0.1:9000
MQTT_STEP_CA_ROOT_CERT_PATH=${STEP_HOME}/certs/root_ca.crt
MQTT_STEP_CA_DEVICE_PROVISIONER_NAME=helix-device
MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH=${STEP_HOME}/jwk/device-provisioner.jwk.json
MQTT_BROKER_URL=mqtts://127.0.0.1:8884
MQTT_TLS_CA_CERT_PATH=/var/lib/helix/mqtt/helix-server/root_ca.crt
MQTT_TLS_CLIENT_CERT_PATH=/var/lib/helix/mqtt/helix-server/client.crt
MQTT_TLS_CLIENT_KEY_PATH=/var/lib/helix/mqtt/helix-server/client.key
MQTT_TLS_SERVER_NAME=localhost

DEVICE_MTLS_PORT=4001
DEVICE_MTLS_SERVER_CERT_PATH=/var/lib/helix/mqtt/helix-server/server.crt
DEVICE_MTLS_SERVER_KEY_PATH=/var/lib/helix/mqtt/helix-server/server.key
DEVICE_MTLS_CA_CERT_PATH=/var/lib/helix/mqtt/helix-server/root_ca.crt
# CRL for the mTLS listener; crl-sync keeps it in sync with step-ca's list.
DEVICE_MTLS_CRL_PATH=/var/lib/helix/mqtt/helix-server/crl.pem

# Per-service listen config. NB: do NOT set a generic PORT here — it would leak
# into every unit and collide (e.g. Helix Server would inherit the app's 3000).
# Each service unit sets its own PORT (app=3000, helix-server=4000).
SCHEDULER_HOST=0.0.0.0
SCHEDULER_PORT=3010
METRICS_PORT=9464
DEVICE_ID=default

# Deployment mode — see HELIX_DEPLOYMENT_MODE in the cloud app. "combined"
# unlocks the in-appliance remote-update admin flow (vs "standalone").
HELIX_DEPLOYMENT_MODE=combined

# Self-upgrade wiring. The cloud app POSTs upgrade requests to the root
# update-agent here; the agent fetches release bundles back from the local cloud
# API and writes its progress to the state file the app polls.
HELIX_UPDATE_AGENT_URL=http://127.0.0.1:9787
HELIX_CLOUD_API_BASE=http://127.0.0.1:3000
HELIX_UPGRADE_STATUS_PATH=/var/lib/helix/state/upgrade-status.json

# OpenTelemetry traces -> the otel-collector (part of the observability target,
# which forwards to Tempo). Always configured so traces flow the moment
# observability is enabled; when it is off the exporter simply drops spans.
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces
OTEL_SERVICE_NAME=helix-app
EOF
chmod 600 "${INTERNAL}"

if [[ ! -f "${SITE}" ]]; then
  if [[ -f "${SITE_SRC}" ]]; then
    echo "seed-env: importing operator site.env from ${SITE_SRC}"
    cp "${SITE_SRC}" "${SITE}"
  else
    echo "seed-env: writing placeholder site.env (edit ${SITE} then restart)"
    cat > "${SITE}" <<'EOF'
# Operator-provided, site-specific config. This is the ONLY env a human edits.
# Public address of this appliance.
APP_DOMAIN=localhost
PUBLIC_APP_URL=http://localhost:3000
ACME_EMAIL=ops@example.com

# Cloudflare API token (Zone:DNS:Edit on the zone). Enables the ACME DNS-01
# challenge, which is REQUIRED for the *.port.<domain> wildcard cert and for any
# domain fronted by Cloudflare's proxy. Empty → HTTP-01, no wildcard.
CLOUDFLARE_API_TOKEN=

# Extra SANs (comma-separated) for the MQTT broker cert and the Helix Server mTLS
# listener on :4001 — i.e. every public host/IP a DEVICE dials. Cloudflare's proxy
# only carries HTTP(S), so devices must reach :8883 and :4001 at the origin
# directly: put the origin's public IP here as well as the public hostname.
MQTT_BROKER_PUBLIC_HOSTS=

# Storage backend for release bundles + uploads: S3 | AZURE | MINIO | FS
# FS keeps everything on the local data volume (fully self-contained site).
STORAGE_PROVIDER=FS
FS_STORAGE_ROOT=/var/lib/helix/storage

# S3 (when STORAGE_PROVIDER=S3)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
S3_BUCKET_NAME=

# Azure (when STORAGE_PROVIDER=AZURE)
AZURE_STORAGE_ACCOUNT_NAME=
AZURE_STORAGE_ACCOUNT_KEY=
AZURE_STORAGE_CONTAINER_NAME=

# Outbound integrations.
SMTP_SERVER=smtp://smtp.example.com:587
SMTP_USER=dev
SMTP_PASSWORD=dev
EMAIL_SENDER_ADDRESS=dev@example.com
# Mirror the full content of every outbound email to the logs (testing aid so
# verification / reset links are readable without a mail server).
EMAIL_LOG_CONTENT=true
MICROSOFT_CLIENT_ID=local-dev-placeholder
MICROSOFT_CLIENT_SECRET=local-dev-placeholder
MICROSOFT_TENANT_ID=common

# First sysadmin (seeded once by helix-bootstrap).
LOCAL_SYSADMIN_EMAIL=admin@example.com
LOCAL_SYSADMIN_NAME=Administrator
LOCAL_SYSADMIN_PASSWORD=

# Observability: set to 1 and `systemctl start helix-observability.target`.
ENABLE_OBSERVABILITY=0

# WebRTC TURN relay — the fallback path for the P2P data plane, used when a device
# and a browser cannot find a direct route (symmetric NAT, UDP-blocking VPN).
#
# TURN_PUBLIC_IP must be this box's PUBLIC address: coturn binds the private one
# but has to advertise the public one, or it hands out candidates nobody can reach.
# Leave it empty to run without TURN (direct paths still work).
#
# There is no username/password here by design: /api/ice-config mints ephemeral,
# HMAC-signed credentials per authenticated user from TURN_STATIC_AUTH_SECRET
# (generated into secrets.env). A shared static password would make this an open
# relay on the public internet.
TURN_PUBLIC_IP=
# The hostname browsers/devices dial for TURN, e.g. turn.example.com.
#
# It must be a DNS-ONLY record pointing at this box (in Cloudflare: grey cloud,
# not orange). The proxy carries HTTP(S) only, so a proxied name resolves to the
# CDN, which does not relay TURN — the same reason MQTT and the device data plane
# dial the origin directly. It needs its own name (rather than an IP) because
# turns:5349 presents a TLS certificate that must match the hostname.
#
# Leave empty to run without TURN: direct peers still connect, and anything that
# cannot falls back to the relayed data plane.
TURN_DOMAIN=
# Defaults to APP_DOMAIN.
TURN_REALM=
# TURN_SERVER_URL is derived from TURN_DOMAIN into internal.env. Set it here only
# to advertise a different relay — units load site.env last, so it wins.
EOF
  fi
  chmod 600 "${SITE}"
fi

# Mirror the public URL into the NEXT_PUBLIC_* names the app reads at runtime.
# Extract via grep, not `source` — operator-edited values may hold spaces.
PUBLIC_APP_URL="$(sed -n 's/^PUBLIC_APP_URL=//p' "${SITE}" | tail -1)"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-http://localhost:3000}"
{
  echo "BETTER_AUTH_URL=${PUBLIC_APP_URL}"
  echo "NEXT_PUBLIC_BASE_URL=${PUBLIC_APP_URL}"
  echo "NEXT_PUBLIC_HELIX_CLOUD_GATEWAY_BASE_URL=${PUBLIC_APP_URL}"
} >> "${INTERNAL}"

# A Cloudflare token enables ACME DNS-01 (required for the *.port.<domain> wildcard
# cert and proxied domains); no token falls back to HTTP-01.
if grep -q '^CLOUDFLARE_API_TOKEN=.' "${SITE}"; then
  echo 'CADDY_ACME_DNS=acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}' >> "${INTERNAL}"
else
  echo 'CADDY_ACME_DNS=' >> "${INTERNAL}"
fi

# TURN URLs for the WebRTC data plane: advertise UDP/TCP/TLS variants and let ICE pick.
TURN_DOMAIN_VALUE="$(sed -n 's/^TURN_DOMAIN=//p' "${SITE}" | tail -1)"
TURN_SERVER_URL_VALUE="$(sed -n 's/^TURN_SERVER_URL=//p' "${SITE}" | tail -1)"
if [[ -z "${TURN_SERVER_URL_VALUE}" && -n "${TURN_DOMAIN_VALUE}" ]]; then
  echo "TURN_SERVER_URL=turn:${TURN_DOMAIN_VALUE}:3478?transport=udp,turn:${TURN_DOMAIN_VALUE}:3478?transport=tcp,turns:${TURN_DOMAIN_VALUE}:5349?transport=tcp" >> "${INTERNAL}"
fi

echo "seed-env: done. env files in ${ENV_DIR}"
