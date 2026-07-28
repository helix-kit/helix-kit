#!/usr/bin/env bash
# =============================================================================
# deploy.sh — install freshly-uploaded app bundles on the appliance host.
#
# Runs ON the EC2 box, invoked over SSH by .github/workflows/build-deploy.yml.
# CI has already done everything expensive (pnpm install, turbo build, zipping);
# this only unpacks, restarts and health-checks. It never builds.
#
# The unit of deployment is a ZIP BUNDLE, not a container image: CI scp's
#   helix-cloud-app-<version>.zip   (the Next app: site + docs + blog + console)
#   helix-server-<version>.zip      (the device-facing gateway)
# into the staging dir, and this installs them with the same install-bundles.sh
# the appliance uses at first boot. The swap is a symlink flip, so rolling back
# is just repointing `current` at the previous version (install-bundles keeps 3).
#
# MIGRATIONS ARE NOT RUN HERE. drizzle-kit is a devDependency and is not in the
# standalone bundle, so schema changes are still applied out-of-band:
#   pnpm --filter helix db:migrate   (over an SSH tunnel to the box's Postgres)
# A deploy carrying a schema change must therefore be migrated first. This
# matches how the appliance has always worked; it is a known gap, not an
# oversight of this script.
#
# Usage (from CI):  deploy.sh <version>
# =============================================================================
set -euo pipefail

VERSION="${1:?usage: deploy.sh <version>}"
STAGING="${HELIX_STAGING_DIR:-$HOME/helix-staging}"
# The merged app serves the marketing home at `/`, so that is a real readiness
# probe for the whole thing (before the merge, `/` 404'd and there was nothing
# cheap to poll).
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
# helix-server first: it owns the device-facing listeners (MQTT bridge, mTLS
# data plane) and the app depends on none of its in-flight state, so the shorter
# the window where they disagree about the release, the better.
sudo systemctl restart helix-helix-server
sudo systemctl restart helix-app

log "Waiting for the app"
for attempt in $(seq 1 "${HEALTH_TIMEOUT_SECONDS}"); do
  if curl -fsS --max-time 3 -o /dev/null "${HEALTH_URL}"; then
    log "Healthy after ${attempt}s — ${VERSION} is live"
    # Keep the staging dir from growing without bound across deploys.
    find "${STAGING}" -name '*.zip' -mtime +7 -delete 2>/dev/null || true
    exit 0
  fi
  sleep 1
done

echo "app did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s" >&2
systemctl is-active helix-app helix-helix-server || true
sudo journalctl -u helix-app -n 40 --no-pager || true
exit 1
