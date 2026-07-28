#!/usr/bin/env bash
# =============================================================================
# pg-prepare.sh — initialise the Postgres data dir on the volume (ExecStartPre
# of helix-postgres.service). Idempotent: only runs initdb on an empty volume.
# One cluster hosts BOTH the app DB (helix) and the inngest DB.
# =============================================================================
set -euo pipefail

PGDATA=/var/lib/helix/postgres
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"

mkdir -p "${PGDATA}"
chown -R postgres:postgres /var/lib/helix/postgres
chmod 700 "${PGDATA}"

# Unix socket dir (on tmpfs /run) — local trust auth uses this; recreate each boot.
install -d -o postgres -g postgres -m 2775 /var/run/postgresql

if [[ ! -f "${PGDATA}/PG_VERSION" ]]; then
  echo "pg-prepare: initialising new cluster at ${PGDATA}"
  su postgres -s /bin/bash -c "${PGBIN}/initdb -D '${PGDATA}' --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8"
  # Listen on loopback only — everything that talks to PG is in this container.
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
    echo "max_connections = 200"
    echo "unix_socket_directories = '/var/run/postgresql'"
  } >> "${PGDATA}/postgresql.conf"
  {
    echo "host all all 127.0.0.1/32 scram-sha-256"
    echo "host all all ::1/128     scram-sha-256"
  } >> "${PGDATA}/pg_hba.conf"
fi
