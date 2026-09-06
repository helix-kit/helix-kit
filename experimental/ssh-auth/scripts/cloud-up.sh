#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Stands up a real Helix cloud for the authentication lab: a throwaway Postgres,
# the actual Next.js app with Better Auth, and a seeded user, device and
# authorization fixture. Then writes the device container's configuration so it
# talks to that cloud.
#
# The cloud runs on the host rather than in a container so you can open it in your
# own browser and approve logins by hand -- which is the whole point of it.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
LAB_DIR="$PWD"
WEB_DIR="$LAB_DIR/../../web"
GENERATED="$LAB_DIR/generated"

CLOUD_PORT="${CLOUD_PORT:-3200}"
CLOUD_DB_PORT="${CLOUD_DB_PORT:-25440}"
CLOUD_DB_CONTAINER=helix-authlab-db
CLOUD_URL="http://localhost:${CLOUD_PORT}"
# What the device container calls the host.
DEVICE_CLOUD_URL="http://host.docker.internal:${CLOUD_PORT}"

DEVICE_ID="${DEVICE_ID:-D123}"
DEVICE_TOKEN="${DEVICE_TOKEN:-lab-device-access-token}"
ALICE_EMAIL="alice@example.com"
ALICE_PASSWORD="DeviceFlow-Test-1"
LINUX_UID=200001

DB_URL="postgres://helix:authlab@127.0.0.1:${CLOUD_DB_PORT}/helix"
PID_FILE="$GENERATED/cloud.pid"
LOG_FILE="$GENERATED/cloud.log"

log() { printf '[cloud] %s\n' "$*"; }
die() { printf '[cloud] FATAL: %s\n' "$*" >&2; exit 1; }

psql_c() { docker exec "$CLOUD_DB_CONTAINER" psql -U helix -d helix -qtAX -c "$1"; }

# start_app runs the Next app in the background with the given extra environment.
start_app() {
    local fixture="${1:-}"
    DATABASE_URL="$DB_URL" \
    NEXT_PUBLIC_BASE_URL="$CLOUD_URL" \
    BETTER_AUTH_URL="$CLOUD_URL" \
    DEV_ALLOWED_ORIGINS="$CLOUD_URL,$DEVICE_CLOUD_URL" \
    DEVICE_AUTH_FIXTURE="$fixture" \
    NODE_OPTIONS=--max-old-space-size=2048 \
        nohup bash -c "cd '$WEB_DIR/apps/helix' && exec pnpm dev --port $CLOUD_PORT --hostname 0.0.0.0" \
        >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
}

stop_app() {
    if [[ -f "$PID_FILE" ]]; then
        pkill -P "$(cat "$PID_FILE")" 2>/dev/null || true
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
        rm -f "$PID_FILE"
    fi
    # next dev re-execs, so also clear anything still holding the port.
    pkill -f "next.*--port $CLOUD_PORT" 2>/dev/null || true
    sleep 2
}

