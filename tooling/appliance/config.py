from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import StrEnum

# Offsets from a base port (distinct base per instance to run appliances in parallel); do not renumber.
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
    """How the helix-server app runs against the appliance infra (HOST or PREBAKED)."""

    HOST = "host"
    PREBAKED = "prebaked"


@dataclass(frozen=True)
class ApplianceConfig:
    """A single, self-contained appliance instance (ports off the defaults to avoid clashes)."""

    image: str = "helix-appliance:e2e"
    container: str = "helix-e2e"
    volume: str = "helix-e2e-data"

    # Infra ports mapped from the container to 127.0.0.1 on the host.
    postgres_port: int = 25432
    step_ca_port: int = 29000
    redpanda_port: int = 29092
    mosquitto_device_port: int = 28883
    mosquitto_service_port: int = 28884

    # Ports the helix-server app listens on (host mode binds on host; prebaked maps out).
    public_http_port: int = 24000
    device_mtls_port: int = 24001

    mode: ServerMode = ServerMode.HOST

    # JS runtime for the prebaked server: "node" (default) or "bun" (same self-contained ESM).
    runtime: str = "node"

    # Optional container resource cap (for load testing the ingestion subset).
    cpus: float | None = None
    memory: str | None = None

    # How prebaked helix-server roles are split across processes; None => one combined process.
    # Each inner tuple is one process's HELIX_SERVER_ROLES, e.g. (("gateway","ingest"),("writer",)).
    server_roles: tuple[tuple[str, ...], ...] | None = None

    # Optional event-queue tuning exported to the prebaked helix-server (None keeps env defaults).
    event_topic_partitions: int | None = None
    writer_concurrency: int | None = None
    writer_batch_size: int | None = None

    # Workflow load-test tuning: mode picks Inngest vs inline, concurrency caps throughput.
    workflow_mode: str | None = None
    workflow_concurrency: int | None = None
    workflow_llm_ms: int | None = None
    # 'blocking' (fake in-worker sleep) or 'infer' (step.ai.infer offload).
    workflow_llm_mode: str | None = None
    # Give each dispatch process its own DBOS system schema to stop coordination-DB contention.
    workflow_dbos_shard: bool = False

    # Container-internal paths (stable across appliance versions).
    step_ca_root_cert: str = "/var/lib/helix/step-ca/certs/root_ca.crt"
    step_ca_jwk: str = "/var/lib/helix/step-ca/jwk/device-provisioner.jwk.json"
    server_pki_dir: str = "/var/lib/helix/mqtt/helix-server"

    extra_ports: dict[int, int] = field(default_factory=dict)

    @classmethod
    def from_base_port(cls, base_port: int, **overrides: object) -> ApplianceConfig:
        """Build a config with host ports `base_port + PORT_OFFSETS[*]`, base-suffixed names."""
        ports = {name: base_port + offset for name, offset in PORT_OFFSETS.items()}
        return cls(
            container=f"helix-e2e-{base_port}",
            volume=f"helix-e2e-{base_port}-data",
            **ports,  # type: ignore[arg-type]
            **overrides,  # type: ignore[arg-type]
        )

    def with_base_port(self, base_port: int) -> ApplianceConfig:
        """Re-key this config's ports/names to a new base, preserving tuning already set."""
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
        # Prebaked helix-server runs in-container so its ports must be published.
        if self.mode is ServerMode.PREBAKED:
            mappings[self.public_http_port] = 4000
            mappings[self.device_mtls_port] = 4001
        mappings.update(self.extra_ports)
        return mappings
