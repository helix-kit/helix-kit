<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 18 — Boot System of the Allwinner A733 (Radxa Cubie A7Z)

Date: 2026-07-21

A ground-up account of how an ARM64 single-board computer actually boots, using
the **Radxa Cubie A7Z** (Allwinner A733) as the worked example. Everything here
was derived by **forensic inspection of a real SD card and a real serial boot
log**, not from vendor documentation — so it shows what the hardware *does*,
which is frequently not what the docs say.

This document is written to be read and questioned. Section 10 lists open
questions worth pushing on; §11 is a glossary of every acronym used.

**Confidence labelling.** Because much of this is reverse-engineered, each
non-obvious claim is tagged:

- **[V]** — verified directly (read off the card, or observed in a boot log)
- **[?]** — unverified; stated as a lead to check, not a fact

---

## 1. The mental model: why boot is a chain

A CPU coming out of reset can do almost nothing. It has no RAM configured (DRAM
needs a trained memory controller), no clocks at final speed, no storage driver,
no MMU. The chip cannot simply "run Linux" — Linux is a 19 MB compressed blob on
an SD card and expects gigabytes of working DRAM to already exist.

So every SoC solves this with a **chain of progressively more capable loaders**,
each one small enough to run in whatever environment the previous stage left
behind, and each one responsible for building the environment the next stage
needs:

```
tiny + dumb, runs from on-chip SRAM
   │
   ▼  each stage initialises more hardware
large + capable, runs from DRAM with drivers
```

The constraint that shapes everything: **the first stage must fit in on-chip
SRAM**, because DRAM does not work yet. That budget is small and fixed by the
silicon, which is why boot0 exists as a separate thing from U-Boot — and why
U-Boot (megabytes, with a full driver stack) cannot be the first thing to run.

**[?]** A good thing to pin down with a tutor: `boot0_sdcard.bin` is **240 KB**,
which is larger than the SRAM budget on many SoCs. Either the A733 has unusually
generous SRAM, or boot0 is itself staged — worth checking the A733 datasheet
against this number rather than assuming.

---

## 2. The A733 chain, end to end

Reconstructed from the card and the serial log. **[V]**

```
┌─ BROM ────────────────── mask ROM, burned into silicon, immutable
│   Scans SD/eMMC/SPI for a magic signature; loads boot0 into SRAM.
│   Also implements FEL (USB recovery mode).
│
├─ boot0  "eGON.BT0" ───── @ 128 KB on the card, 240 KB, runs from SRAM
│   • initialises DRAM  ← uses libdram blob (§5)
│   • starts the SCP / arisc coprocessor
│   • unpacks boot_package.fex and places each payload in DRAM
│   • jumps to ATF
│
├─ BL31 (ARM Trusted Firmware) ──── EL3, secure monitor
│   Stays resident forever. Handles PSCI (CPU on/off, suspend, reboot)
│   and SMC calls from Linux for the rest of the machine's uptime.
│
├─ OP-TEE ──────────────── S-EL1, trusted execution environment (secure world)
│
├─ U-Boot 2018.07 ──────── EL2/EL1, normal world, full drivers
│   Reads /boot/extlinux/extlinux.conf from the rootfs, loads kernel +
│   initrd + DTB, then hands over.
│
└─ Linux 5.15.147-7-a733 ─ finally
```

Two details that surprise people:

1. **ATF does not exit.** BL31 is not a loader that finishes — it installs
   itself at EL3 and remains for the machine's lifetime. Every time Linux
   powers a CPU core up or down, it traps into BL31. **[V]** — the boot log
   shows `NOTICE: BL3-1: Next image address = 0x40200000`, and PSCI is how
   the kernel later brings up the other 7 cores.

