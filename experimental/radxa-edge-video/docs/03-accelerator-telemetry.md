<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 03 — Accelerator telemetry (`boardtop.sh`)

Date: 2026-07-25

`btop`/`htop` show CPU and RSS but are **blind** to everything that matters on
this board: NPU / GPU / Cedar-VE utilisation and the DMA-buffer working set (the
hardware codec + NPU buffers that dominate real memory use). There is no
`nvidia-smi` / `jtop` equivalent because these are Allwinner-vendor nodes.

[`src/boardtop.sh`](../src/boardtop.sh) reads the vendor debugfs/sysfs directly
and prints a one-line-per-block summary each second.

---

## What it reads

| Metric | Source | Notes |
| --- | --- | --- |
| **NPU utilisation** | `/sys/kernel/debug/viplite/core_loading` | delta of `Inference Time` / `VIP Total Time` = live busy % (≈70 % under 4-stream YOLO) |
| NPU freq | `/sys/kernel/debug/viplite/vip_freq` | Core ~648 MHz, PPU 1008 MHz |
| NPU mem | `/sys/kernel/debug/viplite/mem_profile` | |
| **GPU utilisation** | `/sys/kernel/debug/pvr/status` | `GPU Utilisation: N%` + per-engine 2D/GEOM/3D/CDM/RAY (PowerVR; ~0 % here) |
| **Cedar VE** | `/sys/kernel/debug/clk/clk_summary` rows `ve-dec` / `ve-enc0` | rate 624 MHz + `enable_count > 0` ⇒ in use (no % load exposed) |
| **DMA buffers** | `/sys/kernel/debug/dma_buf/bufinfo` | total objs / bytes — the **~380 MB hw working set invisible to btop** |
| DDR freq | `/sys/class/devfreq/a020000.dmcfreq/cur_freq` | 1.8 GHz |
| Temp | `/sys/class/thermal/thermal_zone0/temp` | |
| Mem detail | `/proc/meminfo` | Slab / CmaTotal / SUnreclaim |

Usage: `boardtop.sh [N]` (N samples, default = loop). CPU% is a `/proc/stat`
delta; NPU% and DDR are read as deltas/instantaneous each tick.

## Reading NPU utilisation correctly

Use the **raw counters**, not just the percentage. `core_loading` exposes a
cumulative `Inference Time` — right after an NPU re-init the percentage delta can
briefly misread as 0 even while inference is running. When diagnosing a suspected
NPU stall, check that the raw `Inference Time` counter is **advancing** and that
`Core0` is not `Idle`.

The three `vip_*` kernel threads (`vip_device0_dae`, `vip_core0_wait`,
`vip_power_manag`) sit in **D-state whenever the NPU is active** — this inflates
load average but is normal, not a wedge.

## Follow-up

Good candidate to wrap as a first-class `helix device board-top` CLI command so
it isn't a stray script (per the repo's "one developer entry point" rule).
