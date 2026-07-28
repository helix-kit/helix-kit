#!/usr/bin/env bash
# =============================================================================
# pg-roles.sh — create the helix + inngest roles/databases. Runs as a oneshot
# AFTER postgres is up and BEFORE openfga / inngest / bootstrap, because those
# all connect to (or migrate into) these databases. Idempotent.
# =============================================================================
set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres"

until pg_isready -h /var/run/postgresql -q; do sleep 1; done

ensure_role_db() {
  local user="$1" pass="$2" db="$3"
  ${PSQL} -tc "SELECT 1 FROM pg_roles WHERE rolname='${user}'" | grep -q 1 || \
    ${PSQL} -c "CREATE ROLE \"${user}\" LOGIN PASSWORD '${pass}'"
  ${PSQL} -c "ALTER ROLE \"${user}\" PASSWORD '${pass}'"
  ${PSQL} -tc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 || \
    ${PSQL} -c "CREATE DATABASE \"${db}\" OWNER \"${user}\""
}

echo "pg-roles: ensuring roles + databases"
ensure_role_db "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" "${POSTGRES_DB}"
ensure_role_db "${INNGEST_POSTGRES_USER}" "${INNGEST_POSTGRES_PASSWORD}" "${INNGEST_POSTGRES_DB}"
echo "pg-roles: done"
