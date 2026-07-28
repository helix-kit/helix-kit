#!/bin/bash
# boardtop — Allwinner A733 accelerator + memory monitor.
# Shows what btop/htop CAN'T: NPU / GPU / Cedar-VE utilisation, DMA-buffer memory,
# CMA and slab, and per-block clocks/temps. Reads the vendor debugfs/sysfs nodes
# no generic tool knows about. Usage: boardtop.sh [N]   (N samples, default loop)
VIP=/sys/kernel/debug/viplite
# The NPU/VE/DMA-buf numbers live in debugfs (/sys/kernel/debug), which is root-only —
# without root every read returns "Permission denied" and the values print blank.
# Re-exec under sudo so `boardtop.sh` just works without a manual sudo prefix.
if [ ! -r "$VIP/core_loading" ]; then
  echo "boardtop: debugfs needs root — re-running under sudo..." >&2
  exec sudo -- bash "$0" "$@"
fi
N=${1:-0}
pi=0; pt=0; pinf=0; ptot=0; first=1; i=0
while :; do
  # CPU (delta of /proc/stat)
  read idle tot < <(awk '/^cpu /{id=$5+$6; t=0; for(j=2;j<=11;j++)t+=$j; print id,t}' /proc/stat)
  dc=$((tot-pt)); di=$((idle-pi)); cpu=0; [ $dc -gt 0 ] && cpu=$(((dc-di)*100/dc)); pi=$idle; pt=$tot
  # MEM
  eval "$(awk '/^MemTotal/{t=$2}/^MemAvailable/{a=$2}/^Cached/{c=$2}/^Slab:/{s=$2}/^CmaTotal/{m=$2}END{printf "MT=%d MA=%d MC=%d MS=%d MM=%d",t/1024,a/1024,c/1024,s/1024,m/1024}' /proc/meminfo)"
  MU=$((MT-MA))
  # DMA-buf
  dma=$(awk '/Total.*objects/{o=$2;b=$4}END{printf "%d objs / %d MB",o,b/1048576}' /sys/kernel/debug/dma_buf/bufinfo 2>/dev/null)
  # NPU utilisation (delta of inference-time vs VIP-total-time)
  read inf vtot < <(awk -F= '/Inference Time/{split($2,x," ");inf=x[1]}/VIP Total Time/{split($2,y," ");vt=y[1]}END{print inf,vt}' $VIP/core_loading 2>/dev/null)
  dinf=$((inf-pinf)); dvt=$((vtot-ptot)); npu=0; [ $dvt -gt 0 ] && npu=$((dinf*100/dvt)); pinf=$inf; ptot=$vtot
  nf=$(awk -F= '/Core Frequency/{split($2,a," ");print int(a[1]/1000000);exit}' $VIP/vip_freq 2>/dev/null)
  # GPU — this PowerVR driver's debugfs exposes no utilisation %, only driver/firmware
  # status; the GPU is unused by the decode/NPU/encode pipeline anyway. Show its status.
  gpu=$(awk -F: '/Driver Status/{gsub(/^[ \t]+/,"",$2);print $2;exit}' /sys/kernel/debug/pvr/status 2>/dev/null)
  # Cedar VE (enable-count>0 => in use)
  ve=$(awk '/ ve-dec /{d=($2>0)?"BUSY":"idle"}/ ve-enc0 /{e=($2>0)?"BUSY":"idle"}END{printf "dec=%s enc=%s @624MHz",d,e}' /sys/kernel/debug/clk/clk_summary 2>/dev/null)
  ddr=$(awk '{printf "%d",$1/1000000}' /sys/class/devfreq/a020000.dmcfreq/cur_freq 2>/dev/null)
  temp=$(( $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0) / 1000 ))
  if [ $first -eq 1 ]; then first=0; else
    printf '\n== A733 boardtop == %s   CPU %3d%%(8c)  %d C  DDR %d MHz\n' "$(date +%T)" "$cpu" "$temp" "$ddr"
    printf 'RAM   used %4d/%d MB   avail %d   cache %d   slab %d   CMA %d MB\n' "$MU" "$MT" "$MA" "$MC" "$MS" "$MM"
    printf 'DMAbuf %s   <- decode+NPU+encode hw working set (invisible to btop)\n' "$dma"
    printf 'NPU   %3d%% busy @ %s MHz   (Vivante VIP9000, 3 TOPS INT8)\n' "$npu" "$nf"
    printf 'GPU   %-6s status         (PowerVR BXM-4-64; no util%% node, idle/unused here)\n' "${gpu:-n/a}"
    printf 'VE    %s        (Cedar video decode/encode)\n' "$ve"
  fi
  i=$((i+1)); [ "$N" != "0" ] && [ $i -gt "$N" ] && break
  sleep 1
done
