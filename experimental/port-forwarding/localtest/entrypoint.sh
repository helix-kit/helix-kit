#!/bin/sh
# Runs the local Python web app and the Helix port-forwarding agent together in
# one container, exactly the acceptance-test setup: the device exposes nothing
# inbound; the agent dials the cloud gateway outbound and forwards to the app.
set -e

: "${SESSION_ID:=demo}"
: "${APP_PORT:=8000}"
: "${GATEWAY_URL:=wss://connect.port.helix-kit.com/__tunnel__}"

echo "[entrypoint] starting python app on :${APP_PORT}"
APP_PORT="${APP_PORT}" python3 /app/server.py &
APP_PID=$!

# Give the app a moment to bind.
sleep 1

echo "[entrypoint] starting agent session=${SESSION_ID} -> 127.0.0.1:${APP_PORT}"
exec /usr/local/bin/port-agent \
  -gateway "${GATEWAY_URL}" \
  -session "${SESSION_ID}" \
  -target "127.0.0.1:${APP_PORT}"
