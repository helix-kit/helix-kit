#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Exercises the three real authentication methods against a real Helix cloud.
#
# Unlike e2e.sh, which proves the PAM boundary with a stub verdict, everything
# here goes through Better Auth, the authorization provider and the device's own
# state. Run scripts/cloud-up.sh first.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

source ../lib/e2e-checks.sh

GENERATED="$PWD/generated"
[[ -f "$GENERATED/cloud.env" ]] || die "run scripts/cloud-up.sh first"
# shellcheck disable=SC1091
source "$GENERATED/cloud.env"

DEAD_CLOUD="http://127.0.0.1:1"
CREDENTIAL_FILE=/tmp/lab-credential

flow()      { docker compose exec -T ssh-client auth-flow "$@"; }
on_device() { docker compose exec -T device "$@"; }
cloud_url() { on_device set-cloud-url "$1" >/dev/null; }

diagnostics() {
    section "DIAGNOSTICS"
    echo "--- helix-authd log (tail) ---"; on_device tail -n 40 /var/log/helix-authd.log 2>&1
    echo "--- device config ---";          on_device cat /etc/helix/conf.d/helix-authd.json 2>&1
    echo "--- cloud log (tail) ---";       tail -n 30 "$GENERATED/cloud.log" 2>&1
}

########################################################################
section "Setup"
########################################################################
docker compose up -d >/dev/null 2>&1
# Restarting reinstalls the generated cloud configuration, so this suite is not
# affected by whatever the stub-boundary suite last left behind.
docker compose restart device >/dev/null 2>&1
wait_healthy device 180 || die "the device is not healthy"
cloud_url "$DEVICE_CLOUD_URL"
check_match "the cloud is reachable and knows this device" '"allowed":true' -- \
    curl -s -X POST "$CLOUD_URL/api/device-auth/authorize" \
        -H 'Content-Type: application/json' -H "Authorization: Bearer $DEVICE_TOKEN" \
        -d "{\"deviceId\":\"$DEVICE_ID\",\"userId\":\"$ALICE_ID\"}"

########################################################################
section "Method 1 — online browser authentication"
########################################################################
check_match "alice logs in after approving in a browser" 'HELIX_AUTH_OK' -- flow online
check_match "and lands as uid 200001" 'uid=200001' -- flow online
check_ok   "a refusal in the browser denies the login" -- flow online --deny --expect-fail

# Only a cloud-connected success may teach the device who someone is.
check_fail "an unknown user cannot log in at all" -- flow online --user nosuchuser

########################################################################
section "Method 2 — offline challenge and response"
########################################################################
check_match "alice logs in with a response from her phone" 'HELIX_AUTH_OK' -- flow offline
check_ok   "a wrong response is refused" -- \
    flow offline --response-override AAAAAAAA --expect-fail

# The whole point of the method: the device does not need the cloud.
cloud_url "$DEAD_CLOUD"
check_match "it still works with the device cut off from the cloud" 'HELIX_AUTH_OK' -- flow offline
check_ok   "and online authentication does not, while it is cut off" -- \
    flow online --expect-fail
cloud_url "$DEVICE_CLOUD_URL"

# bob resolves through LDAP but has never authenticated here.
check_ok "a user the device has never authorized cannot use it" -- \
    flow offline --user bob --email bob@example.com --expect-fail

########################################################################
section "Method 3 — the persistent credential"
########################################################################
check_match "enrollment reveals a credential once and activates on paste-back" 'HELIX_AUTH_OK' -- \
    flow persistent-enroll --hours 24 --second-reveal --credential-out "$CREDENTIAL_FILE"
check_match "a later login needs no browser" 'HELIX_AUTH_OK' -- \
    flow persistent-use --credential-file "$CREDENTIAL_FILE"

# Possession is authentication, never authorization: without the cloud there is
# no answer, and the device must not invent one from what it cached.
cloud_url "$DEAD_CLOUD"
check_ok "a valid credential is refused when the cloud cannot be reached" -- \
    flow persistent-use --credential-file "$CREDENTIAL_FILE" --expect-fail
check_match "and the user is pointed at the offline method instead" 'offline' -- \
    flow persistent-use --credential-file "$CREDENTIAL_FILE" --expect-fail
cloud_url "$DEVICE_CLOUD_URL"

# A well-formed credential the device has never issued.
docker compose exec -T ssh-client sh -c \
    'printf "hlx1_ABCD2345_%s" "$(head -c 32 /dev/urandom | base64 | tr "+/" "-_" | tr -d "=")" > /tmp/bogus'
check_ok "a credential this device never issued is refused" -- \
    flow persistent-use --credential-file /tmp/bogus --expect-fail

########################################################################
section "What the device keeps"
########################################################################
# The device stores a verifier it cannot reverse, never the credential itself.
SECRET_PART=$(cut -d_ -f3 < <(docker compose exec -T ssh-client cat "$CREDENTIAL_FILE"))
check_nomatch "the credential secret is not in the device's state" "$SECRET_PART" -- \
    on_device sh -c 'strings /var/lib/helix/authd/state.db /var/lib/helix/authd/state.db-wal 2>/dev/null'
check_nomatch "and it is not in the daemon's log" "$SECRET_PART" -- \
    on_device cat /var/log/helix-authd.log

########################################################################
print_summary

printf '\nAll three authentication methods work against a real Helix cloud.\n'
printf 'Try it yourself: docker compose exec ssh-client ssh alice@device\n'
