#!/usr/bin/env bash
# One-time data-plane bootstrap (helix-bootstrap.service): redpanda topic, drizzle
# migrations, and first-sysadmin seed. Runs after postgres/openfga/redpanda are up
# and before the cloud app starts; each step is idempotent.
set -euo pipefail

INIT_DIR=/opt/helix/apps/helix-cloud-init/current

# Roles + databases are created earlier by pg-roles.service.

echo "bootstrap: ensuring redpanda topic ${EVENT_QUEUE_TOPIC}"
rpk topic create "${EVENT_QUEUE_TOPIC}" -X brokers=127.0.0.1:9092 2>/dev/null || true

# The cloud-init migrate bundle is optional: when absent, migrations are applied
# externally against the mapped Postgres, so don't fail the boot for a missing bundle.
if [[ -f "${INIT_DIR}/dist/cli/migrate.js" ]]; then
  echo "bootstrap: running migrations"
  ( cd "${INIT_DIR}" && node dist/cli/migrate.js )
else
  echo "bootstrap: no cloud-init bundle; migrations applied externally"
fi

if [[ -n "${LOCAL_SYSADMIN_EMAIL:-}" && -n "${LOCAL_SYSADMIN_PASSWORD:-}" &&
      -f "${INIT_DIR}/dist/cli/seed-sysadmin.js" ]]; then
  echo "bootstrap: seeding sysadmin ${LOCAL_SYSADMIN_EMAIL}"
  ( cd "${INIT_DIR}" && node dist/cli/seed-sysadmin.js ) || \
    echo "bootstrap: seed-sysadmin skipped/failed (may already exist)"
fi

echo "bootstrap: complete"
