#!/bin/sh
# ExecCondition for helix-server-ingest.service / helix-server-writer.service.
# Exit 0 (run the unit) only when role-splitting is enabled; otherwise exit 1 so
# systemd skips the unit (a failed ExecCondition is a skip, not a failure). This
# keeps the default appliance running a single all-roles helix-server process.
[ "${HELIX_SERVER_ROLES_SPLIT:-0}" != "0" ]
