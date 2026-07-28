#!/usr/bin/env bash
# Orchestrate one remote appliance load test: truncate the measurement tables,
# run the load driver (on the GEN box) and the appliance sampler (from here)
# concurrently, and print both results.
#
# Env (override as needed):
#   PEM      path to the SSH key         (default: ~/Downloads/Helix Kit Admin.pem)
#   AUT      ubuntu@<appliance-host>     (required)
#   GEN      ubuntu@<load-gen-host>      (required)
#   REPO     repo root (for sample_remote.py) (default: this repo)
#   CTR      appliance container name    (default: helix-appliance)
#
# Usage: AUT=ubuntu@1.2.3.4 GEN=ubuntu@5.6.7.8 run_remote_test.sh <name> <duration> <harness-args...>
#   e.g. run_remote_test.sh mqtt-500 25 mqtt --host <priv> --port 8883 \
#          --certs '~/helix-certs' --rate 500 --duration 25 --workers 10 --devices 50
set -u
PEM="${PEM:-$HOME/Downloads/Helix Kit Admin.pem}"
AUT="${AUT:?set AUT=ubuntu@<appliance-host>}"
GEN="${GEN:?set GEN=ubuntu@<load-gen-host>}"
CTR="${CTR:-helix-appliance}"
REPO="${REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}"
NAME="$1"; DUR="$2"; shift 2

echo "############ TEST: $NAME (duration=${DUR}s) ############"
ssh -i "$PEM" -o StrictHostKeyChecking=no "$AUT" \
  "sudo docker exec -i $CTR bash -lc 'set -a; . /var/lib/helix/env/secrets.env; . /var/lib/helix/env/internal.env; set +a; psql \"\$DATABASE_URL\" -c \"truncate device_event; truncate workflow_run_result;\"'" >/dev/null 2>&1

python3 "$REPO/tooling/loadtest/sample_remote.py" --ssh-host "$AUT" --pem "$PEM" \
  --duration "$((DUR+4))" --interval 3 > /tmp/lt_sample.json 2>/tmp/lt_sample.err &
SPID=$!
sleep 1
ssh -i "$PEM" -o StrictHostKeyChecking=no "$GEN" \
  "~/lt-venv/bin/python ~/remote_harness.py $*" > /tmp/lt_load.json 2>/tmp/lt_load.err
echo "--- LOAD ---"; cat /tmp/lt_load.json 2>/dev/null || cat /tmp/lt_load.err
wait $SPID
echo "--- APPLIANCE ---"; cat /tmp/lt_sample.json 2>/dev/null || cat /tmp/lt_sample.err
echo
