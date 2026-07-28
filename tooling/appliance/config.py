from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import StrEnum

# Consecutive offsets from a base port, so a whole appliance's host ports are
# `base + 1`, `base + 2`, … — pick a distinct base per instance to run several
# appliances in parallel without clashing. Order is stable; do not renumber.
PORT_OFFSETS: dict[str, int] = {
    "postgres_port": 1,
    "step_ca_port": 2,
    "redpanda_port": 3,
    "mosquitto_device_port": 4,
    "mosquitto_service_port": 5,
    "public_http_port": 6,
    "device_mtls_port": 7,
}


class ServerMode(StrEnum):
    """How the helix-server app runs against the appliance infra.

    HOST     — run helix-server on the host from source (fast dev loop), wired to
               the appliance's mapped infra ports.
    PREBAKED — build helix-server and run it inside the appliance container.
    """

    HOST = "host"
    PREBAKED = "prebaked"


@dataclass(frozen=True)
class ApplianceConfig:
    """A single, self-contained appliance instance.

    Ports are deliberately off the defaults so an e2e appliance never clashes
    with a developer's own running stack (or another appliance).
    """

    image: str = "helix-appliance:e2e"
    container: str = "helix-e2e"
    volume: str = "helix-e2e-data"

    # Infra ports mapped from the container to 127.0.0.1 on the host.
    postgres_port: int = 25432
    step_ca_port: int = 29000
    redpanda_port: int = 29092
    mosquitto_device_port: int = 28883
    mosquitto_service_port: int = 28884

    # Ports the helix-server app listens on (host mode binds these on the host;
    # prebaked mode maps them out of the container).
    public_http_port: int = 24000
    device_mtls_port: int = 24001

    mode: ServerMode = ServerMode.HOST

    # JS runtime for the prebaked server. "node" (default) or "bun" — the bundle
    # is self-contained ESM, so bun runs the same dist/index.js. Deno untested.
    runtime: str = "node"

    # Optional container resource cap (for load testing the ingestion subset).
    cpus: float | None = None
    memory: str | None = None

    # How helix-server roles are partitioned across processes in prebaked mode.
    # None => one combined process (gateway+ingest+writer), the historical
    # behavior. Otherwise each inner tuple is one process's HELIX_SERVER_ROLES,
    # e.g. (("gateway", "ingest"), ("writer",)) runs two processes so the work
    # spreads across cores. Processes coordinate via mosquitto/kafka/postgres.
    server_roles: tuple[tuple[str, ...], ...] | None = None

    # Optional event-queue tuning exported to the prebaked helix-server. Partition
    # count is set at topic creation; writer concurrency is how many partitions the
    # single writer consumes at once (overlapping DB/commit I/O). None keeps the
    # helix-server env defaults.
    event_topic_partitions: int | None = None
    writer_concurrency: int | None = None
    writer_batch_size: int | None = None

    # Workflow load-test tuning exported to the prebaked helix-server. `mode`
    # picks the Inngest vs inline-direct path; `concurrency` is the run/worker
    # cap that sets the throughput ceiling; `llm_ms` is the fake summarize delay.
    workflow_mode: str | None = None
    workflow_concurrency: int | None = None
    workflow_llm_ms: int | None = None
    # 'blocking' (fake in-worker sleep) or 'infer' (step.ai.infer offload).
    workflow_llm_mode: str | None = None
    # Give each dispatch process its own DBOS system schema (dbos_0, dbos_1, ...)
    # so instances stop contending on one shared coordination DB.
    workflow_dbos_shard: bool = False

    # Container-internal paths (stable across appliance versions).
    step_ca_root_cert: str = "/var/lib/helix/step-ca/certs/root_ca.crt"
    step_ca_jwk: str = "/var/lib/helix/step-ca/jwk/device-provisioner.jwk.json"
    server_pki_dir: str = "/var/lib/helix/mqtt/helix-server"

    extra_ports: dict[int, int] = field(default_factory=dict)

    @classmethod
    def from_base_port(cls, base_port: int, **overrides: object) -> ApplianceConfig:
        """Build a config whose host ports are `base_port + PORT_OFFSETS[*]` and
        whose container + volume are suffixed with the base, so it never clashes
        with the default instance or another base. Extra kwargs override fields
        (e.g. mode=)."""
        ports = {name: base_port + offset for name, offset in PORT_OFFSETS.items()}
        return cls(
            container=f"helix-e2e-{base_port}",
            volume=f"helix-e2e-{base_port}-data",
            **ports,  # type: ignore[arg-type]
            **overrides,  # type: ignore[arg-type]
        )

    def with_base_port(self, base_port: int) -> ApplianceConfig:
        """Re-key this config's ports/names to a new base, preserving mode + any
        other tuning already set."""
        ports = {name: base_port + offset for name, offset in PORT_OFFSETS.items()}
        return replace(
            self,
            container=f"helix-e2e-{base_port}",
            volume=f"helix-e2e-{base_port}-data",
            **ports,  # type: ignore[arg-type]
        )

    def port_mappings(self) -> dict[int, int]:
        """host_port -> container_port for `docker run -p`."""
        mappings = {
            self.postgres_port: 5432,
            self.step_ca_port: 9000,
            self.redpanda_port: 9092,
            self.mosquitto_device_port: 8883,
            self.mosquitto_service_port: 8884,
        }
        # In prebaked mode helix-server runs inside the container, so its ports
        # must be published; in host mode it binds these on the host directly.
        if self.mode is ServerMode.PREBAKED:
            mappings[self.public_http_port] = 4000
            mappings[self.device_mtls_port] = 4001
        mappings.update(self.extra_ports)
        return mappings
