#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Runs SSSD in the foreground as PID 1. No systemd: the point of the experiment
# is NSS -> SSSD -> LDAP, not service-manager integration.
set -euo pipefail

# SSSD refuses to start unless its config is root-owned and unreadable by others.
install -o root -g root -m 0600 /etc/sssd/sssd.conf /etc/sssd/sssd.conf.tmp
mv /etc/sssd/sssd.conf.tmp /etc/sssd/sssd.conf

# A stale cache from a previous container start would mask real lookups.
rm -rf /var/lib/sss/db/* /var/lib/sss/mc/*

mkdir -p /var/log/sssd

echo "nsswitch passwd/group lines:"
grep -E '^(passwd|group|shadow):' /etc/nsswitch.conf

exec sssd --interactive --logger=stderr --debug-level="${SSSD_DEBUG_LEVEL:-2}"