2. **There is a whole second computer.** The **arisc** is a small coprocessor
   that manages power, clocks and suspend. It boots *before* Linux and runs
   independently. **[?]** The A733 is marketed as *nine-core*: 2×A76 + 6×A55 =
   8, plus a **RISC-V E902** — so that ninth core is very likely the arisc,r
   though on older Allwinner chips "AR100" was an OpenRISC core. Worth
   confirming in the datasheet. Observed on the console **[V]**:

   ```
   NOTICE:  [SCP] :wait arisc ready....
   NOTICE:  [SCP] :arisc version: [d463b9da43dc50320f21ba51c6c51afe2db20d83]
   NOTICE:  [SCP] :arisc startup ready
   ```

### Exception levels

ARM64 privilege rings, which the chain walks *down*:

| Level | Who | Notes |
|---|---|---|
| EL3 | BL31 / secure monitor | most privileged, resident |
| S-EL1 | OP-TEE | secure world OS |
| EL2 | hypervisor (unused here) | |
| EL1 | Linux kernel | |
| EL0 | userspace | |

The boot0 → ATF → OP-TEE → U-Boot ordering exists so that the *secure* world is
established before the *normal* world ever runs. Once U-Boot starts at EL2/EL1,
it can no longer tamper with what OP-TEE set up.

---

## 3. On-disk layout: the part that isn't a filesystem

The single most important thing to understand about SBC boot: **the first stages
are not in any filesystem.** They live at fixed byte offsets in raw sectors,
because BROM has no filesystem driver.

Verified layout of the card **[V]**:

```
byte 0
 ├─ 0        GPT partition table
 ├─ 128 KB   boot0  ("eGON.BT0" magic)     ← BROM looks HERE
 ├─ ~1 MB    boot0 backup copy             ← redundancy against a bad block
 ├─ ...      boot_package.fex (ATF + OP-TEE + U-Boot + SCP + DTB)
 │
 ├─ 16 MB ─────────── partition 1 starts here
 │   p1  16 MB   vfat   "config"   rsetup first-boot config
 │   p2  300 MB  vfat   "efi"      EMPTY — vestigial
 │   p3  rest    ext4   "rootfs"   Debian
```

Evidence for the magic signature, found by scanning raw sectors:

```
$ sudo dd if=/dev/sda bs=1M count=16 | strings -t d | grep -i egon
  131076 eGON.BT0        ← 0x20004, i.e. 128 KB + 4
 1056772 eGON.BT0        ← backup
```

**The 16 MB gap before partition 1 is deliberate.** It is reserved space for the
bootloader chain. This is why you cannot simply `mkfs` a card and copy files
onto it and expect it to boot — and why writing a distro image is done with `dd`
of a whole-disk image rather than a file copy.

**The 300 MB EFI partition is empty and unused.** **[V]** This board does *not*
boot via UEFI; it boots via U-Boot + extlinux. The partition is an artifact of
Radxa's image build being shared across boards. A good example of how vendor
images accumulate vestigial structure.

### What boot0 actually unpacks

Strings recovered from the raw bootloader region **[V]** reveal boot0's
dispatch logic verbatim:

```
Jump to ATF: monitor_base = 0x%x, uboot_base = 0x%x, optee_base = 0x%x
Jump to OPTEE: optee_base = 0x%x, uboot_base = 0x%x
Jump to U-Boot: uboot_base = 0x%x
optee to Linux (%x)...,dtb (%x)

u-boot   u-boot-gz   u-boot-lz4   u-boot-lzma
dtb      dtb-gz      dtb-lz4      dtb-lzma      dtbo
error: dtb size larger than scp dts size
error: dtb not found for scp
```

Three things to notice:

- Payloads may be **compressed** (gz/lz4/lzma) — boot0 contains decompressors.
- There is a **dtbo** (device tree overlay) concept this early.
- The **SCP gets its own device tree**, sized against the main DTB.

`boot_package.fex` (1.4 MB) is the container holding all of these. `.fex` is
Allwinner's proprietary packaging format.

Shipped variants **[V]** — note the same chain is used regardless of boot media:

```
/usr/lib/u-boot/radxa-cubie-a7z/
  boot0_sdcard.bin   240K
  boot0_spinor.bin   232K     ← SPI NOR flash
  boot0_ufs.bin      240K     ← UFS storage
  boot_package.fex   1.4M
  sys_partition_nor.bin  17K
```

