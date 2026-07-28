#!/usr/bin/env bash
# Derive the appliance observability configs from the cloud/ ORIGINALS at build
# time. The originals use docker-compose service hostnames (e.g. tempo:4317);
# the appliance is one network namespace, so everything is 127.0.0.1 with a
# couple of ports moved to dodge single-namespace collisions. Only the configs
# whose appliance form is a pure host/port/path swap are derived here; the two
# that are STRUCTURALLY different ship as appliance files:
#   - prometheus.yml  (drops the cadvisor/blackbox/exporter scrape jobs)
#   - config.alloy    (journald source instead of docker.sock discovery)
set -euo pipefail

SRC="${1:-/etc/helix/observability-src}"   # copy of cloud/observability
DST="${2:-/etc/helix/observability}"

# Grafana datasources: docker service names -> localhost.
sed -E 's#http://(prometheus|loki|tempo):#http://127.0.0.1:#g' \
  "${SRC}/grafana/provisioning/datasources/datasources.yml" \
  > "${DST}/grafana/provisioning/datasources/datasources.yml"

# Loki: keep its storage on the persistent volume.
sed 's#/loki#/var/lib/helix/loki#g' "${SRC}/loki/loki.yml" > "${DST}/loki.yml"

# Tempo: move its OTLP receiver off 4317/4318 (the otel-collector owns those in
# one namespace) and put storage on the volume.
sed -e 's#0.0.0.0:4317#0.0.0.0:4417#' -e 's#0.0.0.0:4318#0.0.0.0:4418#' \
    -e 's#/var/tempo#/var/lib/helix/tempo#g' \
  "${SRC}/tempo/tempo.yml" > "${DST}/tempo.yml"

# OTel collector: export to Tempo's moved OTLP port on localhost.
sed 's#endpoint: tempo:4317#endpoint: 127.0.0.1:4417#' \
  "${SRC}/otel-collector/config.yml" > "${DST}/otel-collector.yml"

echo "localize-obs: derived loki/tempo/otel-collector/datasources from ${SRC}"
