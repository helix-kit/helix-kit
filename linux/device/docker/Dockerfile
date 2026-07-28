# SPDX-License-Identifier: AGPL-3.0-only
#
# systemd-in-container test host for the Helix device runtime. This is NOT the
# production runtime model — real devices run the same binaries and units under
# native systemd on the Helix Linux OS. This image runs systemd as PID 1 inside a
# container so an x86 laptop can exercise the identical runtime-manager/systemctl
# path (reconcile, package install, unit supervision) without dedicated hardware.
#
# It bakes only the BASE runtime (helixd + runtime-manager + the helix-pkg tool +
# static units); app packages (helix-shell, ...) are installed at runtime through
# the package system, which is the whole point of the harness. The provisioned
# /etc/helix (config + pki) is mounted in at run time by `helix device test-host`.
#
# Build context is `linux/device/`.

# ── build ────────────────────────────────────────────────────────────────────
FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go/go.mod go/go.sum ./
RUN go mod download
COPY go/ ./
ENV CGO_ENABLED=0
RUN set -eux; \
    for bin in helixd helix-runtime-manager helix-pkg; do \
      go build -trimpath -ldflags='-s -w' -o "/out/${bin}" "./cmd/${bin}"; \
    done

# ── runtime (systemd PID 1) ──────────────────────────────────────────────────
FROM debian:bookworm-slim
ENV container=docker
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus ca-certificates bash coreutils procps \
 && rm -rf /var/lib/apt/lists/* \
 # Trim systemd units that are meaningless in a container to cut boot noise.
 && find /etc/systemd/system /lib/systemd/system \
      \( -name 'systemd-udevd*' -o -name 'systemd-modules-load*' \
         -o -name '*getty*' -o -name 'systemd-firstboot*' \) \
      -exec ln -sf /dev/null {} \; 2>/dev/null || true

# Unprivileged service account for helixd and app services.
RUN groupadd --system helix && useradd --system --gid helix --shell /usr/sbin/nologin helix

# Base runtime binaries + static units.
COPY --from=build /out/helixd /out/helix-runtime-manager /out/helix-pkg /usr/lib/helix/bin/
COPY systemd/helixd.service systemd/helix-runtime-manager.service systemd/helix.target \
     /etc/systemd/system/
# Seed the package DB so the baked base runtime satisfies package dependencies
# (e.g. helix-shell's `depends: helixd`).
COPY docker/seed-package-db.json /var/lib/helix/db/status

RUN set -eux; \
    mkdir -p /usr/lib/helix/packages /usr/lib/helix/defaults /usr/lib/helix/catalog \
             /etc/helix/conf.d /etc/helix/secrets; \
    # The secrets dir must be traversable by the helix service group so services
    # can read their own 0640 root:helix secret files (and see absent ones as
    # not-found rather than permission-denied).
    chown root:helix /etc/helix/secrets; chmod 0750 /etc/helix/secrets; \
    chown -R root:helix /var/lib/helix/db; chmod 0640 /var/lib/helix/db/status; \
    systemctl enable helix.target helixd.service helix-runtime-manager.service

STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/lib/systemd/systemd"]