---

## 4. U-Boot and the handoff to Linux

U-Boot is the first stage with a full driver stack — USB, MMC, network,
filesystems, a shell. Its job is to find and load a kernel.

Observed on the serial console **[V]**:

```
sunxi USB-DRD init ok...
USB EHCI 1.00
scanning bus 0 for devices... 1 USB Device(s) found
       scanning usb for storage devices... 0 Storage Device(s) found
mmc0 is current device
Scanning mmc 0:2...
Scanning mmc 0:3...
Found /boot/extlinux/extlinux.conf
Retrieving file: /boot/extlinux/extlinux.conf
```

**`extlinux.conf` is the seam.** Everything below it is Allwinner's proprietary
world; everything above it is standard Linux. It is a plain text file in the
rootfs:

```
default l0
menu title U-Boot menu
prompt 1
timeout 10

label l0
	menu label Debian GNU/Linux 11 (bullseye) 5.15.147-7-a733
	linux /boot/vmlinuz-5.15.147-7-a733
	initrd /boot/initrd.img-5.15.147-7-a733
	fdtdir /usr/lib/linux-image-5.15.147-7-a733/
	append root=UUID=e65e41a2-... console=ttyAS0,115200n8 rootwait ...
```

For anyone building their own OS for this board, this is the key architectural
fact: **you can replace the kernel, initrd, DTB and entire rootfs by writing
this one file**, without touching the proprietary chain at all.

### Reading the kernel command line

The `append` line is worth dissecting, because several entries are load-bearing:

| Fragment | Meaning |
|---|---|
| `root=UUID=…` | which partition holds the rootfs |
| `console=ttyAS0,115200n8` | serial console — `ttyAS` is Allwinner's UART driver |
| `console=tty1` | *second* console declaration — see below |
| `rootwait` | wait for the root device to appear (removable media) |
| `earlycon` | console output before the real driver probes |
| `quiet splash loglevel=4` | suppress boot messages |
| `clk_ignore_unused` | don't gate clocks with no registered driver — a BSP crutch |
| `coherent_pool=2M` | DMA coherent allocation pool |
| `cgroup_enable=memory swapaccount=1` | container support |
| `mac_addr=${mac}` | U-Boot variable, substituted at boot |

**The `console=` ordering is a real trap.** Linux allows multiple `console=`
arguments — output goes to *all* of them, but `/dev/console` (and therefore the
login prompt) binds to the **last one listed**. Here `console=tty1` comes last,
so the getty lands on HDMI, and a serial cable gets kernel messages but **no
login prompt**. **[V]** — confirmed by observation; swapping the order moved the
prompt to serial.

Also note `mac_addr=${mac}` is substituted by U-Boot before handoff — the
observed runtime line contained `mac_addr=08:51:49:1b:4a:ff`. **[V]**

### Timing

The serial log timestamps boot0/U-Boot separately from the kernel **[V]**:

```
[83.881] libfdt fdt_path_offset() returned FDT_ERR_BADMAGIC
[84.055] Starting kernel ...
[84.060] total: 84058 ms
```

84 seconds before the kernel starts — because `prompt 1` + `timeout 10` makes
U-Boot wait at an interactive menu. Kernel-side timestamps then restart from
zero, which is why the two halves of a boot log appear to disagree about time.

---

## 5. The blobs: where openness stops

Two components in this chain have **no source code published anywhere**. **[V]**

```
dramlib/sun60iw2p1/spl_libdram/libdram        32-bit ELF, 222,188 bytes
dramlib/sun60iw2p1/arisc_liboem/libar100s.a   static archive (precompiled)
```

Verified as a binary by reading its header:

```
$ curl -sL .../sun60iw2p1/spl_libdram/libdram | head -c 16 | xxd
00000000: 7f45 4c46 0101 0100 ...      ← \x7fELF, 32-bit, little-endian
```

**Why these two specifically?** They are the crown jewels of SoC bring-up:

