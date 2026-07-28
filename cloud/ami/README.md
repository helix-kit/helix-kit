# Helix minimal cloud AMI

A from-scratch, systemd-native EC2 machine image for running the Helix cloud
stack **without** the Ubuntu + Docker-daemon overhead of a stock host.

## Why

The live deployment today is `stock Ubuntu → dockerd → helix-appliance container`.
That stacks three things that each cost RAM and image bloat: a full desktop-grade
Ubuntu, the Docker daemon, and a container runtime — before a single byte of Helix
runs. The appliance *inside* the container is already systemd-native, so the
daemon and the host OS are pure tax.

This AMI removes both layers: it is a minimal Debian **trixie** rootfs where
**PID 1 is systemd** and the Helix services are native units. On a 1 GiB
`t3.micro`, the whole gigabyte is available to Helix — no dockerd, no snapd, no
NetworkManager, no Ubuntu.

It intentionally mirrors `cloud/appliance` (same Debian base, same redpanda apt
repo, same service model) so the appliance's service definitions carry over. The
appliance is the *container* delivery of the stack; this is the *native-host*
delivery of the same stack.

## What's in it

The minimal OS base:

- `systemd` (`systemd-sysv`) as init
- Debian **cloud kernel** (`linux-image-cloud-amd64`) — ships the `ena` + `nvme`
  drivers Nitro needs, drops the drivers a VM never uses
- `systemd-networkd` + `systemd-resolved` for DHCP (no NetworkManager/ifupdown)
- `openssh-server`
- `cloud-init` — **boot-time oneshots only, zero steady-state RAM** — for SSH-key
  injection, root-volume `growpart`/`resizefs`, and hostname

…plus the **full Helix stack as native systemd units**, installed by stage 28
(`28-appliance.sh`) from `cloud/appliance`'s shared sources — **no duplication**:

- Postgres, redpanda, mosquitto (mTLS), openfga, step-ca, Caddy, and the Node
  apps (helix-server + the Next.js cloud app), run from the host-built **bundles**
  baked into the image (same artifacts the container delivers as its last layer).
- Units are **generated from `cloud/appliance/systemd-units.json` via the shared
  `cloud/appliance/bin/gen-units.py`** — the same generator the container uses.
- **Inngest + Redis are excluded** (`gen-units.py --exclude inngest redis`): this
  delivery runs **DBOS** as the workflow engine (`HELIX_WORKFLOW_MODE=dbos`,
  in-process, checkpointing to Postgres). The console/session units the manifest
  masks for the *container* (getty, logind) are kept unmasked here — this is a
  real host (`--no-mask …`).

Verified end-to-end on a **real 1 GB `t3.micro`** (2026-07-12): full stack boots,
all units active, no OOM. Smoke passes for MQTT ingestion → DBOS workflow, HTTPS
mTLS ingestion → DBOS workflow, and authenticated admin API read/write.

**1 GB memory + limits** (measured):
- **Idle ≈ 672 MB used / 266 MB free** — the whole DBOS stack, ~175 MB lighter
  than the Docker appliance's 1.16 GB. redpanda's Seastar allocator **self-tunes
  to available RAM** (~104 MB on a 1 GB box vs ~400 MB at 2 GB), which is what
  makes idle fit comfortably.
- **Under load, no swap:** stable to ~100 ev/s; at ~200 ev/s (each firing a
  6-node DBOS workflow) memory hits ~23 MB free and the box **wedges
  unrecoverably** — with no swap the kernel can't reclaim RAM pinned by the live
  Node/DBOS/Kafka processes.
- **Under load, + swap:** survived a 400 ev/s burst, **all 7000 events → 7000 DBOS
  workflows completed**, stayed responsive; the ceiling becomes CPU (load ~3.8 on
  2 burstable vCPU) + swap-paging rather than a hard OOM.

**Idle breakdown** (cgroup `MemoryCurrent`, ~710 MB used after the trims below):
redpanda ~172 MB · Next.js app ~156 MB · helix-server ~130 MB · postgres ~64 MB ·
step-ca ~35 MB · openfga ~21 MB · caddy ~15 MB · mosquitto ~3 MB. redpanda + the
two Node processes are ~2/3 of it.

