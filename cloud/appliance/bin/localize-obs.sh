#!/usr/bin/env bash
# Derive the appliance observability configs from the cloud/ originals: rewrite the
# docker-compose service hostnames to 127.0.0.1 (one network namespace), moving a
# couple of ports to dodge collisions. Structurally-different configs ship as-is.
set -euo pipefail

SRC="${1:-/etc/helix/observability-src}"   # copy of cloud/observability
DST="${2:-/etc/helix/observability}"

# Grafana datasources: docker service names -> localhost.
sed -E 's#http://(prometheus|loki|tempo):#http://127.0.0.1:#g' \
  "${SRC}/grafana/provisioning/datasources/datasources.yml" \
  > "${DST}/grafana/provisioning/datasources/datasources.yml"

# Loki: keep its storage on the persistent volume.
sed 's#/loki#/var/lib/helix/loki#g' "${SRC}/loki/loki.yml" > "${DST}/loki.yml"

# Tempo: move its OTLP receiver off 4317/4318 (otel-collector owns those) and storage onto the volume.
sed -e 's#0.0.0.0:4317#0.0.0.0:4417#' -e 's#0.0.0.0:4318#0.0.0.0:4418#' \
    -e 's#/var/tempo#/var/lib/helix/tempo#g' \
  "${SRC}/tempo/tempo.yml" > "${DST}/tempo.yml"

# OTel collector: export to Tempo's moved OTLP port on localhost.
sed 's#endpoint: tempo:4317#endpoint: 127.0.0.1:4417#' \
  "${SRC}/otel-collector/config.yml" > "${DST}/otel-collector.yml"

echo "localize-obs: derived loki/tempo/otel-collector/datasources from ${SRC}"
