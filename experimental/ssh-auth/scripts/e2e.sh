#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Proves the PAM boundary end to end and exits non-zero if anything fails:
#
#   PostgreSQL -> helix-ldap -> SSSD/NSS -> sshd -> PAM -> pam_helix.so
#                -> /run/helix/authd/auth.sock -> helix-authd -> uid 200001
#
# Authentication itself is still a stub in this phase; what is proven here is the
# boundary, the Unix identity, and that every failure path denies.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GO_IMAGE=golang:1.26-bookworm
DEVICE_GO=../../linux/device/go
METHOD_PROMPT='method \[online/offline/persistent\]'

source ../lib/e2e-checks.sh

# login drives a keyboard-interactive SSH login over a PTY, answering the method
# prompt. It returns ssh's own exit status.
login() {
    local user="$1" answer="${2:-online}"
    docker compose exec -T ssh-client ssh-login "${user}@device" \
        --answer "${METHOD_PROMPT}=${answer}" --timeout 45
}

# login_with drives a login with an explicit authentication preference, to prove
# the methods sshd must refuse really are refused.
login_with() {
    local prefer="$1"
    docker compose exec -T ssh-client ssh \
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o BatchMode=yes -o ConnectTimeout=10 \
        -o "PreferredAuthentications=${prefer}" \
        alice@device true
}

on_device() { docker compose exec -T device "$@"; }

diagnostics() {
    section "DIAGNOSTICS"
    echo "--- docker compose ps ---";      docker compose ps 2>&1
    echo "--- device logs (tail) ---";     docker compose logs --tail=60 device 2>&1
    echo "--- helix-authd log (tail) ---"; on_device tail -n 60 /var/log/helix-authd.log 2>&1
    echo "--- helix-ldap logs (tail) ---"; docker compose logs --tail=30 helix-ldap 2>&1
    echo "--- sshd effective config ---";  on_device /usr/sbin/sshd -T 2>&1 | sort
    echo "--- /etc/pam.d/sshd ---";        on_device cat /etc/pam.d/sshd 2>&1
    echo "--- nsswitch ---";               on_device grep -E '^(passwd|group|shadow):' /etc/nsswitch.conf 2>&1
    echo "--- auth socket ---";            on_device ls -la /run/helix/authd/ 2>&1
}

########################################################################
section "Phase 0 — build"
########################################################################
docker compose down -v --remove-orphans >/dev/null 2>&1
docker compose build || die "docker compose build failed"

########################################################################
section "Phase 1 — Go unit tests for the protocol and the daemon"
########################################################################
if docker run --rm \
    -v "$(cd "$DEVICE_GO" && pwd)":/src -w /src \
    -v helix-authd-gomod:/go/pkg/mod -v helix-authd-gobuild:/root/.cache/go-build \
    "$GO_IMAGE" go test ./internal/authproto/... ./internal/authd/... 2>&1; then
    pass "go test ./internal/authproto/... ./internal/authd/..."
else
    fail "go test ./internal/authproto/... ./internal/authd/..."
fi

########################################################################
section "Phase 2 — the device boots with LDAP identity"
########################################################################
docker compose up -d 2>&1 | tail -3
wait_healthy postgres 90   || die "postgres never became healthy"
wait_healthy helix-ldap 90 || die "helix-ldap never became healthy"
wait_healthy device 180    || die "device never became healthy"
wait_healthy ssh-client 60 || die "ssh-client never started"
pass "device starts with SSSD, helix-authd and sshd"

# The identity path from HELIX-216 must not regress.
check_match "getent passwd alice still resolves" '^alice:[x*]:200001:200001:' -- on_device getent passwd alice
check_match "getent passwd 200001 still resolves" '^alice:[x*]:200001:' -- on_device getent passwd 200001
check_match "id alice still reports 200001" 'uid=200001\(alice\) gid=200001\(alice\)' -- on_device id alice
check_match "getent group alice still resolves" '^alice:[x*]:200001:' -- on_device getent group alice
check_match "bob still resolves" '^bob:[x*]:200002:200002:' -- on_device getent passwd bob

check_match "the PAM socket is root-only" '^srw-------.*root.*root' -- on_device stat -c '%A %U %G' /run/helix/authd/auth.sock
check_match "the socket directory is root-only" '^drwx------' -- on_device stat -c '%A' /run/helix/authd