**Memory improvisations (applied):**
- **`helix-swap.service`** (shipped in the overlay, enabled by default): sets up a
  compressed **zram** swap (lz4, ~3× — cold pages compress in RAM, no EBS I/O)
  primary + a disk swapfile overflow. This is what turns the swapless memory-death
  into graceful degradation. Sizes tunable via `HELIX_ZRAM_SIZE` / `HELIX_SWAP_SIZE`
  in `site.env`.
- **Masked the stock Debian `caddy.service`** (in `systemd-units.json`) — the apt
  `caddy` package auto-enables it, so it was running redundantly next to
  `helix-caddy` (both binding `:80`), wasting ~20 MB. helix-caddy is the real one.
- **Optional:** `systemctl disable --now helix-update-agent` drops the Node OTA
  self-upgrade poller (~25 MB) if a box doesn't need over-the-air bundle updates.
- Further levers (not applied): redpanda already self-tunes to RAM; the two Node
  heaps and step-ca/openfga (Go) could take `--max-old-space-size` / `GOMEMLIMIT`
  caps to bound peak growth.

No cloud-init daemon stays resident; it runs its boot-time oneshots and exits.

## Layout

```
cloud/ami/
  Dockerfile.builder        privileged build environment (debootstrap, grub, gdisk…)
  scripts/
    build.sh                orchestrator (runs inside the builder container)
    lib.sh                  shared bash helpers
    10-debootstrap.sh       minimal trixie rootfs
    20-packages.sh          systemd, cloud kernel, networkd, ssh, cloud-init, grub
    25-redpanda.sh          redpanda from its apt repo
    28-appliance.sh         the FULL Helix stack as native units, from cloud/appliance
                            (postgres, mosquitto, node, caddy, openfga, step-ca,
                            bundles; Inngest/Redis excluded) via gen-units.py
    30-configure.sh         networkd + cloud-init, enable base services
    40-disk.sh              partition, mkfs, rsync, install GRUB (legacy BIOS)
  rootfs-overlay/           static files copied verbatim into the rootfs
  artifacts/                build output (git-ignored): rootfs/, helix-ami.raw
```

Stage 28 needs the repo (the builder bind-mounts it at `/repo`) and the app
**bundles** — build them first with `helix appliance bundles` (they land in
`cloud/appliance/bundles/`, and are baked into the image).

## Build → test → ship

Everything up to `import` is local and free.

```sh
# 1. Build the raw disk image (runs the build in a privileged Docker container)
helix ami build

# 2. Boot-test it locally in QEMU with 1 GiB, like the t3.micro target
helix ami qemu
#    login is key-only; watch for `systemd → multi-user.target` + redpanda up,
#    then Ctrl-A X to quit QEMU.

# 3. Import into AWS: upload to S3 → import-snapshot → register-image
helix ami import --profile admin
#    prints the new ami-… id

# 4. Launch a t3.micro from it
helix ami launch --profile admin --ami-id ami-XXXX \
  --key-name <keypair> --sg <sg-id>
#    then: ssh helix@<public-ip>
```

Pass `--arch arm64` to build/import for a Graviton box (`t4g.micro`), which is
the cheapest way to run this. The bundles are architecture-independent, so the
only per-arch choices are the base rootfs and the boot mode (below).

## Configure the site (first launch)

The image bakes a `localhost` placeholder into `/etc/helix/site.env`. Point it at
the real deployment before anything external can reach it, then re-run the PKI and
restart the stack — **the leaf certs are issued from these values**, so editing
them alone is not enough:

```sh
sudo vi /var/lib/helix/env/site.env   # the live copy (seeded from /etc/helix/site.env)
#   APP_DOMAIN=example.com
#   PUBLIC_APP_URL=https://example.com
#   ACME_EMAIL=ops@example.com
#   CLOUDFLARE_API_TOKEN=…            # Zone:DNS:Edit — see below
#   MQTT_BROKER_PUBLIC_HOSTS=example.com,<elastic-ip>

sudo systemctl restart helix-seed-env helix-pki
sudo systemctl restart helix-mosquitto helix-helix-server helix-caddy helix-app
```

