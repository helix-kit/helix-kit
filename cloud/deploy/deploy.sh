#!/usr/bin/env bash
# Install freshly-uploaded app ZIP bundles on the appliance host (runs on the EC2
# box over SSH from CI): unpack, restart, health-check. Never builds.
# Migrations are NOT run here — schema changes must be applied out-of-band first
# (pnpm --filter helix db:migrate over an SSH tunnel to the box's Postgres).
# Usage (from CI):  deploy.sh <version>
set -euo pipefail

VERSION="${1:?usage: deploy.sh <version>}"
STAGING="${HELIX_STAGING_DIR:-$HOME/helix-staging}"
HEALTH_URL="${HELIX_HEALTHCHECK_URL:-http://127.0.0.1:3000/}"
HEALTH_TIMEOUT_SECONDS=60

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

log "Installing bundles (version ${VERSION})"
shopt -s nullglob
bundles=("${STAGING}"/*-"${VERSION}".zip)
if [ ${#bundles[@]} -eq 0 ]; then
  echo "no bundles matching *-${VERSION}.zip in ${STAGING}" >&2
  exit 1
fi
for zip in "${bundles[@]}"; do
  echo "  $(basename "${zip}")"
  sudo /opt/helix/bin/install-bundles.sh "${zip}"
done
sudo chown -R helix:helix /opt/helix/apps

log "Restarting helix-server + app"
# helix-server first: it owns the device-facing listeners, so keep the window
# where the two disagree about the release short.
sudo systemctl restart helix-helix-server
sudo systemctl restart helix-app

log "Waiting for the app"
for attempt in $(seq 1 "${HEALTH_TIMEOUT_SECONDS}"); do
  if curl -fsS --max-time 3 -o /dev/null "${HEALTH_URL}"; then
    log "Healthy after ${attempt}s — ${VERSION} is live"
    find "${STAGING}" -name '*.zip' -mtime +7 -delete 2>/dev/null || true
    exit 0
  fi
  sleep 1
done

echo "app did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
systemctl is-active helix-app helix-helix-server || true
sudo journalctl -u helix-app -n 40 --no-pager || true
exit 1
