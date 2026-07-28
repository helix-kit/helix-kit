#!/usr/bin/env bash
# Stage 28 — install the Helix appliance stack into the rootfs as native systemd
# units, reusing cloud/appliance's configs + generators. AMI-specific: Inngest +
# Redis excluded (runs DBOS); app runs from host-built bundles baked in.
# Third-party binary versions MUST track cloud/appliance/Dockerfile's ARGs.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

trap unbind_pseudo EXIT
bind_pseudo "$ROOTFS"
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"

export DEBIAN_FRONTEND=noninteractive

REPO="${REPO:-/repo}"
[ -d "$REPO/cloud/appliance" ] || die "repo not mounted at $REPO (need cloud/appliance)"
[ -n "$(ls "$REPO"/cloud/appliance/bundles/*.zip 2>/dev/null)" ] \
  || die "no bundles in $REPO/cloud/appliance/bundles — run 'helix appliance bundles' first"

# Versions — keep in sync with cloud/appliance/Dockerfile.
OPENFGA_VERSION=1.18.0
STEP_CA_VERSION=0.30.2
STEP_CLI_VERSION=0.30.6

log "apt: postgres, mosquitto, node, caddy, coturn, helpers"
in_chroot apt-get update
in_chroot apt-get install -y --no-install-recommends \
  postgresql postgresql-client \
  mosquitto mosquitto-clients \
  coturn \
  ca-certificates curl gnupg jq tar xz-utils unzip zip python3 procps tini
# Renamed binary dodges the host path-based AppArmor mosquitto profile.
in_chroot cp /usr/sbin/mosquitto /usr/local/sbin/helix-mosquitto

log "apt: Node 24 (nodesource)"
in_chroot bash -c "curl -fsSL https://deb.nodesource.com/setup_24.x | bash -"
in_chroot apt-get install -y --no-install-recommends nodejs

log "apt: Caddy (official repo)"
in_chroot bash -c "curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
in_chroot bash -c "echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' > /etc/apt/sources.list.d/caddy-stable.list"
in_chroot apt-get update
in_chroot apt-get install -y --no-install-recommends caddy

# Swap the apt caddy binary for an official build with caddy-dns/cloudflare (the
# *.port wildcard cert needs DNS-01, and proxied domains can't use HTTP-01).
log "caddy: rebuilding with dns.providers.cloudflare ($AMI_ARCH)"
in_chroot bash -euo pipefail -c "
  curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
    'https://caddyserver.com/api/download?os=linux&arch=${AMI_ARCH}&p=github.com/caddy-dns/cloudflare' \
    -o /usr/bin/caddy.dns
  chmod +x /usr/bin/caddy.dns && mv /usr/bin/caddy.dns /usr/bin/caddy
  caddy list-modules | grep -qx dns.providers.cloudflare
"

