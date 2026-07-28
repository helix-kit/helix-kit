# Minimal WebKitGTK Kiosk (experimental)

A purpose-built, RAM-frugal variant of the kiosk aimed at a **Raspberry Pi
Zero 2 W** (quad Cortex-A53, **512 MB**). Instead of the heavyweight Ubuntu +
systemd + Xorg lab one directory up, this builds a tiny **Alpine (musl)** image
that boots straight into a **cage** (Wayland kiosk compositor) running
**WebKitGTK**, and runs it in a QEMU box sized exactly like the target device so
we can measure real memory.

It reuses the same React site (`../site`) and kiosk shell (`../shell/kiosk-shell.py`).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Base OS | Alpine 3.22 aarch64 (musl) | ~8 MB base; musl is lighter than glibc |
| Display | cage + wlroots (Wayland) | single-app fullscreen kiosk, no X server |
| Seat | seatd | libseat's `builtin` backend isn't in Alpine's build |
| Browser | webkit2gtk-4.1 | reuse the existing GTK kiosk shell |
| Web server | darkhttpd | ~50 KB, one process (busybox has no `httpd` applet) |
| Renderer | pixman / cairo (software) | the QEMU box has no GPU; worst-case numbers |
| SSH | dropbear | tiny, for measurement access |

## Build & run

```bash
# cross-build the aarch64 image on an x86 host (needs qemu-aarch64 binfmt, sudo)
minimal/build-alpine.sh            # --fresh rebuilds the rootfs from scratch

# boot the Pi-Zero-2W-sized box (aarch64 A53, 4 core, 512 MB)
minimal/run-min.sh                 # GTK window; --headless for no display
```

SSH is on host port **2223** (root / `helix`), so it coexists with the Ubuntu
lab on 2222. Measure from inside:

```bash
ssh root@127.0.0.1 -p 2223 kiosk-memreport
```

Host prerequisites (Debian/Ubuntu): `qemu-system-arm qemu-efi-aarch64
qemu-user-binfmt binfmt-support e2fsprogs`. The aarch64 binfmt handler must be
registered (the build runs apk/mkinitfs in an emulated chroot).

> No KVM for ARM on an x86 host, so QEMU runs under TCG — boot and page loads
> are slow. Memory figures are still representative; only speed is affected.

## Measured memory (512 MB box, ~466 MB usable after kernel/reserved)

Idle at the Home screen, software-rendered, **JIT + sandbox disabled**:

| Process | PSS |
| --- | --- |
| python3 (WebKit UIProcess + GTK + shell) | ~111 MiB |
| WebKitWebProcess | ~91 MiB |
| WebKitNetworkProcess | ~50 MiB |
| cage | ~26 MiB |
| **web-stack PSS subtotal** | **~271 MiB** |
| darkhttpd / seatd / dropbear / udev / init | < 3 MiB combined |

Two honest lenses on "how much RAM the kiosk costs":

- **`free` used ≈ 160 MiB**, ~306 MiB available. This is anonymous +
  non-reclaimable memory — the true pressure the rest of the system feels.
- **PSS ≈ 271 MiB** is larger because it counts WebKit's big shared libraries,
  which are **file-backed** pages living in the page cache (`buff/cache`), not in
  `used`. Under memory pressure those pages are evicted and re-read from flash.

**Bottom line: it fits in 512 MB with ~300 MB free** for background services,
even with everything software-rendered. On real hardware the VideoCore GPU would
offload compositing.

### What the optimizations bought

| Change | `free` used | web-stack PSS |
| --- | --- | --- |
| Baseline (compositing already off) | 177 MiB | 296 MiB |
| + `JavaScriptCoreUseJIT=0`, sandbox off | **160 MiB** | **271 MiB** |

## Where the memory goes next (further optimization)

The floor here is WebKit's multi-process engine (~240 MiB across three
processes), not our 196 KB React bundle. To go lower:

1. **WPE WebKit + cog** instead of WebKitGTK — WPE is the embedded-targeted
   WebKit (no GTK/X11), typically 30–80 MiB lighter, and `cog` is a purpose-built
   kiosk browser (drops the python UIProcess entirely). Biggest single win; it
   would replace the GTK shell, so keyboard switching would move to cog's config.
2. **zram swap** — compresses cold WebKit library pages; buys headroom on flash.
3. **Trim WebKit deps** — the package pulls gstreamer for `<video>`; a custom
   build with media disabled sheds libraries our page never touches.
4. **Replace python with a small C shell** — saves the interpreter's anon memory
   (~10–15 MiB); minor next to the engine.
