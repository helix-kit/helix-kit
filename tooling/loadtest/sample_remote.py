#!/usr/bin/env python3
"""Sample a remote Helix appliance's resource usage + backend progress under load."""

from __future__ import annotations

import argparse
import json
import subprocess

REMOTE_COUNTERS = r"""
sudo docker exec helix-appliance bash -lc '
set -a; . /var/lib/helix/env/secrets.env; . /var/lib/helix/env/internal.env; set +a
DE=$(psql "$DATABASE_URL" -tAc "select count(*) from device_event" 2>/dev/null || echo 0)
WF=$(psql "$DATABASE_URL" -tAc "select count(*) from workflow_run_result" 2>/dev/null || echo 0)
LAG=$(rpk group describe helix-workflow-dispatch -X brokers=127.0.0.1:9092 2>/dev/null \
  | awk "/helix.device-events/ {sum+=\$6} END {print sum+0}")
echo "$DE $WF $LAG"
'
"""

REMOTE_SAMPLE_LOOP = r"""
N=__N__; IV=__IV__
for i in $(seq 1 $N); do
  MU=$(free -m | awk '/Mem:/{print $3}')
  AV=$(free -m | awk '/Mem:/{print $7}')
  ST=$(sudo docker stats --no-stream --format '{{.CPUPerc}}#{{.MemUsage}}' \
    helix-appliance 2>/dev/null | tr -d ' ')
  LD=$(awk '{print $1}' /proc/loadavg)
  echo "SAMPLE $(date +%s) mem=$MU avail=$AV cont=$ST load=$LD"
  sleep $IV
done
"""


def ssh(host: str, pem: str, cmd: str) -> str:
    return subprocess.run(
        ["ssh", "-i", pem, "-o", "StrictHostKeyChecking=no", host, cmd],
        capture_output=True,
        text=True,
    ).stdout.strip()


def counters(host: str, pem: str) -> tuple[int, int, int]:
    out = ssh(host, pem, REMOTE_COUNTERS).split()
    if len(out) >= 3:
        return int(out[0]), int(out[1]), int(out[2])
    return 0, 0, 0


def main() -> None:
    p = argparse.ArgumentParser(description="Sample remote appliance under load")
    p.add_argument("--ssh-host", required=True)
    p.add_argument("--pem", required=True)
    p.add_argument("--duration", type=float, default=60)
    p.add_argument("--interval", type=float, default=3)
    args = p.parse_args()

    de0, wf0, _ = counters(args.ssh_host, args.pem)
    n = max(1, int(args.duration / args.interval))
    loop = REMOTE_SAMPLE_LOOP.replace("__N__", str(n)).replace("__IV__", str(args.interval))
    proc = subprocess.run(
        ["ssh", "-i", args.pem, "-o", "StrictHostKeyChecking=no", args.ssh_host, loop],
        capture_output=True,
        text=True,
    )
    de1, wf1, lag = counters(args.ssh_host, args.pem)

    mems, cpus, cmems, avails, loads = [], [], [], [], []
    for line in proc.stdout.splitlines():
        if not line.startswith("SAMPLE"):
            continue
        toks = dict(t.split("=", 1) for t in line.split() if "=" in t)
        try:
            mems.append(int(toks.get("mem", 0)))
            avails.append(int(toks.get("avail", 0)))
            loads.append(float(toks.get("load", 0)))
            cont = toks.get("cont", "")  # "5.2%#749MiB/1.86GiB"
            if "#" in cont:
                cpu_str, mem_str = cont.split("#", 1)
                cpus.append(float(cpu_str.rstrip("%")))
                cmems.append(mem_str.split("/", 1)[0])
        except ValueError:
            pass

    summary = {
        "samples": len(mems),
        "host_mem_used_mb": {
            "min": min(mems, default=0),
            "max": max(mems, default=0),
            "avg": round(sum(mems) / len(mems), 1) if mems else 0,
        },
        "host_mem_avail_mb": {"min": min(avails, default=0), "max": max(avails, default=0)},
        "container_cpu_pct": {
            "max": max(cpus, default=0.0),
            "avg": round(sum(cpus) / len(cpus), 1) if cpus else 0,
        },
        "container_mem_last": cmems[-1] if cmems else None,
        "load1": {"max": max(loads, default=0.0)},
        "device_events_delta": de1 - de0,
        "workflow_results_delta": wf1 - wf0,
        "dispatch_lag_end": lag,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
