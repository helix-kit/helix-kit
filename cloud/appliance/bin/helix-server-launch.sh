#!/bin/sh
# ExecStart for helix-server.service. By default helix-server runs one process
# with all data-plane roles (gateway + ingest + writer). When role-splitting is
# enabled (HELIX_SERVER_ROLES_SPLIT truthy in site.env) this primary unit runs
# only the gateway role — keeping the service name, ports (4000/4001) and health
# endpoint stable for dependents — while helix-server-ingest.service and
# helix-server-writer.service run the other two roles on separate cores.
#
# An explicit HELIX_SERVER_ROLES always wins, so an operator can still pin this
# unit to any subset by hand.
set -eu

if [ "${HELIX_SERVER_ROLES_SPLIT:-0}" != "0" ] && [ -z "${HELIX_SERVER_ROLES:-}" ]; then
  export HELIX_SERVER_ROLES=gateway
fi

# DBOS workflow mode: the durable engine runs in-process (checkpoints to the app
# Postgres' `dbos` schema) instead of the self-hosted Inngest unit. It follows
# DATABASE_URL, so default the system-database URL to it, and migrate the DBOS
# system schema once before launch (idempotent; a fresh dispatch process finds
# the schema ready and skips the DDL). Set HELIX_WORKFLOW_MODE=dbos in site.env
# together with a HELIX_SERVER_ROLES that includes `dispatch`.
if [ "${HELIX_WORKFLOW_MODE:-}" = "dbos" ]; then
  : "${DBOS_SYSTEM_DATABASE_URL:=${DATABASE_URL}}"
  export DBOS_SYSTEM_DATABASE_URL
  export HELIX_DBOS_SCHEMA="${HELIX_DBOS_SCHEMA:-dbos}"
  HELIX_DBOS_MIGRATE=1 /usr/bin/node dist/index.js
fi

exec /usr/bin/node dist/index.js
