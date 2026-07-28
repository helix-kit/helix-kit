#!/usr/bin/env bash
# EC2 NIC byte-counter tool (ground-truth bandwidth).
#
# Reads the kernel's per-interface byte counters for the primary (public)
# interface. These are the real on-the-wire bytes AWS meters and that count
# against the instance's network allowance: TLS-encrypted payload + WebSocket
# framing + TCP/IP + Ethernet headers. Docker bridge / veth traffic (Caddy <->
# gateway, plaintext) stays internal and is NOT on this interface.
#
# Usage:
#   netmon.sh snapshot            # one parseable line: rx tx rxpkts txpkts epoch iface
#   netmon.sh sample <seconds>    # sleep N s, print the delta + rates (human)
#   netmon.sh watch  <seconds>    # per-second in/out for N s
set -euo pipefail

IFACE="${IFACE:-$(ip route show default | awk '{print $5; exit}')}"
STAT="/sys/class/net/${IFACE}/statistics"

counters() { # -> "rx tx rxpkts txpkts"
  echo "$(cat "$STAT/rx_bytes") $(cat "$STAT/tx_bytes") $(cat "$STAT/rx_packets") $(cat "$STAT/tx_packets")"
}

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"; }

case "${1:-snapshot}" in
  snapshot)
    read -r rb tb rp tp <<<"$(counters)"
    echo "$rb $tb $rp $tp $(date +%s) $IFACE"
    ;;
  sample)
    dur="${2:-30}"
    read -r rb0 tb0 rp0 tp0 <<<"$(counters)"
    sleep "$dur"
    read -r rb1 tb1 rp1 tp1 <<<"$(counters)"
    drx=$((rb1 - rb0)); dtx=$((tb1 - tb0))
    drp=$((rp1 - rp0)); dtp=$((tp1 - tp0))
    printf 'iface=%s window=%ss\n' "$IFACE" "$dur"
    printf '  rx=%s (%d B, %d pkts)  %.0f B/s\n' "$(human "$drx")" "$drx" "$drp" "$(awk "BEGIN{print $drx/$dur}")"
    printf '  tx=%s (%d B, %d pkts)  %.0f B/s   [tx = egress = billable]\n' "$(human "$dtx")" "$dtx" "$dtp" "$(awk "BEGIN{print $dtx/$dur}")"
    ;;
  watch)
    dur="${2:-30}"
    read -r pr pt _ _ <<<"$(counters)"
    for ((i = 0; i < dur; i++)); do
      sleep 1
      read -r rb tb _ _ <<<"$(counters)"
      printf '%2d  in %8.1f kB/s   out %8.1f kB/s\n' "$i" \
        "$(awk "BEGIN{print ($rb-$pr)/1024}")" "$(awk "BEGIN{print ($tb-$pt)/1024}")"
      pr=$rb; pt=$tb
    done
    ;;
  *)
    echo "usage: netmon.sh {snapshot|sample <s>|watch <s>}" >&2; exit 1
    ;;
esac