wait_for_app() {
    for _ in $(seq 1 90); do
        if curl -sf "$CLOUD_URL/api/auth/ok" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

mkdir -p "$GENERATED/device/conf.d" "$GENERATED/device/secrets"
: > "$LOG_FILE"

########################################################################
log "starting a throwaway PostgreSQL on ${CLOUD_DB_PORT}"
########################################################################
docker rm -f "$CLOUD_DB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CLOUD_DB_CONTAINER" \
    -e POSTGRES_USER=helix -e POSTGRES_PASSWORD=authlab -e POSTGRES_DB=helix \
    -p "127.0.0.1:${CLOUD_DB_PORT}:5432" postgres:17.6-alpine >/dev/null
for _ in $(seq 1 60); do
    docker exec "$CLOUD_DB_CONTAINER" pg_isready -U helix -d helix >/dev/null 2>&1 && break
    sleep 1
done

log "applying migrations"
(cd "$WEB_DIR/apps/helix" && DATABASE_URL="$DB_URL" SKIP_ENV_VALIDATION=true pnpm db:migrate) \
    >>"$LOG_FILE" 2>&1 || die "migrations failed; see $LOG_FILE"

########################################################################
log "starting the Helix app on ${CLOUD_PORT} (first pass, to seed)"
########################################################################
stop_app
start_app ""
wait_for_app || die "the app never came up; see $LOG_FILE"

log "seeding ${ALICE_EMAIL}"
curl -sf -X POST "$CLOUD_URL/api/auth/sign-up/email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ALICE_EMAIL\",\"password\":\"$ALICE_PASSWORD\",\"name\":\"Alice\"}" \
    >/dev/null || die "could not sign alice up"
psql_c "UPDATE \"user\" SET email_verified = true WHERE email = '$ALICE_EMAIL';" >/dev/null

ALICE_ID=$(psql_c "SELECT id FROM \"user\" WHERE email = '$ALICE_EMAIL';" | tr -d '[:space:]')
[[ -n "$ALICE_ID" ]] || die "could not read alice's user id"
log "alice is ${ALICE_ID}"

log "registering device ${DEVICE_ID}"
psql_c "INSERT INTO device (id, name, access_token, is_active)
        VALUES ('$DEVICE_ID', 'auth lab device', '$DEVICE_TOKEN', true)
        ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token, is_active = true;" >/dev/null

########################################################################
log "restarting with the authorization fixture"
########################################################################
# The fixture can only be written once alice's id exists, and it is read at
# construction, so the app is started twice: once to seed, once to serve.
OFFLINE_SECRET=$(openssl rand -hex 32)
CREDENTIAL_KEY=$(openssl rand -hex 32)
FIXTURE=$(python3 - "$ALICE_ID" "$DEVICE_ID" "$OFFLINE_SECRET" "$LINUX_UID" <<'PY'
import json, sys
user_id, device_id, secret, uid = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
print(json.dumps({
    "identities": {user_id: {"username": "alice", "linuxUid": uid}},
    "grants": [{"userId": user_id, "deviceId": device_id,
                "scopes": ["device.login", "app.foo.read"]}],
    "deviceSecrets": {device_id: secret},
}))
PY
)

stop_app
start_app "$FIXTURE"
wait_for_app || die "the app did not restart; see $LOG_FILE"

########################################################################
log "writing the device configuration"
########################################################################
cat > "$GENERATED/device/conf.d/helix-authd.json" <<JSON
{
  "socketPath": "/run/helix/authd/auth.sock",
  "authenticator": "helix",
  "attemptTimeoutSec": 600,
  "cloud": {
    "authUrl": "${DEVICE_CLOUD_URL}",
    "gatewayUrl": "${DEVICE_CLOUD_URL}",
    "browserTimeoutSec": 300,
    "pollIntervalSec": 2
  },
  "offline": {
    "verificationUri": "${CLOUD_URL}/device/offline",
    "maxScopeAgeSec": 86400,
    "challengeTtlSec": 300
  },
  "persistent": {
    "minDurationHours": 1,
    "maxDurationHours": 168,
    "enrollTimeoutSec": 600
  }
}
JSON

cat > "$GENERATED/device/secrets/helix-authd.env" <<ENV
OFFLINE_DEVICE_SECRET=${OFFLINE_SECRET}
CREDENTIAL_DEVICE_KEY=${CREDENTIAL_KEY}
ENV

printf '%s' "$DEVICE_TOKEN" > "$GENERATED/device/secrets/device-access-token"

cat > "$GENERATED/cloud.env" <<ENV
CLOUD_URL=${CLOUD_URL}
DEVICE_CLOUD_URL=${DEVICE_CLOUD_URL}
CLOUD_DB_CONTAINER=${CLOUD_DB_CONTAINER}
DEVICE_ID=${DEVICE_ID}
DEVICE_TOKEN=${DEVICE_TOKEN}
ALICE_ID=${ALICE_ID}
ALICE_EMAIL=${ALICE_EMAIL}
ALICE_PASSWORD=${ALICE_PASSWORD}
OFFLINE_SECRET=${OFFLINE_SECRET}
ENV

log ""
log "the cloud is up: ${CLOUD_URL}"
log "  sign in as ${ALICE_EMAIL} / ${ALICE_PASSWORD}"
log "  device ${DEVICE_ID} is registered and alice may log in to it"
log ""
log "next: make up   (then: make ssh)"
