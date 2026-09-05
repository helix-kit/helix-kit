#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Runs the whole experiment from a clean checkout and prints a PASS/FAIL summary:
#
#   PostgreSQL -> helix-ldap -> SSSD -> NSS -> getent/id
#
# Exits non-zero if any check fails. On failure it dumps SSSD, LDAP and
# PostgreSQL logs plus the effective SSSD/NSS configuration.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GO_IMAGE=golang:1.26-alpine
COMPOSE_NETWORK=helix-ldap-experiment_helix
DB_URL='postgres://helix:dev-only-password@postgres:5432/helix?sslmode=disable'
BIND_DN='cn=sssd,dc=helix,dc=local'
BIND_PW='dev-only-password'
PEOPLE_DN='ou=People,dc=helix,dc=local'
GROUPS_DN='ou=Groups,dc=helix,dc=local'
SHELL_PATH='/usr/libexec/helix/session-launcher'

PASSED=0
FAILED=0
FAILURES=()

if [[ -t 1 ]]; then
    C_PASS=$'\033[32m'; C_FAIL=$'\033[31m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
    C_PASS=''; C_FAIL=''; C_HEAD=''; C_OFF=''
fi

section() { printf '\n%s== %s ==%s\n' "$C_HEAD" "$1" "$C_OFF"; }
pass()    { PASSED=$((PASSED + 1)); printf '%s[PASS]%s %s\n' "$C_PASS" "$C_OFF" "$1"; }
fail()    { FAILED=$((FAILED + 1)); FAILURES+=("$1"); printf '%s[FAIL]%s %s\n' "$C_FAIL" "$C_OFF" "$1"; }

die() {
    printf '%s[ABORT]%s %s\n' "$C_FAIL" "$C_OFF" "$1"
    diagnostics
    exit 1
}

