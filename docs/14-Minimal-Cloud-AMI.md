<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 14 — Minimal Cloud AMI (systemd-native EC2 image)

Date: 2026-07-12

## 1. Purpose

The live Helix deployment runs as **stock Ubuntu → Docker daemon → `helix-appliance`
container**. Three layers stack up, and each costs RAM and image bloat before a
single byte of Helix runs: a full desktop-grade Ubuntu, `dockerd`, and a container
runtime. The appliance *inside* the container is already systemd-native, so the
daemon and the host OS are pure tax.

This work builds a from-scratch, **systemd-native EC2 AMI** that removes both
layers: a minimal Debian **trixie** rootfs where **PID 1 is systemd** and Helix
services are native units. On a 1 GiB `t3.micro` the whole gigabyte is available
to Helix — no `dockerd`, no `snapd`, no NetworkManager, no Ubuntu.

Scope of this first milestone: package **redpanda** into the image and boot it on a
real 1 GiB `t3.micro`. This document records the design, the build/import pipeline,
the end-to-end validation, and the measured memory findings.

It lives under `cloud/ami/` — deliberately a sibling of `cloud/appliance` (the
*container* delivery of the stack) and `cloud/docker-compose.yml` (the
*multi-container* delivery). The AMI is the *native-host* delivery of the same
stack. It is **not** `linux/platform_os`, which is the on-device edge OS.

## 2. Design

| Concern | Choice | Rationale |
| --- | --- | --- |
| Base | Debian **trixie** (`debootstrap --variant=minbase`) | Matches `cloud/appliance`, so redpanda's apt repo, `gen-units.py`, and service configs carry over unchanged. |
| Kernel | `linux-image-cloud-amd64` | The Debian *cloud* flavour ships the `ena` + `nvme` drivers Nitro needs and drops the drivers a VM never uses. |
| Init | `systemd` (`systemd-sysv`) as PID 1 | The whole point — native units, no container runtime. |
| Network | `systemd-networkd` + `systemd-resolved`, DHCP on `eth0` | No NetworkManager, no `ifupdown`. `net.ifnames=0` on the cmdline makes the ENA NIC `eth0`. |
| First boot | `cloud-init` (EC2 datasource only) | SSH-key injection + root-volume `growpart`/`resizefs` + hostname. Runs as **boot-time oneshots only — zero steady-state RAM** (see §6). |
| Bootloader | GRUB `i386-pc` (legacy BIOS) | Simplest reliable boot on Nitro; needs no EFI system partition. Registered `--boot-mode legacy-bios`. |
| Disk | GPT: 1 MiB BIOS-boot (`EF02`) + ext4 root labelled `helix-root` | Root is found by **label** (`root=LABEL=helix-root`), so no UUID has to be templated in after imaging — the build is deterministic. |
| Login | user `helix`, key-only, root locked | cloud-init default user with passwordless sudo. |

The redpanda service is `--mode dev-container --smp 1` — the same low-resource
single-node config the appliance uses, sized for one 1 GiB node.

## 3. Layout

```
cloud/ami/
  Dockerfile.builder        privileged builder (debootstrap, grub-pc-bin + grub2-common, gdisk, parted, e2fsprogs)
  scripts/
    build.sh                orchestrator (runs inside the builder container)
    lib.sh                  shared bash helpers (pseudo-fs bind/unbind, chroot)
    10-debootstrap.sh       minimal trixie rootfs
    20-packages.sh          systemd, cloud kernel, networkd, ssh, cloud-init, grub, iproute2
    25-redpanda.sh          redpanda from its apt repo
    30-configure.sh         networkd + cloud-init + redpanda unit, fstab, enable services
    40-disk.sh              partition, mkfs, rsync rootfs, install GRUB
  rootfs-overlay/           static files copied verbatim into the rootfs
  artifacts/                build output (git-ignored): rootfs/, helix-ami.raw
tooling/ami/commands.py     helix ami build | qemu | import | launch | clean
```

