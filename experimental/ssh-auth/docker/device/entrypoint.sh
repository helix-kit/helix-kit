#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Brings up the device: identity (SSSD), the authentication engine (helix-authd),
# then sshd in the foreground as PID 1.
set -euo pipefail

log() { echo "[device] $*"; }

# SSSD refuses to start unless its config is root-owned and unreadable by others.
install -o root -g root -m 0600 /etc/sssd/sssd.conf /etc/sssd/sssd.conf.tmp
mv /etc/sssd/sssd.conf.tmp /etc/sssd/sssd.conf
rm -rf /var/lib/sss/db/* /var/lib/sss/mc/*

log "starting sssd"
sssd --logger=files --debug-level="${SSSD_DEBUG_LEVEL:-2}"

log "waiting for NSS to resolve the seeded identities"
for i in $(seq 1 60); do
    if getent passwd alice >/dev/null 2>&1; then
        break
    fi
    if [ "$i" = 60 ]; then
        log "FATAL: alice never resolved through NSS"
        exit 1
    fi
    sleep 1
done
log "identity ready: $(getent passwd alice)"

# helix-authd owns the PAM socket. sshd fails closed if it is not there, which is
# itself a tested behaviour, so this is started but not treated as fatal.
if [ "${HELIX_AUTHD_ENABLED:-true}" = "true" ]; then
    log "starting helix-authd"
    helix-authd >/var/log/helix-authd.log 2>&1 &
    for i in $(seq 1 30); do
        if [ -S /run/helix/authd/auth.sock ]; then
            break
        fi
        sleep 0.5
    done
    if [ -S /run/helix/authd/auth.sock ]; then
        log "helix-authd socket ready: $(stat -c '%A %U:%G' /run/helix/authd/auth.sock)"
    else
        log "WARNING: helix-authd socket did not appear; authentication will fail closed"
    fi
else
    log "helix-authd disabled by HELIX_AUTHD_ENABLED=false (fail-closed test)"
fi

mkdir -p /run/sshd
ssh-keygen -A >/dev/null

log "validating sshd configuration"
/usr/sbin/sshd -t

log "starting sshd"
exec /usr/sbin/sshd -D -e