# The LDAP facade is proven before SSSD is even started, so ldapsearch runs in a
# throwaway container built from the client image with the SSSD entrypoint
# overridden -- not inside the running sssd-client service, which does not exist yet.
ldap()    { docker compose run -T --rm --no-deps --entrypoint ldapsearch sssd-client -o ldif-wrap=no -LLL -H ldap://helix-ldap:3389 "$@"; }
ldapmod() { docker compose run -T --rm --no-deps --entrypoint ldapmodify sssd-client -H ldap://helix-ldap:3389 "$@"; }
asuser()  { docker compose exec -T sssd-client "$@"; }
psql_c()  { docker compose exec -T postgres psql -U helix -d helix -qtAX -c "$1"; }

# check_ok NAME -- CMD...        command must succeed
check_ok() {
    local name="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    local out
    if out=$("$@" 2>&1); then
        pass "$name"
    else
        fail "$name"
        printf '       command: %s\n       output: %s\n' "$*" "${out//$'\n'/$'\n'               }"
    fi
}

# check_fail NAME -- CMD...      command must NOT succeed
check_fail() {
    local name="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    local out
    if out=$("$@" 2>&1); then
        fail "$name"
        printf '       command unexpectedly succeeded: %s\n       output: %s\n' "$*" "$out"
    else
        pass "$name"
    fi
}

# check_match NAME PATTERN -- CMD...   stdout must match the extended regex
check_match() {
    local name="$1" pattern="$2"; shift 2; [[ "${1:-}" == "--" ]] && shift
    local out
    out=$("$@" 2>&1)
    if grep -Eq -- "$pattern" <<<"$out"; then
        pass "$name"
    else
        fail "$name"
        printf '       expected match: %s\n       command: %s\n       output: %s\n' \
            "$pattern" "$*" "${out//$'\n'/$'\n'               }"
    fi
}

# check_nomatch NAME PATTERN -- CMD...  stdout must NOT match
check_nomatch() {
    local name="$1" pattern="$2"; shift 2; [[ "${1:-}" == "--" ]] && shift
    local out
    out=$("$@" 2>&1)
    if grep -Eq -- "$pattern" <<<"$out"; then
        fail "$name"
        printf '       unexpected match: %s\n       output: %s\n' "$pattern" "$out"
    else
        pass "$name"
    fi
}

wait_healthy() {
    local service="$1" timeout="${2:-120}" id status
    for ((i = 0; i < timeout; i++)); do
        id=$(docker compose ps -q "$service" 2>/dev/null)
        if [[ -n "$id" ]]; then
            status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)
            [[ "$status" == "healthy" || "$status" == "running" ]] && return 0
            [[ "$status" == "exited" ]] && return 1
        fi
        sleep 1
    done
    return 1
}

# retry_until DESCRIPTION TIMEOUT -- CMD...   poll until the command succeeds
retry_until() {
    local timeout="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    for ((i = 0; i < timeout; i++)); do
        "$@" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

diagnostics() {
    section "DIAGNOSTICS"
    echo "--- docker compose ps ---";        docker compose ps 2>&1
    echo "--- helix-ldap logs (tail) ---";   docker compose logs --tail=80 helix-ldap 2>&1
    echo "--- sssd-client logs (tail) ---";  docker compose logs --tail=120 sssd-client 2>&1
    echo "--- postgres logs (tail) ---";     docker compose logs --tail=30 postgres 2>&1
    echo "--- /etc/sssd/sssd.conf ---";      asuser cat /etc/sssd/sssd.conf 2>&1
    echo "--- /etc/nsswitch.conf ---";       asuser grep -E '^(passwd|group|shadow):' /etc/nsswitch.conf 2>&1
    echo "--- users in postgres ---";        psql_c 'SELECT username, linux_uid FROM users ORDER BY linux_uid;' 2>&1
}

########################################################################
section "Phase 0 — build"
########################################################################
docker compose down -v --remove-orphans >/dev/null 2>&1
docker compose build || die "docker compose build failed"

########################################################################
section "Phase 1 — Go unit and in-process LDAP integration tests"
########################################################################
# Run in a container so the suite needs no host Go toolchain.
if docker run --rm \
    -v "$PWD":/src -w /src \
    -v helix-ldap-gomod:/go/pkg/mod -v helix-ldap-gobuild:/root/.cache/go-build \
    "$GO_IMAGE" go test ./... 2>&1; then
    pass "go test ./... (unit + go-ldap integration)"
else
    fail "go test ./... (unit + go-ldap integration)"
fi

########################################################################
section "Phase 2 — start PostgreSQL and the LDAP facade"
########################################################################
docker compose up -d postgres helix-ldap || die "compose up failed"
wait_healthy postgres 90  || die "postgres never became healthy"
pass "PostgreSQL starts and seeds users"
wait_healthy helix-ldap 90 || die "helix-ldap never became healthy"

check_match "PostgreSQL seeded alice and bob" '^alice\|200001$' -- psql_c "SELECT username || '|' || linux_uid FROM users ORDER BY linux_uid;"
check_match "helix-ldap connected to PostgreSQL" 'connected to postgres' -- docker compose logs helix-ldap

########################################################################
section "Phase 3 — direct LDAP tests against the facade"
########################################################################
check_ok   "LDAP service bind succeeds" -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -s base -b '' '(objectClass=*)'
check_fail "invalid bind password is rejected" -- \
    ldap -x -D "$BIND_DN" -w 'wrong-password' -b "$PEOPLE_DN" '(objectClass=posixAccount)'
check_fail "unknown bind DN is rejected" -- \
    ldap -x -D 'cn=intruder,dc=helix,dc=local' -w "$BIND_PW" -b "$PEOPLE_DN" '(objectClass=posixAccount)'

check_match "Root DSE advertises the naming context" 'namingContexts: dc=helix,dc=local' -- \
    ldap -x -s base -b '' '(objectClass=*)'
check_fail "anonymous search of ou=People is denied" -- \
    ldap -x -b "$PEOPLE_DN" '(objectClass=posixAccount)'

check_match "ldapsearch resolves alice by username" "uidNumber: 200001" -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(&(objectClass=posixAccount)(uid=alice))'
check_match "alice's entry carries the synthesized home directory" 'homeDirectory: /home/alice' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=alice)'
check_match "alice's entry carries the Helix login shell" "loginShell: $SHELL_PATH" -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=alice)'
check_match "alice's entry carries her mail address" 'mail: alice@example.com' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=alice)'
check_nomatch "no userPassword is ever projected" 'userPassword' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=alice)' '*' userPassword
check_match "ldapsearch resolves alice by uidNumber" 'dn: uid=alice' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(&(objectClass=posixAccount)(uidNumber=200001))'

