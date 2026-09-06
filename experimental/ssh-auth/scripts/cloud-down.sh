#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Tears down the lab cloud: the app process and its throwaway database.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
GENERATED="$PWD/generated"
CLOUD_PORT="${CLOUD_PORT:-3200}"

if [[ -f "$GENERATED/cloud.pid" ]]; then
    pkill -P "$(cat "$GENERATED/cloud.pid")" 2>/dev/null || true
    kill "$(cat "$GENERATED/cloud.pid")" 2>/dev/null || true
    rm -f "$GENERATED/cloud.pid"
fi
pkill -f "next.*--port ${CLOUD_PORT}" 2>/dev/null || true

docker rm -f helix-authlab-db >/dev/null 2>&1 || true
echo "[cloud] stopped"
