#!/usr/bin/env bash
# Hourly retention sweep for the self-hosted Inngest observability tables.
# Runs DELETEs only (see inngest-cleanup.sql) — autovacuum reclaims the space
# for reuse, which bounds table growth. Connection params come from PG* env vars.
set -uo pipefail

INTERVAL="${CLEANUP_INTERVAL_SECONDS:-3600}"
echo "inngest-cleanup: retention sweep every ${INTERVAL}s (run history kept 7d; spans/history 24h)"

while true; do
  echo "[$(date -u +%FT%TZ)] inngest-cleanup: starting sweep"
  if psql -v ON_ERROR_STOP=1 -f /cleanup.sql; then
    echo "[$(date -u +%FT%TZ)] inngest-cleanup: sweep complete"
  else
    echo "[$(date -u +%FT%TZ)] inngest-cleanup: sweep FAILED"
  fi
  sleep "${INTERVAL}"
done
