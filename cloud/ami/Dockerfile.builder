# syntax=docker/dockerfile:1
# =============================================================================
# cloud/ami/Dockerfile.builder — the privileged image that builds the Helix
# minimal cloud AMI.
#
# WHAT THIS IS
#   A throwaway build environment (NOT the AMI itself). It carries the host-side
#   tools needed to debootstrap a minimal Debian rootfs and lay it down onto a
#   partitioned, GRUB-installed raw disk image: debootstrap, grub-pc, gdisk,
#   parted, e2fsprogs, rsync, util-linux (losetup). Per the repo rule that
#   anything touching the host runs in Docker, `helix ami build` runs the
#   scripts/ inside a --privileged container built from this file, writing the
#   finished raw image to a bind-mounted /out.
#
#   The rootfs the scripts produce is Debian trixie to match cloud/appliance, so
#   the appliance's redpanda apt repo + service model carry over unchanged.
# =============================================================================
FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive
# The GRUB target packages are architecture-specific: amd64 builds a legacy-BIOS
# image (grub-pc-bin), arm64 builds a UEFI one (grub-efi-arm64-bin), because
# Graviton EC2 is UEFI-only. The builder is run with the matching --platform, so
# just install whichever applies to this container's own architecture.
RUN apt-get update && apt-get install -y --no-install-recommends \
      debootstrap \
      grub2-common \
      grub-common \
      gdisk \
      parted \
      dosfstools \
      e2fsprogs \
      rsync \
      util-linux \
      ca-certificates \
      curl \
      xz-utils \
    && case "$(dpkg --print-architecture)" in \
         amd64) apt-get install -y --no-install-recommends grub-pc-bin ;; \
         arm64) apt-get install -y --no-install-recommends grub-efi-arm64-bin ;; \
         *) echo "unsupported builder arch" >&2; exit 1 ;; \
       esac \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
ENTRYPOINT ["/bin/bash"]