- **libdram** performs DRAM training — calibrating timing, drive strength and
  signal delays for the specific memory chips on the board. It encodes the
  vendor's characterisation work and is generally considered trade secret.
- **libar100s.a** is the firmware for the power-management coprocessor, which
  controls voltage rails and clocks.

**The practical consequence:** both run *before Linux exists*. No amount of
open-source work above them removes the dependency. Any OS for this board —
including a hypothetical fully-free one — must ship these binaries verbatim or
the board will not train its RAM and will not boot.

For a project with SPDX/REUSE compliance this needs an explicit carve-out: the
blobs are redistributable but not auditable.

Other proprietary-ish components, less fundamental because they only affect
features rather than booting: the **PowerVR BXM GPU** driver (`img-bxm-dkms`),
**AIC8800** Wi-Fi/BT firmware, and the **VeriSilicon NPU** userspace. `/lib/firmware`
on the shipped image totals **240 MB**. **[V]**

---

## 6. Where the source lives

Everything except the two blobs is public and GPL-3+. **[V]** The structure is
worth understanding because it is typical of vendor BSPs: thin *packaging*
repos that pull real source from submodules.

```
radxa-pkg/linux-a733            ← packaging only (~0 MB)
  ├─ src          → radxa/kernel            @ allwinner-aiot-linux-5.15  (4.5 GB)
  ├─ bsp          → radxa/allwinner-bsp     @ cubie-aiot-v1.4.6          (77 MB)
  └─ device-a733  → radxa/allwinner-device  @ device-a733-v1.4.6         (5 MB)

radxa-pkg/u-boot-aw2501         ← packaging only
  ├─ src        → radxa/u-boot              @ cubie-aiot-v1.4.6          (257 MB)
  ├─ tools      → gitlab tina5.0_aiot/lichee/tools
  ├─ arisc      → gitlab tina5.0_aiot/lichee/arisc
  ├─ dramlib    → gitlab tina5.0_aiot/lichee/dramlib          ← the blobs
  ├─ spl-pub    → gitlab tina5.0_aiot/lichee/brandy-2.0/spl-pub
  └─ awbs       → radxa/awbs
```

Build is `git clone --recurse-submodules`, open the devcontainer, `make deb`.
It emits Debian packages — but nothing forces you to *consume* them as Debian
packages; the kernel, DTB and modules can be extracted into any rootfs.

Note `spl-pub` **does** ship real source (`arch/ board/ include/ mk/ nboot/
sboot/ Makefile`), so the SPL scaffolding is buildable — it is specifically the
DRAM and arisc libraries that are binary. **[V]**

Newer versions exist than the shipped image uses **[V]**:

| Component | On the card | Available |
|---|---|---|
| BSP | `v1.4.6` | `v1.4.8` |
| Kernel | `5.15.147-7` | `5.15.147-21` (Apr 2026) |

---

## 7. Mainline status, and why it matters

**Mainline Linux does not support this SoC at all.** **[V]** — read directly
from `arch/arm64/boot/dts/allwinner/Makefile` on `torvalds/linux` master:

```
sun50i    present
sun55i    present  (A523/A527/T527 — the previous generation)
sun60i    ABSENT   ← the A733 is sun60iw2
```

No device tree, no clock driver, no pinctrl driver. Patch series are in flight
but **unmerged**: clk CCU/PRCM (RFC), pinctrl, and a U-Boot series. A community
effort for the near-identical Cubie A7S reports only a v1 DT series submitted,
**RTC as the sole working peripheral**, and explicitly no Ethernet, display,
Wi-Fi, BT, USB-C, PCIe, eMMC, VPU or NPU — with no bootable image. **[V]**

There is a dependency ordering too: the DT work is blocked on clock support
landing first.

**The deadline that matters:** kernel **5.15 reaches EOL in December 2026**, and
Allwinner's AIOT SDK will not be upstreamed. A board whose only working kernel
is unsupported and whose vendor tree is frozen at U-Boot 2018.07 is a poor
foundation for a long-lived product.

