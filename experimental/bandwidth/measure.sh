#!/usr/bin/env bash
# Reconcile per-session tunnel bandwidth against the EC2's real NIC counters.
#
# Two independent layers:
#   1. EC2 ens5 byte counters (ground truth = what AWS meters / network limit)
#   2. gateway per-session payload counters (/__helixstats__)
# A known-size workload ties them together and yields the overhead multiplier.
#
# Config (env):
#   EC2_KEY   path to the SSH key (default: "~/Downloads/Helix Kit Admin.pem")
#   EC2_HOST  ubuntu@<ec2-host>
#
# Commands:
#   measure.sh idle <secs>              # ens5 delta over N s (baseline)
#   measure.sh port <url> [<curl-args>] # download <url> through a tunnel, reconcile
#   measure.sh shell <bytes>            # stream <bytes> of PTY output, reconcile
set -euo pipefail

EC2_KEY="${EC2_KEY:-$HOME/Downloads/Helix Kit Admin.pem}"
EC2_HOST="${EC2_HOST:-ubuntu@ec2-15-207-108-147.ap-south-1.compute.amazonaws.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -i "$EC2_KEY" "$EC2_HOST")

nic_snapshot() { "${SSH[@]}" '~/helix-experimental/bandwidth/netmon.sh snapshot'; }
port_stats()   { "${SSH[@]}" 'docker exec deploy-port-gateway-1 wget -qO- http://localhost:9000/__helixstats__ 2>/dev/null'; }
shell_stats()  { "${SSH[@]}" 'docker exec deploy-shell-gateway-1 wget -qO- http://localhost:9100/__helixstats__ 2>/dev/null'; }

reconcile() { # rx0 tx0 rx1 tx1 payload
  python3 - "$@" <<'PY'
import sys
rb0,tb0,rb1,tb1,pay=map(int,sys.argv[1:6])
drx,dtx=rb1-rb0,tb1-tb0; mib=1048576
print(f"  payload            : {pay:,} B ({pay/mib:.2f} MiB)")
print(f"  ens5 rx (ingress)  : {drx:,} B ({drx/mib:.2f} MiB)  [from device leg, free]")
print(f"  ens5 tx (egress)   : {dtx:,} B ({dtx/mib:.2f} MiB)  [to viewer, BILLABLE]")
print(f"  ens5 total on wire : {drx+dtx:,} B ({(drx+dtx)/mib:.2f} MiB)")
if pay:
  print(f"  egress / payload   : {dtx/pay:.4f}x")
  print(f"  total  / payload   : {(drx+dtx)/pay:.4f}x")
PY
}

case "${1:-}" in
  idle)
    "${SSH[@]}" "~/helix-experimental/bandwidth/netmon.sh sample ${2:-30}"
    ;;
  port)
    url="${2:?usage: measure.sh port <url>}"; shift 2
    read -r rb0 tb0 _ _ _ _ <<<"$(nic_snapshot)"
    dl=$(curl -s -o /dev/null -w '%{size_download}' "$url" --max-time 300 "$@")
    read -r rb1 tb1 _ _ _ _ <<<"$(nic_snapshot)"
    echo "port tunnel download:"; reconcile "$rb0" "$tb0" "$rb1" "$tb1" "$dl"
    ;;
  shell)
    n="${2:-20971520}"
    read -r rb0 tb0 _ _ _ _ <<<"$(nic_snapshot)"
    out=$(N="$n" node "$HERE/shell-load.mjs"); echo "  client: $out"
    read -r rb1 tb1 _ _ _ _ <<<"$(nic_snapshot)"
    recv=$(echo "$out" | python3 -c 'import sys,json;print(json.load(sys.stdin)["receivedBytes"])')
    echo "shell output stream:"; reconcile "$rb0" "$tb0" "$rb1" "$tb1" "$recv"
    ;;
  *)
    echo "usage: measure.sh {idle <secs>|port <url>|shell <bytes>}" >&2; exit 1
    ;;
esac