########################################################################
section "Phase 3 — sshd offers PAM keyboard-interactive and nothing else"
########################################################################
check_match "sshd config is valid" '' -- on_device /usr/sbin/sshd -t
check_match "UsePAM is on" '^usepam yes' -- on_device /usr/sbin/sshd -T
check_match "keyboard-interactive is on" '^kbdinteractiveauthentication yes' -- on_device /usr/sbin/sshd -T
check_match "password authentication is off" '^passwordauthentication no' -- on_device /usr/sbin/sshd -T
check_match "public-key authentication is off" '^pubkeyauthentication no' -- on_device /usr/sbin/sshd -T
check_match "root login is off" '^permitrootlogin no' -- on_device /usr/sbin/sshd -T
check_match "only keyboard-interactive:pam is accepted" '^authenticationmethods keyboard-interactive:pam' -- on_device /usr/sbin/sshd -T

check_match "the PAM stack uses pam_helix" '^auth[[:space:]]+requisite[[:space:]]+pam_helix\.so' -- on_device cat /etc/pam.d/sshd
check_nomatch "the PAM stack has no pam_unix fallback" 'pam_unix\.so' -- on_device cat /etc/pam.d/sshd
check_nomatch "the PAM stack does not authenticate through SSSD" 'pam_sss\.so' -- on_device cat /etc/pam.d/sshd

########################################################################
section "Phase 4 — a real login through PAM lands as the right Unix user"
########################################################################
on_device set-stub-decision approve >/dev/null || die "could not configure the stub authenticator"

check_match "alice authenticates through PAM" 'HELIX_AUTH_OK' -- login alice
check_match "alice's session runs as uid 200001" 'uid=200001' -- login alice
check_match "alice's session runs as gid 200001" 'gid=200001' -- login alice
check_match "alice's session runs as alice" 'user=alice' -- login alice
check_match "the method prompt reaches a stock OpenSSH client" "$METHOD_PROMPT" -- login alice
check_match "bob authenticates and lands as uid 200002" 'uid=200002' -- login bob

########################################################################
section "Phase 5 — every other path denies"
########################################################################
check_fail "an unknown method is refused" -- login alice "sudo-please"
check_fail "an unknown Unix user cannot authenticate" -- login nosuchuser
check_fail "password authentication cannot succeed" -- login_with password
check_fail "public-key authentication cannot bypass PAM" -- login_with publickey

on_device set-stub-decision deny >/dev/null || die "could not switch the stub authenticator to deny"
check_fail "a denied decision refuses the login" -- login alice
check_nomatch "a denied login runs no command" 'HELIX_AUTH_OK' -- login alice
on_device set-stub-decision approve >/dev/null || die "could not restore the stub authenticator"

########################################################################
section "Phase 6 — sshd fails closed without the authentication engine"
########################################################################
on_device stop-authd >/dev/null || die "could not stop helix-authd"
check_fail "no login is possible while helix-authd is down" -- login alice
check_nomatch "no session starts while helix-authd is down" 'HELIX_AUTH_OK' -- login alice
check_fail "the socket is really gone" -- on_device test -S /run/helix/authd/auth.sock

on_device set-stub-decision approve >/dev/null || die "could not restart helix-authd"
if retry_until 30 -- bash -c 'docker compose exec -T device test -S /run/helix/authd/auth.sock'; then
    pass "helix-authd comes back and the socket is restored"
else
    fail "helix-authd comes back and the socket is restored"
fi
check_match "login works again once the engine returns" 'HELIX_AUTH_OK' -- login alice

########################################################################
section "Phase 7 — secrets stay out of the logs"
########################################################################
check_nomatch "the daemon never logs a prompt response" 'sudo-please' -- on_device cat /var/log/helix-authd.log
check_match "the daemon logs the decision for every attempt" 'authentication finished' -- on_device cat /var/log/helix-authd.log

########################################################################
print_summary

printf '\nPostgreSQL -> LDAP -> SSSD -> sshd -> PAM -> helix-authd is proven end to end.\n'
printf 'Try it yourself: docker compose exec ssh-client ssh alice@device\n'