**[?]** A branch `allwinner-aiot-linux-6.6` exists in `radxa/kernel`, but whether
it covers the A733 is **unverified** — circumstantially it appears not to, since
the A733 packaging pins `allwinner-aiot-linux-5.15`. Worth confirming by cloning.

---

## 8. Four BSP defects found in one evening

Useful as case studies in how vendor kernels fail, and all reproducible.

**1. DisplayPort hotplug GPIO not wired in the device tree.** **[V]**

```
get hotplug pin for phy mux failed, hotplug may be useless!
```

DP Alt Mode negotiates correctly and the mux reaches `STATE_DP_D`; the DP status
VDO even reports **HPD HIGH** (bit 7 of `0x19a`). But the signal never reaches
DRM, so the connector stays `disconnected` and X never lights it. It is a *race*,
not a hard failure — if DRM happens to probe after the link is up, it works.
Workaround: poll and write `detect` to force a re-probe.

**2. Use-after-free in the Type-C stack on every disconnect.** **[V]**

```
refcount_t: underflow; use-after-free.
WARNING: ... refcount_warn_saturate
  typec_altmode_release ← device_release ← typec_unregister_altmode
  ← tcpm_reset_port ← tcpm_detach ← tcpm_state_machine_work
```

A genuine kernel bug. Plausibly why alt mode often fails to re-register on the
next attach, requiring a dongle power-cycle to recover.

**3. USB-PD sink capped at 500 mA.** **[V]** From the TCPM negotiation log:

```
  PDO 0: 5000 mV, 3000 mA        ← source offers 15 W
  PDO 1: 9000 mV, 2440 mA
  PDO 2: 15000 mV, 2860 mA
  PDO 3: 20000 mV, 2500 mA       ← up to 50 W available
Requesting PDO 0: 5000 mV, 500 mA   ← board asks for 2.5 W
```

Not a negotiation failure — the board's sink capabilities are defined
conservatively in its device tree and it never considers the higher profiles.

**4. DP link training fails at 2560×1440.** **[V]**

```
[EDP_ERR]: EQ training result: lane0:PASS lane1:PASS lane2:PASS lane3:PASS align:FAIL
[EDP_ERR]: retry 5 times but still fail, training2(equalization training) fail!
```

Critically, this fails **identically at 30 Hz**, which needs half the bandwidth
— so it is a driver bug in link training, *not* a lane-count or bandwidth
ceiling. 1080p60 trains fine.

---

## 9. Debugging boot: the serial console

When a board does not come up, the network is useless and the serial console is
the only window. On this board **[V]**:

| Signal | Pin | Notes |
|---|---|---|
| GND | 6 | connect first |
| UART0_TX | 8 | → adapter RX |
| UART0_RX | 10 | → adapter TX |

115200 8N1, **3.3 V logic**. Never connect VCC. Note the debug UART is on pins
6/8/10 — *not* the pins the GPIO multiplexing table implies, which describes
which functions *can* be muxed rather than where the console is routed.

Helix ships a command for this:

```sh
uv run helix device console ports          # list adapters
uv run helix device console open --wait --log boot.log
```

It auto-detects the USB bridge by vendor ID (adapters renumber between
`ttyUSB0`/`ttyUSB1` across resets), and **reconnects when the board resets** —
which matters on a board that reboots often. `--wait` lets you start the
listener *before* powering on, so the boot log is not missed.

To make boot verbose, edit `/etc/kernel/cmdline`: drop `quiet` and `splash`,
raise `loglevel=7`, and move `console=ttyAS0` to be **last** so the login prompt
binds to serial. Then run `u-boot-update` to regenerate `extlinux.conf`.

---

## 10. Questions worth exploring with a tutor

Ordered roughly from concrete to open-ended.

**Understanding the chain**

1. Why must boot0 fit in SRAM, and how large is the A733's SRAM? What
   determines that budget?
2. Why does BL31 stay resident instead of exiting like a normal bootloader?
   What breaks if it does not?
3. What is PSCI, and trace what happens when Linux brings up CPU core 4.
4. Why does the SCP need its *own* device tree, separate from the kernel's?
5. What is FEL mode and how does it let you recover a board with no valid boot0?

