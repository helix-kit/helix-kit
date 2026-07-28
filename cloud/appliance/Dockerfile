# syntax=docker/dockerfile:1
# =============================================================================
# cloud/appliance/Dockerfile — the single-container Helix cloud appliance.
#
# WHAT THIS IS
#   ONE image that runs the ENTIRE cloud stack (the same services that are 25
#   separate containers in cloud/docker-compose.yml) as systemd units inside a
#   single container. PID 1 is systemd. Bring-up at a remote site or a dev box
#   is `docker run` of this one image — first boot self-seeds all env + secrets.
#
#   Third-party services (postgres, redis, openfga, inngest, redpanda, mosquitto,
#   step-ca, caddy, coturn, and the observability stack) are baked in as native
#   binaries and run as systemd units. The in-house Node apps are NOT baked into
#   the OS layers — they are shipped as zip BUNDLES (built on the host by
#   scripts/build-appliance-bundles.sh) and unpacked into /opt/helix/apps, so
#   the exact same artifact can be re-delivered later over the air by the
#   remote-update channel (see cloud/appliance/README.md).
#
# BUILD (context = repo root, AFTER running scripts/build-appliance-bundles.sh):
#   scripts/build-appliance-bundles.sh
#   docker build -f cloud/appliance/Dockerfile -t helix-appliance:dev .
#
# RUN (use the blessed launcher — it sets the safe flags for you):
#   scripts/appliance-dev.sh up            # dev backend (ports mapped to localhost)
#   # or, equivalently, docker compose -f cloud/appliance/dev-compose.yml up -d
#
# If you must run `docker run` by hand, copy this EXACTLY:
#   docker run -d --name helix \
#     --cgroupns=private --privileged \
#     --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
#     --stop-signal SIGRTMIN+3 \
#     -v helix_data:/var/lib/helix \
#     -v /path/to/site.env:/etc/helix/site.env:ro \
#     -p 80:80 -p 443:443 -p 8883:8883 -p 8884:8884 -p 4001:4001 \
#     helix-appliance:dev
#
#   ⚠ DANGER — DO NOT bind-mount the host cgroup tree (`-v /sys/fs/cgroup:...:rw`).
#   PID 1 here is systemd. On a cgroup v2 host that bind mount REPLACES Docker's
#   namespaced cgroup mount with the host's REAL cgroup root, so the container's
#   systemd manages the HOST's cgroups and, on stop (SIGRTMIN+3), tears down your
#   user session + system slices — it looks like an abrupt logout/reboot.
#   `--cgroupns=private` (Docker's default on cgroup v2) gives systemd a writable
#   cgroup of its OWN subtree; that is all it needs. Never add the host bind mount.
#   (Podman: drop --privileged/--stop-signal — it runs systemd natively.)
# =============================================================================

ARG DEBIAN_FRONTEND=noninteractive

# Pinned to confirmed-available release assets (validated 2026-06-26).
ARG OPENFGA_VERSION=1.18.0
ARG INNGEST_VERSION=1.33.0
ARG STEP_CA_VERSION=0.30.2
ARG STEP_CLI_VERSION=0.30.6
# NOTE: the observability stack (Grafana/Prometheus/Loki/Tempo/Alloy/OTel/
# exporters) is deliberately NOT baked into the image — it is the bulk of the
# size and most sites never enable it. It is downloaded ON DEMAND onto the
# persistent volume by /opt/helix/bin/install-observability.sh (which pins its
# own versions). Only the small configs + systemd units ship in the image.

FROM debian:trixie-slim AS base
ARG DEBIAN_FRONTEND

