#!/usr/bin/env bash
# =============================================================================
# install-observability.sh — download the observability stack ON DEMAND.
#
# The observability binaries (Grafana, Prometheus, Loki, Tempo, Alloy, the OTel
# collector, exporters) are NOT baked into the appliance image — they are the
# bulk of its size and most sites never enable them. Instead the sysadmin runs
# this once to fetch them onto the PERSISTENT data volume
# (/var/lib/helix/observability/), so they survive container recreation and
# only need installing once per site.
#
# Usage (inside the container, as root):
#   /opt/helix/bin/install-observability.sh            # install if missing
#   /opt/helix/bin/install-observability.sh --force    # re-download all
# Then:
#   systemctl start helix-observability.target
#
# The systemd units point at /var/lib/helix/observability/bin and .../grafana.
# =============================================================================
set -euo pipefail

# Pinned to confirmed-available release assets (validated 2026-06-26).
PROMETHEUS_VERSION=3.12.0
LOKI_VERSION=3.7.3
TEMPO_VERSION=2.10.7
ALLOY_VERSION=1.17.0
OTELCOL_VERSION=0.155.0
NODE_EXPORTER_VERSION=1.11.1
POSTGRES_EXPORTER_VERSION=0.19.1
REDIS_EXPORTER_VERSION=1.86.0
CADVISOR_VERSION=0.49.1
GRAFANA_VERSION=13.0.1

ROOT=/var/lib/helix/observability
BIN="${ROOT}/bin"
GRAFANA_DIR="${ROOT}/grafana"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

for c in curl tar unzip; do command -v "$c" >/dev/null || { echo "missing: $c" >&2; exit 1; }; done
mkdir -p "${BIN}" "${GRAFANA_DIR}"

dl() { curl -fsSL --retry 8 --retry-delay 3 --retry-all-errors --connect-timeout 30 "$1" -o "$2"; }
have() { [[ -x "${BIN}/$1" && "${FORCE}" -eq 0 ]]; }

# ---- single binaries --------------------------------------------------------
if ! have prometheus; then
  echo "==> prometheus ${PROMETHEUS_VERSION}"
  dl "https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz" "${TMP}/p.tgz"
  tar -xzf "${TMP}/p.tgz" -C "${TMP}"; cp "${TMP}"/prometheus-*/prometheus "${TMP}"/prometheus-*/promtool "${BIN}/"
fi
if ! have loki; then
  echo "==> loki ${LOKI_VERSION}"
  dl "https://github.com/grafana/loki/releases/download/v${LOKI_VERSION}/loki-linux-amd64.zip" "${TMP}/loki.zip"
  unzip -o "${TMP}/loki.zip" -d "${TMP}" >/dev/null; cp "${TMP}/loki-linux-amd64" "${BIN}/loki"
fi
if ! have alloy; then
  echo "==> alloy ${ALLOY_VERSION}"
  dl "https://github.com/grafana/alloy/releases/download/v${ALLOY_VERSION}/alloy-linux-amd64.zip" "${TMP}/alloy.zip"
  unzip -o "${TMP}/alloy.zip" -d "${TMP}" >/dev/null; cp "${TMP}/alloy-linux-amd64" "${BIN}/alloy"
fi
if ! have tempo; then
  echo "==> tempo ${TEMPO_VERSION}"
  dl "https://github.com/grafana/tempo/releases/download/v${TEMPO_VERSION}/tempo_${TEMPO_VERSION}_linux_amd64.tar.gz" "${TMP}/tempo.tgz"
  tar -xzf "${TMP}/tempo.tgz" -C "${BIN}" tempo
fi
if ! have otelcol-contrib; then
  echo "==> otelcol-contrib ${OTELCOL_VERSION}"
  dl "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol-contrib_${OTELCOL_VERSION}_linux_amd64.tar.gz" "${TMP}/otel.tgz"
  tar -xzf "${TMP}/otel.tgz" -C "${BIN}" otelcol-contrib
fi
if ! have node_exporter; then
  echo "==> node_exporter ${NODE_EXPORTER_VERSION}"
  dl "https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz" "${TMP}/ne.tgz"
  tar -xzf "${TMP}/ne.tgz" -C "${TMP}"; cp "${TMP}"/node_exporter-*/node_exporter "${BIN}/"
fi
if ! have postgres_exporter; then
  echo "==> postgres_exporter ${POSTGRES_EXPORTER_VERSION}"
  dl "https://github.com/prometheus-community/postgres_exporter/releases/download/v${POSTGRES_EXPORTER_VERSION}/postgres_exporter-${POSTGRES_EXPORTER_VERSION}.linux-amd64.tar.gz" "${TMP}/pe.tgz"
  tar -xzf "${TMP}/pe.tgz" -C "${TMP}"; cp "${TMP}"/postgres_exporter-*/postgres_exporter "${BIN}/"
fi
if ! have redis_exporter; then
  echo "==> redis_exporter ${REDIS_EXPORTER_VERSION}"
  dl "https://github.com/oliver006/redis_exporter/releases/download/v${REDIS_EXPORTER_VERSION}/redis_exporter-v${REDIS_EXPORTER_VERSION}.linux-amd64.tar.gz" "${TMP}/re.tgz"
  tar -xzf "${TMP}/re.tgz" -C "${TMP}"; cp "${TMP}"/redis_exporter-*/redis_exporter "${BIN}/"
fi
# mosquitto_exporter has no upstream binary release — it is vendored into the
# image (see Dockerfile) and staged from there rather than downloaded.
if ! have mosquitto_exporter && [[ -f /opt/helix/vendor/mosquitto_exporter ]]; then
  echo "==> mosquitto_exporter (vendored)"
  cp /opt/helix/vendor/mosquitto_exporter "${BIN}/mosquitto_exporter"
fi
# cadvisor ships a single raw binary (not a tarball). In the single-container
# appliance it runs in raw cgroup mode (no docker) so each systemd service shows
# up as a container_* series — same metrics as the cloud, labelled by cgroup id.
if ! have cadvisor; then
  echo "==> cadvisor ${CADVISOR_VERSION}"
  dl "https://github.com/google/cadvisor/releases/download/v${CADVISOR_VERSION}/cadvisor-v${CADVISOR_VERSION}-linux-amd64" "${BIN}/cadvisor"
fi

# ---- grafana (tarball -> persistent, `current` symlink the unit runs) -------
if [[ ! -x "${GRAFANA_DIR}/current/bin/grafana" || "${FORCE}" -eq 1 ]]; then
  echo "==> grafana ${GRAFANA_VERSION}"
  dl "https://dl.grafana.com/oss/release/grafana-${GRAFANA_VERSION}.linux-amd64.tar.gz" "${TMP}/grafana.tgz"
  rm -rf "${GRAFANA_DIR}/grafana-${GRAFANA_VERSION}"
  tar -xzf "${TMP}/grafana.tgz" -C "${GRAFANA_DIR}"
  ln -sfn "${GRAFANA_DIR}/grafana-${GRAFANA_VERSION}" "${GRAFANA_DIR}/current"
fi

chmod +x "${BIN}"/* 2>/dev/null || true
# observ runs the units; let it read the install + own the data dirs it creates.
chown -R observ:observ "${ROOT}" 2>/dev/null || true

echo ""
echo "Observability installed under ${ROOT}. Start it with:"
echo "    systemctl start helix-observability.target"
echo "Grafana will be on :3001 (admin / set GRAFANA_ADMIN_PASSWORD in site.env)."