**Storage and layout**

6. Why is boot0 duplicated at ~1 MB? What failure does that defend against?
7. Why does BROM look at exactly 128 KB? Is that configurable, and what
   happens on eMMC vs SPI NOR vs UFS?
8. Why does the shipped image contain a 300 MB empty EFI partition?

**Device tree**

9. What problem does device tree solve that x86 solves differently (ACPI)?
10. How do DT *overlays* work, and why does boot0 handle `dtbo` so early?
11. Trace how a missing GPIO in the DT (defect 1) turns into a blank screen.

**The open/closed boundary**

12. What does DRAM "training" physically calibrate, and why is it board-specific
    rather than chip-specific?
13. Could libdram be replaced by open code? What would that require — and why
    have projects like libdram-sunxi succeeded for older Allwinner chips?
14. If every stage above libdram were rewritten, what would that buy you?

**Strategy**

15. What is the practical difference between a "vendor BSP kernel" and mainline,
    and why do vendors fork rather than upstream?
16. Given 5.15 EOL in Dec 2026, what are the realistic options for a product?
17. Why is the A523/A527 (`sun55i`) generation in mainline but the newer A733
    not? What does that suggest about picking hardware?

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **ATF / TF-A** | ARM Trusted Firmware — reference EL3 secure monitor |
| **BL31** | Boot Loader stage 3-1; the resident EL3 runtime from ATF |
| **BROM** | Boot ROM — immutable code in silicon, the true first stage |
| **boot0** | Allwinner's SPL equivalent; identified by the `eGON.BT0` magic |
| **arisc / AR100** | Allwinner's power-management coprocessor (the SCP) |
| **SCP** | System Control Processor — manages power/clocks independently |
| **OP-TEE** | Open Portable Trusted Execution Environment (secure-world OS) |
| **EL0–EL3** | ARM64 Exception Levels; EL3 most privileged |
| **PSCI** | Power State Coordination Interface — how Linux asks EL3 for CPU on/off |
| **SPL** | Secondary Program Loader — the small first-stage loader |
| **FEL** | Allwinner USB recovery mode exposed by BROM |
| **`.fex`** | Allwinner proprietary container format |
| **extlinux** | Syslinux-style boot config format that U-Boot can parse |
| **DTB / DTS / DTBO** | Device Tree Blob / Source / Overlay |
| **libdram** | Closed-source DRAM initialisation and training library |
| **BSP** | Board Support Package — vendor's kernel + drivers fork |
| **DKMS** | Dynamic Kernel Module Support — rebuilds out-of-tree modules |
| **TCPM** | USB Type-C Port Manager (Linux subsystem) |
| **PDO** | Power Data Object — an advertised USB-PD power profile |
| **HPD** | Hot Plug Detect — the "a monitor was connected" signal |
| **sun60iw2** | Allwinner's internal codename for the A733 |

---

## 12. Sources

- Radxa Cubie A7Z docs: <https://docs.radxa.com/en/cubie/a7z>
- 40-pin GPIO: <https://docs.radxa.com/en/cubie/a7z/hardware-use/pin-gpio>
- Kernel packaging: <https://github.com/radxa-pkg/linux-a733>
- U-Boot packaging: <https://github.com/radxa-pkg/u-boot-aw2501>
- Allwinner Tina SDK: <https://gitlab.com/tina5.0_aiot/lichee>
- linux-sunxi mainlining: <https://linux-sunxi.org/Linux_mainlining_effort>
- A733 mainline effort: <https://github.com/crescenzo77/radxa_cubie_a7s_allwinner_a733>
- U-Boot A733 series: <https://lists.denx.de/pipermail/u-boot/2025-November/603430.html>
- pinctrl A733: <https://lwn.net/Articles/1034685/>

Primary evidence for this document is the shipped image
`radxa-cubie-a7z_bullseye_kde_t7` (rsdk-t7, Debian Bullseye, kernel
5.15.147-7-a733), inspected on 2026-07-20/21.
