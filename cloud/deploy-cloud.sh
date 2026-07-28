#!/usr/bin/env bash
# Deploy (or redeploy) the Helix cloud stack on the EC2 host using the
# GHCR images published by CI. Idempotent: safe to run repeatedly.
#
# Expects cloud/.env to define the GHCR image references
# (HELIX_CLOUD_APP_IMAGE, HELIX_CLOUD_INIT_IMAGE, HELIX_SERVER_IMAGE) plus
# the runtime configuration. The host's Docker must be logged in to ghcr.io.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ ! -f .env ]; then
  echo "cloud/.env not found in ${SCRIPT_DIR}" >&2
  exit 1
fi

COMPOSE=(
  docker compose
  -f docker-compose.yml
  --env-file .env
)

# Backing services the cloud apps depend on.
INFRA_SERVICES=(
  postgres
  openfga
  redpanda
  inngest-postgres
  inngest-redis
  inngest
  inngest-cleanup
  turbo-cache
  mosquitto
  step-ca
)

# Web apps that are deployed from prebuilt GHCR images.
CLOUD_SERVICES=(
  helix
  helix-server
)

echo "==> Ensuring backing services are up"
"${COMPOSE[@]}" up -d "${INFRA_SERVICES[@]}"

echo "==> Pulling cloud images from GHCR"
"${COMPOSE[@]}" pull helix-init "${CLOUD_SERVICES[@]}"

echo "==> Running database migrations (helix-init)"
"${COMPOSE[@]}" run --rm --no-deps helix-init

echo "==> Deploying cloud services"
# --no-deps keeps this scoped to the app containers so the backing services
# (already ensured up above) are left untouched. `up -d` still only recreates
# the cloud containers whose image changed in the pull above.
"${COMPOSE[@]}" up -d --no-deps "${CLOUD_SERVICES[@]}"

# Register the workflow app's functions with the self-hosted Inngest server.
# The PUT is issued from inside the app container so the serve URL Inngest
# records is the docker-internal host it can actually call back.
echo "==> Syncing the workflow app with Inngest"
synced=0
for attempt in 1 2 3 4 5 6 7 8; do
  if "${COMPOSE[@]}" exec -T helix node -e "
fetch('http://helix:3000/api/plugins/inngest', { method: 'PUT' })
  .then((response) => {
    if (!response.ok) {
      console.error('sync status', response.status);
      process.exit(1);
    }
    console.log('inngest sync ok', response.status);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
"; then
    synced=1
    break
  fi
  echo "   sync attempt ${attempt} failed; waiting for app to be ready..."
  sleep 8
done
if [ "${synced}" -ne 1 ]; then
  echo "WARNING: Inngest app sync did not succeed; check /api/plugins/inngest" >&2
fi

echo "==> Cloud stack status"
"${COMPOSE[@]}" ps "${INFRA_SERVICES[@]}" "${CLOUD_SERVICES[@]}"

# Reclaim disk by removing images no container references anymore (old image
# tags replaced by the pull above, plus any previously locally-built services).
echo "==> Pruning stale images"
docker image prune -af >/dev/null 2>&1 || true

echo "==> Deploy complete"
