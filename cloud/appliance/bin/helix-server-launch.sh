#!/bin/sh
# ExecStart for helix-server.service. Default: one process with all data-plane roles.
# With HELIX_SERVER_ROLES_SPLIT this unit runs only the gateway role (sibling units run
# ingest/writer). An explicit HELIX_SERVER_ROLES always wins.
set -eu

if [ "${HELIX_SERVER_ROLES_SPLIT:-0}" != "0" ] && [ -z "${HELIX_SERVER_ROLES:-}" ]; then
  export HELIX_SERVER_ROLES=gateway
fi

# DBOS workflow mode: durable engine runs in-process (checkpoints to Postgres' `dbos`
# schema). Default the system-DB URL to DATABASE_URL and migrate the schema once (idempotent).
if [ "${HELIX_WORKFLOW_MODE:-}" = "dbos" ]; then
  : "${DBOS_SYSTEM_DATABASE_URL:=${DATABASE_URL}}"
  export DBOS_SYSTEM_DATABASE_URL
  export HELIX_DBOS_SCHEMA="${HELIX_DBOS_SCHEMA:-dbos}"
  HELIX_DBOS_MIGRATE=1 /usr/bin/node dist/index.js
fi

exec /usr/bin/node dist/index.js
