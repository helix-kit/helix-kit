#!/bin/sh
# ExecCondition for the split ingest/writer units: exit 0 (run) only when role-splitting
# is enabled, else exit 1 so systemd skips the unit (a failed ExecCondition is a skip).
[ "${HELIX_SERVER_ROLES_SPLIT:-0}" != "0" ]