check_match "LDAP synthesizes alice's private POSIX group" 'gidNumber: 200001' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$GROUPS_DN" '(&(objectClass=posixGroup)(cn=alice))'
check_match "group resolves by gidNumber" 'dn: cn=alice' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$GROUPS_DN" '(gidNumber=200001)'

check_nomatch "unknown username returns nothing" 'dn:' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=does-not-exist)'
check_nomatch "unknown uid returns nothing" 'dn:' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uidNumber=999999)'
check_nomatch "the SSSD service account does not resolve as a user" 'dn:' -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=sssd)'

check_fail "LDAP is read-only: modify is refused" -- \
    ldapmod -x -D "$BIND_DN" -w "$BIND_PW" -f /dev/stdin <<'LDIF'
dn: uid=alice,ou=People,dc=helix,dc=local
changetype: modify
replace: loginShell
loginShell: /bin/bash
LDIF
check_match "alice's shell is unchanged after the refused write" "loginShell: $SHELL_PATH" -- \
    ldap -x -D "$BIND_DN" -w "$BIND_PW" -b "$PEOPLE_DN" '(uid=alice)'

########################################################################
section "Phase 4 — database-backed store tests"
########################################################################
if docker run --rm --network "$COMPOSE_NETWORK" \
    -v "$PWD":/src -w /src \
    -v helix-ldap-gomod:/go/pkg/mod -v helix-ldap-gobuild:/root/.cache/go-build \
    -e TEST_DATABASE_URL="$DB_URL" \
    "$GO_IMAGE" go test ./internal/store/... 2>&1; then
    pass "go test ./internal/store/... against live PostgreSQL"
else
    fail "go test ./internal/store/... against live PostgreSQL"
fi

########################################################################
section "Phase 5 — start SSSD and resolve identities through NSS"
########################################################################
docker compose up -d sssd-client || die "could not start sssd-client"
wait_healthy sssd-client 120 || die "sssd-client never became healthy (getent passwd alice never succeeded)"
pass "SSSD starts successfully"

check_match "NSS is configured with sss" '^passwd:[[:space:]]+files sss' -- \
    asuser grep -E '^passwd:' /etc/nsswitch.conf

check_match "getent passwd alice succeeds" "^alice:[x*]:200001:200001:.*:/home/alice:$SHELL_PATH\$" -- \
    asuser getent passwd alice
check_match "getent passwd 200001 resolves alice" '^alice:[x*]:200001:200001:' -- \
    asuser getent passwd 200001
check_match "id alice reports uid 200001" 'uid=200001\(alice\)' -- asuser id alice
check_match "id alice reports gid 200001" 'gid=200001\(alice\)' -- asuser id alice
check_match "getent group alice succeeds" '^alice:[x*]:200001:' -- asuser getent group alice
check_match "getent group 200001 resolves alice's group" '^alice:[x*]:200001:' -- asuser getent group 200001

check_match "getent passwd bob succeeds" '^bob:[x*]:200002:200002:' -- asuser getent passwd bob
check_match "getent passwd 200002 resolves bob" '^bob:[x*]:200002:200002:' -- asuser getent passwd bob
check_match "id bob reports uid/gid 200002" 'uid=200002\(bob\) gid=200002\(bob\)' -- asuser id bob