Per the repo rule that host-touching builds run in Docker, the entire rootfs+disk
build runs inside a `--privileged` builder container with `/dev` bind-mounted (so
`losetup -P` can expose the raw image's partitions). `helix ami build` builds that
image and runs `build.sh`; the finished raw image lands in `cloud/ami/artifacts/`.

## 4. Build → import → launch pipeline

Everything up to `import` is local and free.

```sh
helix ami build                       # privileged builder → cloud/ami/artifacts/helix-ami.raw
helix ami qemu                        # boot-test locally (1 GiB, serial console)
helix ami import --profile admin      # S3 upload → import-snapshot → register-image
helix ami launch --profile admin \    # run a test t3.micro
  --ami-id ami-XXXX --key-name "Helix Kit Admin" --sg sg-XXXX
```

`import` is the only billable step. It:
1. ensures an S3 bucket (`helix-ami-import-<account>`) and the `vmimport` IAM role
   (created with the correct `vmie.amazonaws.com` trust + `sts:ExternalId=vmimport`
   condition if missing),
2. uploads the raw image,
3. `ec2 import-snapshot` (RAW → EBS snapshot), polling to completion,
4. `ec2 register-image` as **HVM / x86_64 / ENA / legacy-bios**, root `/dev/xvda`
   backed by the snapshot.

Iteration aid: `helix ami build --stages "30-configure 40-disk"` reuses the
persisted rootfs instead of re-running `debootstrap`.

## 5. End-to-end validation

**Local (QEMU, 1 GiB).** The full boot chain is proven headless:
`GRUB → cloud kernel → initramfs → root mounted by label → systemd 257 →
systemd-networkd DHCP → cloud-init → multi-user → login`. redpanda's service
starts.

**AWS (real `t3.micro`, ap-south-1).** Imported as `ami-0f1ec86796630f415` and
launched:

- SSH reachable **~12 s** after `instance-running`; cloud-init injected the launch
  key; login as `helix@` works.
- `redpanda.service` **`active`, `NRestarts=0`**; **Kafka API listening on
  `0.0.0.0:9092`**, RPC on `33145`.
- `growpart` expanded the root fs to fill the EBS volume automatically.
- Legacy-BIOS GRUB boots cleanly on Nitro.

## 6. Memory findings

Measured on the real `t3.micro` (idle, redpanda running):

| Metric | Value |
| --- | --- |
| Total usable RAM (1 GiB instance) | **939 MB** |
| Used (OS + redpanda, idle) | **253 MB** |
| Available | **686 MB** |
| redpanda RSS (idle) | 117 MiB (157 MiB cgroup) |
| Minimal-OS floor alone | **~100–135 MB** |

The entire OS userland is tiny: `systemd-resolved` 14, `systemd` 14,
`systemd-networkd` 12, `systemd-journald` 11, `sshd` 11, `systemd-udevd` 10 (MB
RSS). **cloud-init leaves no resident daemon** — it runs `cloud-init-local →
cloud-init-network → cloud-config → cloud-final` at boot and exits, so its
steady-state RAM cost is zero (it only costs some disk + a few seconds of boot).

For comparison, on the live 2 GiB `t3.small` running the full appliance:

- The `helix-appliance` container (all ~14 services) uses **722.9 MiB** real RAM
  (cgroup accounting).
- The host reports **1150 MiB** used; subtracting the two containers (~735 MiB)
  leaves **~415 MiB of pure tax** — Ubuntu host userland + `dockerd` + host kernel
  buffers. That is exactly what the minimal AMI deletes.

**Projection for the full stack on a minimal AMI:** working set ~723 MB + OS floor
~120 MB ≈ **~843 MB**. So the whole stack *fits* on a 1 GiB `t3.micro` (~95 MB
headroom — tight, viable for a demo, no burst room) and is comfortable on a 2 GiB
minimal AMI (~1.1 GB free). The headline win is not "the full stack now fits in
1 GiB"; it is that **the ~400 MB currently burned on Ubuntu + dockerd goes back to
Helix**, and single-service roles (e.g. a redpanda-only or ingestion node) drop
cleanly onto a 1 GiB `t3.micro`.

## 7. Gotchas discovered

- **QEMU SIGILLs redpanda.** Under the default `qemu64` TCG CPU, redpanda
  (Seastar) crashes with `trap invalid opcode` — the emulated CPU lacks SSE4.2/AVX.
  Validate with `-enable-kvm -cpu host` (zero traps, `NRestarts=0`). A real
  `t3.micro` has the full instruction set. **Not an image defect.**
- **QEMU has no IMDS.** cloud-init's EC2 datasource retries `169.254.169.254` for
  up to ~240 s before falling back to `None`, so a QEMU boot *looks* stalled at the
  network stage. Real EC2 answers instantly (SSH up in ~12 s). `helix ami qemu`
  attaches a user-mode NIC so `network-online` is still reached promptly.
- **trixie renamed the cloud-init units.** The network stage is now
  `cloud-init-network.service` (plus a new `cloud-init-main.service`); the old
  `cloud-init.service` no longer exists. Enabling the old name fails the build.
- **`grub-install` lives in `grub2-common`.** `grub-pc-bin` alone (the i386-pc
  modules) is not enough; without `grub2-common` stage 40 fails with
  `grub-install: command not found`.
- **ext4 features vs GRUB.** The root fs is made with
  `mkfs.ext4 -O ^orphan_file,^metadata_csum_seed` to stay readable by GRUB's ext
  driver.
- **`iproute2` is not in `minbase`.** cloud-init warns `missing 'ip'`; a server
  needs `ip`, so it is installed explicitly.

## 8. Next steps

Bring the **full appliance stack** onto the AMI. The redpanda unit is currently
hand-kept in sync with the `redpanda` service in
`cloud/appliance/systemd-units.json`; the convergence step is to **generate all
units from that manifest** via `cloud/appliance/bin/gen-units.py` at image-build
time, rather than duplicating them. That turns "systemd + redpanda" into "systemd +
the whole Helix stack, native, no container" on the same minimal base.