Two things trip people up here, and both are why those extra keys exist:

- **The wildcard cert needs DNS-01.** Port forwarding publishes each session at
  `<session>.port.<domain>`, and ACME cannot issue a wildcard over HTTP-01. With
  `CLOUDFLARE_API_TOKEN` set, `seed-env.sh` turns on Caddy's Cloudflare DNS
  challenge (`CADDY_ACME_DNS`) and the AMI's Caddy build carries the provider
  module. Without it there is no `*.port` cert. A proxied domain needs DNS-01
  regardless, since an HTTP-01 challenge would be answered by the proxy.
- **Devices bypass the CDN.** Cloudflare's proxy only carries HTTP(S), so a device
  cannot reach MQTT on `:8883` or the data plane on `:4001` through it — it dials
  the **origin IP** directly. Those hosts must therefore be SANs on the broker and
  mTLS certs, which is what `MQTT_BROKER_PUBLIC_HOSTS` feeds. For the same reason,
  build the bundles with the device-facing data-plane URL pinned to the origin:
  `NEXT_PUBLIC_HELIX_DEVICE_STREAM_URL=wss://<elastic-ip>:4001/stream/device helix appliance bundles --arch arm64`
  (the browser inlines it at build time; unset, it defaults to the page's own
  hostname, which is the proxied one).

## Boot mechanics

- **Partitioning** — GPT, ext4 root labelled `helix-root`, plus a per-arch boot
  partition: a 1 MiB BIOS-boot partition (`EF02`) on amd64, or a 64 MiB FAT32 EFI
  System Partition on arm64.
- **Boot mode** — amd64 registers `legacy-bios` with GRUB for `i386-pc`; arm64
  registers `uefi` (Graviton is UEFI-only) with GRUB for `arm64-efi` installed
  `--removable`, i.e. at `\EFI\BOOT\BOOTAA64.EFI` — an imported image gets no NVRAM
  boot entry, so the firmware only looks at that fallback path.
- **Root discovery** — by filesystem **label** (`root=LABEL=helix-root`), so no
  UUID has to be templated in after the fact and re-imaging is deterministic.
- **Growth** — the built root partition is small (~2.5 GiB); cloud-init's
  `growpart` expands it to fill the actual EBS volume on first boot.
- **Console** — `console=ttyS0,115200` so the EC2 serial console and system log
  work; `serial-getty@ttyS0` is enabled.

## Notes

- SSH user is **`helix`** (cloud-init default user, passwordless sudo, and also
  the stack's service user). Root login is locked.
- All Helix units are generated from `cloud/appliance/systemd-units.json` via
  `cloud/appliance/bin/gen-units.py` — no hand-kept duplicates.
- **First-boot migrations**: like the container, no `helix-cloud-init` bundle is
  built, so the drizzle app migrations are applied *externally* on first bring-up
  (`pnpm --filter helix db:migrate` against the box's Postgres — reachable by
  SSH-tunnelling to its loopback `:5432`). DBOS's own system schema is migrated
  automatically by `helix-server-launch.sh`.
- **Local smoke test (QEMU/KVM)**: build with a test key and boot with the stack
  ports forwarded, e.g.
  `AMI_TEST_SSH_PUBKEY="$(cat key.pub)" helix ami build`, then
  `qemu-system-x86_64 -enable-kvm -cpu host -m 2048 -smp 2 -drive file=overlay.qcow2,if=virtio -netdev user,id=n0,hostfwd=tcp::2222-:22,hostfwd=tcp::18883-:8883,hostfwd=tcp::14001-:4001,hostfwd=tcp::13000-:3000 -device virtio-net-pci,netdev=n0 -display none -serial file:console.log`.
  `-cpu host` is required (redpanda SIGILLs under the default `qemu64` CPU). QEMU
  has no IMDS, so cloud-init falls back to `DataSourceNone` after ~240 s and SSH
  comes up only then; on real EC2 it is ~12 s. The load-test harness
  (`tooling/loadtest/`) drives the forwarded ports; `provision_remote.py --native`
  seeds device certs against the host (no Docker).