check_fail "getent passwd does-not-exist returns nothing" -- asuser getent passwd does-not-exist
check_fail "id does-not-exist fails" -- asuser id does-not-exist
# The client image ships a local `sssd` system account; what must never happen is
# the LDAP bind account appearing as a Helix identity.
check_nomatch "the LDAP bind account never resolves into the Helix uid range" ':2[0-9]{5}:' -- \
    asuser getent passwd sssd

########################################################################
section "Phase 6 — PostgreSQL is the only source of truth"
########################################################################
psql_c "INSERT INTO users (uuid, email, username, linux_uid) VALUES ('00000000-0000-0000-0000-000000000003', 'charlie@example.com', 'charlie', 200003);" >/dev/null \
    || die "could not insert charlie"

# No LDAP restart, no synchronization step: the next lookup goes to PostgreSQL.
if retry_until 20 -- asuser getent passwd charlie; then
    pass "a row added to PostgreSQL resolves without restarting or syncing LDAP"
else
    fail "a row added to PostgreSQL resolves without restarting or syncing LDAP"
fi
check_match "charlie resolves with uid 200003" '^charlie:[x*]:200003:200003:.*:/home/charlie:' -- \
    asuser getent passwd charlie

psql_c "DELETE FROM users WHERE username = 'charlie';" >/dev/null || die "could not delete charlie"
asuser sss_cache -E >/dev/null 2>&1
if retry_until 20 -- bash -c '! docker compose exec -T sssd-client getent passwd charlie >/dev/null 2>&1'; then
    pass "a row removed from PostgreSQL stops resolving after cache invalidation"
else
    fail "a row removed from PostgreSQL stops resolving after cache invalidation"
fi

########################################################################
section "Phase 7 — SSSD identity cache survives an LDAP outage"
########################################################################
# dave exists in PostgreSQL but is deliberately never resolved before the outage.
psql_c "INSERT INTO users (uuid, email, username, linux_uid) VALUES ('00000000-0000-0000-0000-000000000004', 'dave@example.com', 'dave', 200004);" >/dev/null \
    || die "could not insert dave"

asuser getent passwd alice >/dev/null 2>&1 || die "alice did not resolve before the outage test"
pass "alice is resolved and cached before the outage"

docker compose stop helix-ldap >/dev/null 2>&1 || die "could not stop helix-ldap"

check_match "a cached identity still resolves while LDAP is down" '^alice:[x*]:200001:200001:' -- \
    asuser getent passwd alice
check_fail "an identity never cached cannot be discovered while LDAP is down" -- \
    asuser getent passwd dave

docker compose start helix-ldap >/dev/null 2>&1 || die "could not restart helix-ldap"
wait_healthy helix-ldap 90 || die "helix-ldap did not come back"
asuser sss_cache -E >/dev/null 2>&1
if retry_until 90 -- asuser getent passwd dave; then
    pass "the same identity resolves once LDAP returns (it was the outage, not the data)"
else
    fail "the same identity resolves once LDAP returns (it was the outage, not the data)"
fi

# Leave the database as the seed script created it.
psql_c "DELETE FROM users WHERE username = 'dave';" >/dev/null

########################################################################
section "SUMMARY"
########################################################################
printf '%s%d passed%s, %s%d failed%s\n' "$C_PASS" "$PASSED" "$C_OFF" \
    "$([[ $FAILED -gt 0 ]] && echo "$C_FAIL" || echo '')" "$FAILED" "$C_OFF"

if [[ $FAILED -gt 0 ]]; then
    printf '\nFailed checks:\n'
    printf '  - %s\n' "${FAILURES[@]}"
    diagnostics
    exit 1
fi

printf '\nPostgreSQL -> helix-ldap -> SSSD -> NSS is proven end to end.\n'
printf 'The stack is still running: docker compose exec sssd-client getent passwd alice\n'
