#!/usr/bin/env bash
# EC2 bandwidth monitor for the P2P transport test.
#
# Watches the primary NIC (ens5 — what AWS meters) once per second alongside the
# signaling server's relayed-byte counter. The point: while a browser downloads
# a large file P2P from the device, the NIC stays near-idle and only a few KB of
# signaling ever cross this box. If instead you saw tens of MB of NIC egress
# tracking the download, the connection fell back to a relay (it should not —
# there is no TURN here).
#
#   ./monitor.sh            # stream to stdout, one line/sec
#   nohup ./monitor.sh > /tmp/p2p-monitor.log 2>&1 &   # background log
#
# NB: no `set -e`/`pipefail` — when idle the grep below legitimately matches
# nothing (exit 1), which must not kill the monitor.
set -u

IFACE="${IFACE:-$(ip route show default | awk '{print $5; exit}')}"
STAT="/sys/class/net/${IFACE}/statistics"
SIG_CONTAINER="${SIG_CONTAINER:-deploy-p2p-signaling-1}"

# Sum signalingBytesRelayed across all rooms (no jq dependency).
sig_bytes() {
  docker exec "$SIG_CONTAINER" wget -qO- http://127.0.0.1:9200/__p2pstats__ 2>/dev/null \
    | grep -o '"signalingBytesRelayed": *[0-9]*' | grep -o '[0-9]*' \
    | awk '{s+=$1} END{print s+0}'
}

read -r rx0 < "$STAT/rx_bytes"; read -r tx0 < "$STAT/tx_bytes"
pr=$rx0; pt=$tx0

printf 'iface=%s  (tx = egress = billable; should stay flat during a P2P download)\n' "$IFACE"
printf '%5s %13s %13s %14s %14s %14s\n' t in_kB/s out_kB/s cum_rx_MB cum_tx_MB p2p_sig_KB
for ((i = 0; ; i++)); do
  sleep 1
  read -r rx < "$STAT/rx_bytes"; read -r tx < "$STAT/tx_bytes"
  sb=$(sig_bytes || echo 0)
  printf '%5d %13.1f %13.1f %14.2f %14.2f %14.2f\n' "$i" \
    "$(awk "BEGIN{print ($rx-$pr)/1024}")" \
    "$(awk "BEGIN{print ($tx-$pt)/1024}")" \
    "$(awk "BEGIN{print ($rx-$rx0)/1048576}")" \
    "$(awk "BEGIN{print ($tx-$tx0)/1048576}")" \
    "$(awk "BEGIN{print $sb/1024}")"
  pr=$rx; pt=$tx
done
