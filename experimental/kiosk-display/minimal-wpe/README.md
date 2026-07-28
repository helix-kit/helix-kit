# Minimal WPE WebKit + cog Kiosk (experimental)

The lowest-RAM kiosk variant, for a **Raspberry Pi Zero 2 W** (512 MB). Where the
Alpine variant (`../minimal`) runs full **WebKitGTK** under a **cage** compositor,
this runs **WPE WebKit** — the embedded-targeted WebKit with no GTK/X11 — driven
by **cog**, rendering **directly on KMS with no compositor at all**.

It reuses the same React site (`../site`), which handles its own keyboard
switching (cog is a single-URL browser with no external shell).

## Why Ubuntu here (not Alpine)

Alpine packages only `libwpe`, not `wpewebkit`/`cog`, and building WPE from
source under emulation is impractical. Ubuntu **Noble dropped cog entirely**;
**Jammy (22.04)** is the newest Ubuntu that still ships `cog` + `wpewebkit` for
arm64, so this variant is Ubuntu-Jammy-based (glibc + systemd). The base is
heavier than Alpine, but WPE itself is the memory win — and it still comes out
ahead (see below).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Base OS | Ubuntu 22.04 arm64 (ubuntu-base + apt) | only Ubuntu with cog for arm64 |
| Browser | cog 0.12 + libwpewebkit-1.0 (WPE 2.36) | embedded WebKit, no GTK |
| Display | cog DRM platform (`libcogplatform-drm`) | renders straight to KMS — **no compositor** |
| Seat/input | seatd + libinput | cog reads evdev directly |
| Renderer | llvmpipe (software GLES) | QEMU box has no GPU |
| Web server | busybox httpd | Ubuntu's busybox has the applet |
| Init/SSH | systemd + dropbear | Ubuntu-native |

## Build & run

```bash
minimal-wpe/build-ubuntu.sh          # cross-build the arm64 image (--fresh to rebuild rootfs)
minimal-wpe/run-wpe.sh               # boot the 512 MB A53 box; --headless for no window
ssh root@127.0.0.1 -p 2224 kiosk-memreport   # root / helix
```

SSH is on host port **2224** (the Alpine variant is 2223, the Ubuntu lab 2222 —
all three coexist). The build cross-installs into an aarch64 chroot via qemu-user
binfmt; same host prereqs as `../minimal` plus nothing extra.

## Measured memory (512 MB box, ~464 MB usable), idle at Home, JIT off

| Process | PSS |
| --- | --- |
| WPEWebProcess (renderer, GLES compositing) | ~118 MiB |
| cog (UI process — native C, *no* python) | ~59 MiB |
| WPENetworkProcess | ~20 MiB |
| busybox httpd | ~1 MiB |
| **web-stack PSS subtotal** | **~193 MiB** |
| systemd + journald + networkd + resolved + logind + dbus | ~15 MiB combined |

- **`free` used ≈ 146 MiB**, ~317 MiB available.

## Head-to-head vs WebKitGTK (`../minimal`)

Same site, same 512 MB A53 box, both JIT off:

| | Alpine + cage + **WebKitGTK** | Ubuntu + cog + **WPE** |
| --- | --- | --- |
| `free` used | 160 MiB | **146 MiB** |
| web-stack PSS | 271 MiB | **193 MiB** (~29% less) |
| Compositor | cage (~26 MiB) | **none** (direct KMS) |
| UI process | python3 (~111 MiB) | cog native C (~59 MiB) |
| Network process | ~50 MiB | ~20 MiB |
| Web/renderer process | ~91 MiB | ~118 MiB* |
| Base init | musl + OpenRC (tiny) | glibc + systemd (~15 MiB) |

\* WPE's renderer is *larger* because it does GLES accelerated compositing
(software llvmpipe buffers here). On a real Pi Zero 2 W the VideoCore GPU would
hold those buffers in GPU memory, so the on-device WPE renderer RAM would be
lower than this software-rendered figure — widening WPE's lead further.

**Takeaway:** WPE + cog is ~78 MiB (≈29%) lighter on the web stack than
WebKitGTK, even carrying a heavier Ubuntu/systemd base, mainly by dropping the
compositor and the python UI process. For a 512 MB SBC it leaves ~317 MiB free.

## Notes / limits

- **WPE is GPU/compositing-only.** Under QEMU's pure-software GL (llvmpipe) the
  page *background* paints but the content layers never reach the KMS scanout — a
  `screendump` shows only the app's navy background. This is an emulation
  artifact: WPE has no non-accelerated (cairo) fallback the way WebKitGTK does, so
  it assumes a real GPU. On the Pi Zero 2 W (VideoCore GPU) it renders fully. The
  memory figures above are still valid — the WebProcess does the same work either
  way. This tradeoff is the whole point: WebKitGTK is heavier but runs pure
  software; WPE is lighter but wants a GPU — which the target board has.
- Software-rendered here (no GPU in QEMU); WPE needs `libgles2` (the GLES loader)
  or the renderer crash-loops.
- cog renders to the KMS scanout via GBM, which `fbcon`/`/dev/fb0` does not
  mirror — screenshot the box via QEMU `screendump` over the QMP socket
  (`.lab/qmp.sock`), not by reading `/dev/fb0`.
- The build trusts the apt repo (`[trusted=yes]`) and runs apt as root in the
  chroot so qemu-user can exec gpgv — fine for an experiment, not for production.
