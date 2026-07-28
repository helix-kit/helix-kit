#!/usr/bin/env bash
# Drive one custom firmware build against the mock backend and print the result.
# Usage: ./try-build.sh '[optional JSON config]'
set -euo pipefail

MOCK=${MOCK:-http://localhost:9099}
FAKE=${FAKE:-false}
DEFAULT_CONFIG='{"profileName":"custom-no-ble","apps":["gpio_control","status_display"],"features":["no-ble"],"set":{"CONFIG_DEVICE_FIRMWARE_VERSION":"\"1.0.0-custom\""},"chip":"esp32","flashSize":"4MB"}'
CONFIG=${1:-$DEFAULT_CONFIG}

echo "config: $CONFIG (fake=$FAKE)"
BID=$(curl -sS -X POST "$MOCK/builds" -H 'content-type: application/json' \
  -d "{\"config\":$CONFIG,\"fake\":$FAKE}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["buildId"])')
echo "build id: $BID"

while true; do
  RESP=$(curl -sS "$MOCK/builds/$BID")
  STATUS=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
  echo "status: $STATUS"
  case "$STATUS" in
    success|failed|dispatch-failed)
      printf '%s' "$RESP" | python3 -m json.tool
      break
      ;;
  esac
  sleep 4
done