# ---- OS packages: init + the apt-available services -------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      systemd systemd-sysv ca-certificates curl gnupg lsb-release \
      tar xz-utils unzip zip jq python3 procps tini \
      postgresql postgresql-client \
      redis-server \
      mosquitto mosquitto-clients \
      coturn \
    && rm -rf /var/lib/apt/lists/* \
    # The host's path-based AppArmor "mosquitto" profile auto-attaches to
    # /usr/sbin/mosquitto on exec (even in a privileged container) and confines
    # it to /etc/mosquitto only, so it can't read our staged config. Run it from
    # a non-matching path to dodge the profile entirely.
    && cp /usr/sbin/mosquitto /usr/local/sbin/helix-mosquitto

# Node 24 (glibc — matches the host that builds the app bundles).
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Caddy (TLS reverse proxy) from the official apt repo — this brings the caddy
# user/group and the runtime dirs. The stock package carries no DNS provider
# module though, so the binary itself is then replaced with an official build
# that includes caddy-dns/cloudflare: without it the `*.port` wildcard cert
# cannot be issued (HTTP-01 does not do wildcards) and a Cloudflare-proxied
# domain cannot be validated at all. See cloud/Caddyfile (CADDY_ACME_DNS).
RUN curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
      > /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update && apt-get install -y --no-install-recommends caddy \
    && curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors \
      "https://caddyserver.com/api/download?os=linux&arch=$(dpkg --print-architecture)&p=github.com/caddy-dns/cloudflare" \
      -o /usr/bin/caddy.dns \
    && chmod +x /usr/bin/caddy.dns && mv /usr/bin/caddy.dns /usr/bin/caddy \
    && caddy list-modules | grep -qx dns.providers.cloudflare \
    && rm -rf /var/lib/apt/lists/*

# Redpanda (device-event bus) from the official apt repo.
RUN curl -fsSL https://dl.redpanda.com/nzc4ZYQK3WRGd9sy/redpanda/cfg/setup/bash.deb.sh | bash \
    && apt-get install -y --no-install-recommends redpanda \
    && rm -rf /var/lib/apt/lists/*

# ---- single-binary services (download + verify-by-arch) ---------------------
# amd64-only for now (the EC2/dev target). Add arm64 cases when needed.
ARG TARGETARCH=amd64
ARG OPENFGA_VERSION
ARG INNGEST_VERSION
ARG STEP_CA_VERSION
ARG STEP_CLI_VERSION
RUN set -eux; \
    dl() { curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors --connect-timeout 30 "$1" -o "$2"; }; \
    # OpenFGA — `openfga` binary is a top-level tar member.
    dl "https://github.com/openfga/openfga/releases/download/v${OPENFGA_VERSION}/openfga_${OPENFGA_VERSION}_linux_amd64.tar.gz" /tmp/openfga.tgz; \
    tar -xzf /tmp/openfga.tgz -C /usr/local/bin openfga; \
    # Inngest — `inngest` binary is a top-level tar member.
    dl "https://github.com/inngest/inngest/releases/download/v${INNGEST_VERSION}/inngest_${INNGEST_VERSION}_linux_amd64.tar.gz" /tmp/inngest.tgz; \
    tar -xzf /tmp/inngest.tgz -C /usr/local/bin inngest; \
    # step-ca + step CLI (PKI for MQTT certs) — unversioned asset names.
    dl "https://github.com/smallstep/certificates/releases/download/v${STEP_CA_VERSION}/step-ca_linux_amd64.tar.gz" /tmp/stepca.tgz; \
    tar -xzf /tmp/stepca.tgz -C /tmp; cp /tmp/step-ca_linux_amd64/step-ca /usr/local/bin/; \
    dl "https://github.com/smallstep/cli/releases/download/v${STEP_CLI_VERSION}/step_linux_amd64.tar.gz" /tmp/step.tgz; \
    tar -xzf /tmp/step.tgz -C /tmp; cp /tmp/step_linux_amd64/bin/step /usr/local/bin/; \
    chmod +x /usr/local/bin/openfga /usr/local/bin/inngest /usr/local/bin/step-ca /usr/local/bin/step; \
    rm -rf /tmp/*

# Observability binaries are NOT installed here — see install-observability.sh.

# ---- service accounts -------------------------------------------------------
RUN set -eux; \
    useradd --system --no-create-home --shell /usr/sbin/nologin helix || true; \
    useradd --system --no-create-home --shell /usr/sbin/nologin openfga || true; \
    useradd --system --no-create-home --shell /usr/sbin/nologin inngest || true; \
    useradd --system --no-create-home --shell /usr/sbin/nologin stepca || true; \
    useradd --system --no-create-home --shell /usr/sbin/nologin observ || true

# ---- configs + helper scripts -----------------------------------------------
# Reuse the cloud/ originals wherever possible; only genuinely-different files
# are appliance-specific. The compose configs use docker service hostnames; the
# appliance is one namespace, so the host/port/path-swappable observability
# configs are DERIVED from the originals at build time by localize-obs.sh.
COPY cloud/Caddyfile                 /etc/helix/Caddyfile
COPY cloud/mosquitto/device.acl      /etc/helix/mosquitto/device.acl
COPY cloud/mosquitto/service.acl     /etc/helix/mosquitto/service.acl
COPY cloud/appliance/mosquitto.conf  /etc/helix/mosquitto/mosquitto.conf
COPY cloud/coturn/turnserver.conf    /etc/helix/coturn/turnserver.conf
COPY cloud/inngest-cleanup.sql       /etc/helix/inngest-cleanup.sql

# Observability: originals (for grafana dashboards + as the localize source) +
# the two genuinely-different appliance files (prometheus drops jobs; alloy uses
# journald). localize-obs.sh derives loki/tempo/otel/datasources, then drops src.
COPY cloud/observability/            /etc/helix/observability-src/
COPY cloud/observability/grafana/    /etc/helix/observability/grafana/
COPY cloud/appliance/observability/prometheus.yml /etc/helix/observability/prometheus.yml
COPY cloud/appliance/observability/config.alloy   /etc/helix/observability/config.alloy

# mosquitto-exporter (MQTT broker $SYS -> Prometheus) ships ONLY as a Docker
# image (no upstream binary release), so vendor its static binary from the
# published image; install-observability.sh stages it onto the volume alongside
# the downloaded exporters. Placed late so it doesn't bust the install layers.
COPY --from=jryberg/mosquitto-exporter:v0.7.7 /mosquitto_exporter /opt/helix/vendor/mosquitto_exporter

COPY cloud/appliance/bin/               /opt/helix/bin/
COPY cloud/appliance/systemd-units.json /opt/helix/systemd-units.json

# Base image version — bumped whenever any layer ABOVE this line changes (deps,
# binaries, units, configs). The cloud app reads this to decide hot-upgrade vs
# base-upgrade-required. Part of the BASE image identity (above the bundle COPY).
COPY cloud/appliance/BASE_IMAGE_VERSION /opt/helix/BASE_IMAGE_VERSION

# Generate all systemd units from the manifest, create the enable symlinks, and
# mask the Debian-packaged services that would steal ports — see gen-units.py.
RUN set -eux; \
    chmod +x /opt/helix/bin/*.sh; \
    mkdir -p /var/lib/helix /etc/helix; \
    systemctl set-default multi-user.target; \
    python3 /opt/helix/bin/gen-units.py; \
    # Derive the host/port-swapped observability configs from the originals.
    /opt/helix/bin/localize-obs.sh; \
    rm -rf /etc/helix/observability-src

# ---- LAST LAYER: the host-built app bundles --------------------------------
# Kept last on purpose: a new cloud-app RELEASE only re-COPYs this layer on top
# of the cached base, so each release image is cheap to build + push. The base
# image version above does NOT change for an app-only release.
COPY cloud/appliance/bundles/        /opt/helix/bundles/

EXPOSE 80 443 3000 4000 4001 8883 8884 3001
STOPSIGNAL SIGRTMIN+3
ENTRYPOINT ["/sbin/init"]