log "single binaries: openfga $OPENFGA_VERSION, step-ca $STEP_CA_VERSION, step $STEP_CLI_VERSION"
in_chroot bash -euo pipefail -c "
  dl() { curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors --connect-timeout 30 \"\$1\" -o \"\$2\"; }
  dl 'https://github.com/openfga/openfga/releases/download/v${OPENFGA_VERSION}/openfga_${OPENFGA_VERSION}_linux_${AMI_ARCH}.tar.gz' /tmp/openfga.tgz
  tar -xzf /tmp/openfga.tgz -C /usr/local/bin openfga
  dl 'https://github.com/smallstep/certificates/releases/download/v${STEP_CA_VERSION}/step-ca_linux_${AMI_ARCH}.tar.gz' /tmp/stepca.tgz
  tar -xzf /tmp/stepca.tgz -C /tmp; cp /tmp/step-ca_linux_${AMI_ARCH}/step-ca /usr/local/bin/
  dl 'https://github.com/smallstep/cli/releases/download/v${STEP_CLI_VERSION}/step_linux_${AMI_ARCH}.tar.gz' /tmp/step.tgz
  tar -xzf /tmp/step.tgz -C /tmp; cp /tmp/step_linux_${AMI_ARCH}/bin/step /usr/local/bin/
  chmod +x /usr/local/bin/openfga /usr/local/bin/step-ca /usr/local/bin/step
  rm -rf /tmp/openfga.tgz /tmp/stepca.tgz /tmp/step.tgz /tmp/openfga_* /tmp/step-ca_* /tmp/step_*
"

# `helix` is both the service user AND the cloud-init login user, so create it as
# a normal login user (home+bash+sudo) to reconcile with cloud-init's default_user.
log "users: helix (login+service) + openfga/stepca/observ (system)"
in_chroot bash -euo pipefail -c "
  id helix >/dev/null 2>&1 || useradd --create-home --shell /bin/bash helix
  usermod -aG sudo helix
  echo 'helix ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/helix; chmod 440 /etc/sudoers.d/helix
  for u in openfga stepca observ; do
    id \$u >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin \$u
  done
"

# TEST ONLY: bake an SSH key for `helix` when AMI_TEST_SSH_PUBKEY is set (QEMU has
# no IMDS for cloud-init key injection). Never set for a shipped build.
if [ -n "${AMI_TEST_SSH_PUBKEY:-}" ]; then
  log "installing TEST SSH pubkey for helix (AMI_TEST_SSH_PUBKEY set)"
  install -d -m 700 "$ROOTFS/home/helix/.ssh"
  printf '%s\n' "$AMI_TEST_SSH_PUBKEY" > "$ROOTFS/home/helix/.ssh/authorized_keys"
  chmod 600 "$ROOTFS/home/helix/.ssh/authorized_keys"
  in_chroot chown -R helix:helix /home/helix/.ssh
fi

log "configs + bin + manifest from cloud/appliance"
install -d "$ROOTFS/etc/helix" "$ROOTFS/etc/helix/mosquitto" "$ROOTFS/etc/helix/coturn" \
          "$ROOTFS/opt/helix/bin" "$ROOTFS/opt/helix/bundles" "$ROOTFS/var/lib/helix"
cp "$REPO/cloud/Caddyfile"                "$ROOTFS/etc/helix/Caddyfile"
cp "$REPO/cloud/coturn/turnserver.conf"   "$ROOTFS/etc/helix/coturn/turnserver.conf"
cp "$REPO/cloud/mosquitto/device.acl"     "$ROOTFS/etc/helix/mosquitto/device.acl"
cp "$REPO/cloud/mosquitto/service.acl"    "$ROOTFS/etc/helix/mosquitto/service.acl"
cp "$REPO/cloud/appliance/mosquitto.conf" "$ROOTFS/etc/helix/mosquitto/mosquitto.conf"
cp -a "$REPO/cloud/appliance/bin/."        "$ROOTFS/opt/helix/bin/"
cp "$REPO/cloud/appliance/systemd-units.json" "$ROOTFS/opt/helix/systemd-units.json"
cp "$REPO/cloud/appliance/BASE_IMAGE_VERSION" "$ROOTFS/opt/helix/BASE_IMAGE_VERSION"
cp "$REPO"/cloud/appliance/bundles/*.zip   "$ROOTFS/opt/helix/bundles/"
in_chroot chmod +x /opt/helix/bin/gen-units.py
in_chroot bash -c 'chmod +x /opt/helix/bin/*.sh'

# seed-env.sh imports this into /var/lib/helix/env/site.env on first boot.
log "baking DBOS site.env"
cat > "$ROOTFS/etc/helix/site.env" <<'EOF'
# Baked default for the native AMI. Operator edits this, then re-runs the PKI +
# restarts the stack (see cloud/ami/README.md — the leaf certs are issued from
# APP_DOMAIN/MQTT_BROKER_PUBLIC_HOSTS, so they must be re-issued after a change).
APP_DOMAIN=localhost
PUBLIC_APP_URL=http://localhost:3000
ACME_EMAIL=ops@example.com

# Cloudflare API token (Zone:DNS:Edit on the zone). Enables the ACME DNS-01
# challenge, which is REQUIRED for the *.port.<domain> wildcard cert and for any
# domain fronted by Cloudflare's proxy. Empty → HTTP-01, no wildcard.
CLOUDFLARE_API_TOKEN=

# Extra SANs (comma-separated) for the MQTT broker cert and the Helix Server mTLS
# listener on :4001 — i.e. every public host/IP a DEVICE dials. Cloudflare's proxy
# only carries HTTP(S), so devices must reach :8883 and :4001 at the origin
# directly: put the origin's Elastic IP here as well as the public hostname.
MQTT_BROKER_PUBLIC_HOSTS=

# DBOS workflow engine (Inngest is not installed on this AMI). `dispatch` MUST be
# present or no workflows run (default roles are gateway,ingest,writer only).
HELIX_SERVER_ROLES=gateway,ingest,writer,dispatch
HELIX_WORKFLOW_MODE=dbos
HELIX_DBOS_SCHEMA=dbos
HELIX_WORKFLOW_CONCURRENCY=100
HELIX_WORKFLOW_LLM_MS=200

STORAGE_PROVIDER=FS
FS_STORAGE_ROOT=/var/lib/helix/storage
EMAIL_LOG_CONTENT=true

LOCAL_SYSADMIN_EMAIL=admin@helix.test
LOCAL_SYSADMIN_NAME=Administrator
LOCAL_SYSADMIN_PASSWORD=HelixLoadTest-2026

ENABLE_OBSERVABILITY=0

# WebRTC TURN relay (helix-coturn). The fallback path for the P2P data plane, for
# peers that cannot find a direct route. All of this is optional: with it unset,
# direct peers still connect and anything else uses the relayed data plane.
#
#   TURN_PUBLIC_IP  this box's PUBLIC address — coturn binds the private one but
#                   must advertise the public one, or it hands out relay
#                   candidates nobody can reach.
#   TURN_DOMAIN     the hostname clients dial (e.g. turn.example.com). Must be a
#                   DNS-ONLY record (Cloudflare: grey cloud) pointing here — the
#                   proxy carries HTTP(S) only and will not relay TURN.
#
# Also open the ports: `helix ami sg-turn --sg <id>` (3478, 5349, 49160-49259).
# Credentials are ephemeral and signed with TURN_STATIC_AUTH_SECRET from
# secrets.env; there is no shared TURN password.
TURN_PUBLIC_IP=
TURN_DOMAIN=
TURN_REALM=
EOF
chmod 600 "$ROOTFS/etc/helix/site.env"

# Keep console/session units unmasked: the manifest masks getty/logind for the
# container's shared /dev, but this is a real host needing serial console + SSH.
log "gen-units.py (exclude inngest,redis; keep console/session units)"
in_chroot systemctl set-default multi-user.target
in_chroot python3 /opt/helix/bin/gen-units.py --exclude inngest redis \
  --no-mask getty.target getty@.service autovt@.service console-getty.service \
            serial-getty@.service systemd-logind.service

in_chroot apt-get clean
rm -rf "$ROOTFS/var/lib/apt/lists"/*
