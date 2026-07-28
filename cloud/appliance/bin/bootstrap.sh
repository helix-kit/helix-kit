#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — one-time data-plane bootstrap (helix-bootstrap.service).
#
# Runs AFTER postgres + openfga + redpanda are up and the app bundles are
# installed, and BEFORE the cloud app + workers start. Each step is idempotent.
#
#   1. Create the helix + inngest roles/databases.
#   2. Create the redpanda device-events topic.
#   3. Run drizzle migrations (cloud-init bundle).
#   4. Seed the first sysadmin (if LOCAL_SYSADMIN_* provided and not already set).
#
# Env comes from the EnvironmentFile= lines on the unit (internal/secrets/site).
# =============================================================================
set -euo pipefail

INIT_DIR=/opt/helix/apps/helix-cloud-init/current

# Roles + databases are created earlier by pg-roles.service (openfga/inngest
# need them before this point), so this script starts at the topic + migrations.

# ---- 1. redpanda device-events topic ---------------------------------------
echo "bootstrap: ensuring redpanda topic ${EVENT_QUEUE_TOPIC}"
rpk topic create "${EVENT_QUEUE_TOPIC}" -X brokers=127.0.0.1:9092 2>/dev/null || true

# ---- 2. drizzle migrations --------------------------------------------------
# The cloud-init bundle (dist/cli/migrate.js) is optional: when it isn't shipped,
# migrations are applied externally against the mapped Postgres (host runs
# `pnpm --filter helix db:migrate`), so don't fail the boot for a missing bundle.
if [[ -f "${INIT_DIR}/dist/cli/migrate.js" ]]; then
  echo "bootstrap: running migrations"
  ( cd "${INIT_DIR}" && node dist/cli/migrate.js )
else
  echo "bootstrap: no cloud-init bundle; migrations applied externally"
fi

# ---- 3. seed first sysadmin -------------------------------------------------
if [[ -n "${LOCAL_SYSADMIN_EMAIL:-}" && -n "${LOCAL_SYSADMIN_PASSWORD:-}" &&
      -f "${INIT_DIR}/dist/cli/seed-sysadmin.js" ]]; then
  echo "bootstrap: seeding sysadmin ${LOCAL_SYSADMIN_EMAIL}"
  ( cd "${INIT_DIR}" && node dist/cli/seed-sysadmin.js ) || \
    echo "bootstrap: seed-sysadmin skipped/failed (may already exist)"
fi

echo "bootstrap: complete"
