from __future__ import annotations

import secrets
import shutil
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import click

from tooling.appliance import Appliance, ApplianceConfig, HelixServer, ServerMode
from tooling.loadtest.certs import DEVICE_PREFIX, provision_pool
from tooling.loadtest.generator import DeviceCert, LoadResult, run_load
from tooling.loadtest.routing import RoutingResult, run_routing_load

DRAIN_TIMEOUT_SECONDS = 45


def _percentiles(values: list[float], points: tuple[int, ...]) -> list[float]:
    if not values:
        return [0.0 for _ in points]
    ordered = sorted(values)
    last = len(ordered) - 1
    result: list[float] = []
    for point in points:
        rank = last * (point / 100.0)
        low = int(rank)
        high = min(low + 1, last)
        result.append(round(ordered[low] + (ordered[high] - ordered[low]) * (rank - low), 1))
    return result


@dataclass
class Sample:
    peak_cpu: float = 0.0
    peak_mem: float = 0.0
    peak_lag: int = 0
    breakdown: dict[str, float] = field(default_factory=dict)


class _Sampler(threading.Thread):
    def __init__(self, appliance: Appliance, interval: float = 2.0) -> None:
        super().__init__(daemon=True)
        self.appliance = appliance
        self.interval = interval
        self.result = Sample()
        self._peak_total = 0.0
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            stats = self.appliance.container_stats()
            self.result.peak_cpu = max(self.result.peak_cpu, stats["cpu_percent"])
            self.result.peak_mem = max(self.result.peak_mem, stats["mem_mib"])
            self.result.peak_lag = max(self.result.peak_lag, self.appliance.consumer_lag())
            # Blocks for `interval` seconds, pacing the loop.
            cpu = self.appliance.per_service_cpu(self.interval)
            total = sum(cpu.values())
            if total > self._peak_total:
                self._peak_total = total
                self.result.breakdown = cpu

    def stop(self) -> Sample:
        self._stop.set()
        self.join(timeout=15)
        return self.result


def _drain(appliance: Appliance, target: int) -> int:
    deadline = time.monotonic() + DRAIN_TIMEOUT_SECONDS
    previous = -1
    while time.monotonic() < deadline:
        current = appliance.count_events_prefix(DEVICE_PREFIX)
        if current >= target or current == previous:
            return current
        previous = current
        time.sleep(2)
    return appliance.count_events_prefix(DEVICE_PREFIX)


WORKFLOW_DRAIN_TIMEOUT_SECONDS = 120
WORKFLOW_SETTLE_TIMEOUT_SECONDS = 150
WORKFLOW_DISPATCH_GROUP = "helix-workflow-dispatch"


@dataclass
class WorkflowSample:
    peak_cpu: float = 0.0
    peak_mem: float = 0.0
    peak_dispatch_lag: int = 0
    peak_pending: int = 0
    peak_inngest_cpu: float = 0.0
    peak_inngest_mem: float = 0.0
    peak_pg_cpu: float = 0.0
    breakdown: dict[str, float] = field(default_factory=dict)


class _WorkflowSampler(threading.Thread):
    # Inngest in its own container is sampled separately so the app-vs-engine bottleneck is visible.

    def __init__(self, appliance: Appliance, interval: float = 2.0) -> None:
        super().__init__(daemon=True)
        self.appliance = appliance
        self.interval = interval
        self.result = WorkflowSample()
        self._peak_total = 0.0
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            stats = self.appliance.container_stats()
            self.result.peak_cpu = max(self.result.peak_cpu, stats["cpu_percent"])
            self.result.peak_mem = max(self.result.peak_mem, stats["mem_mib"])
            self.result.peak_dispatch_lag = max(
                self.result.peak_dispatch_lag, self.appliance.consumer_lag(WORKFLOW_DISPATCH_GROUP)
            )
            self.result.peak_pending = max(
                self.result.peak_pending, self.appliance.inngest_pending_runs()
            )
            inngest_container = self.appliance.external_inngest_container
            if inngest_container is not None:
                istats = self.appliance.named_container_stats(inngest_container)
                self.result.peak_inngest_cpu = max(
                    self.result.peak_inngest_cpu, istats["cpu_percent"]
                )
                self.result.peak_inngest_mem = max(self.result.peak_inngest_mem, istats["mem_mib"])
            pg_container = self.appliance.external_pg_container
            if pg_container is not None:
                self.result.peak_pg_cpu = max(
                    self.result.peak_pg_cpu,
                    self.appliance.named_container_stats(pg_container)["cpu_percent"],
                )
            cpu = self.appliance.per_service_cpu(self.interval)
            total = sum(cpu.values())
            if total > self._peak_total:
                self._peak_total = total
                self.result.breakdown = cpu

    def stop(self) -> WorkflowSample:
        self._stop.set()
        self.join(timeout=15)
        return self.result


def _drain_workflow(appliance: Appliance, run_id: str, target: int) -> int:
    deadline = time.monotonic() + WORKFLOW_DRAIN_TIMEOUT_SECONDS
    previous = -1
    while time.monotonic() < deadline:
        current = appliance.count_workflow_results(run_id)
        if current >= target or current == previous:
            return current
        previous = current
        time.sleep(3)
    return appliance.count_workflow_results(run_id)


def _settle_workflow(appliance: Appliance) -> None:
    # Wait for backlog/lag to clear between ramp steps so carryover doesn't contaminate the next.
    deadline = time.monotonic() + WORKFLOW_SETTLE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if (
            appliance.inngest_pending_runs() <= 0
            and appliance.consumer_lag(WORKFLOW_DISPATCH_GROUP) <= 0
        ):
            return
        time.sleep(3)


def _measure_workflow(
    appliance: Appliance,
    devices: list[DeviceCert],
    *,
    rate: float,
    duration: float,
    payload: int,
    workers: int,
) -> dict[str, Any]:
    run_id = secrets.token_hex(4)
    db_before = appliance.inngest_db_size_mb()
    sampler = _WorkflowSampler(appliance)
    sampler.start()

    result = run_load(
        host="127.0.0.1",
        port=appliance.config.mosquitto_device_port,
        devices=devices,
        rate=rate,
        duration=duration,
        payload_size=payload,
        run_id=run_id,
        workers=workers,
    )

    completed_during = appliance.count_workflow_results(run_id, "completed")
    done = _drain_workflow(appliance, run_id, result.emitted)
    sample = sampler.stop()
    db_after = appliance.inngest_db_size_mb()
    completed = appliance.count_workflow_results(run_id, "completed")
    skipped = appliance.count_workflow_results(run_id, "skipped")
    latency = appliance.workflow_latency_ms(run_id)

    return {
        "target": int(rate),
        "emitted": result.emitted,
        "completed": completed,
        "skipped": skipped,
        "done": done,
        "wf_rate": round(completed / duration, 0),
        "during_rate": round(completed_during / duration, 0),
        "backlog": result.emitted - done,
        "p50": latency["p50"],
        "p95": latency["p95"],
        "p99": latency["p99"],
        "cpu": sample.peak_cpu,
        "mem": round(sample.peak_mem),
        "klag": sample.peak_dispatch_lag,
        "pending": sample.peak_pending,
        "inngest_cpu": sample.peak_inngest_cpu,
        "inngest_mem": round(sample.peak_inngest_mem),
        "pg_cpu": sample.peak_pg_cpu,
        "db_delta": round(db_after - db_before, 1),
        "breakdown": sample.breakdown,
    }


def _measure(
    appliance: Appliance,
    devices: list[DeviceCert],
    *,
    rate: float,
    duration: float,
    payload: int,
    workers: int,
) -> dict[str, Any]:
    run_id = secrets.token_hex(4)
    baseline = appliance.count_events_prefix(DEVICE_PREFIX)
    sampler = _Sampler(appliance)
    sampler.start()

    result = run_load(
        host="127.0.0.1",
        port=appliance.config.mosquitto_device_port,
        devices=devices,
        rate=rate,
        duration=duration,
        payload_size=payload,
        run_id=run_id,
        workers=workers,
    )

    ingested_during = appliance.count_events_prefix(DEVICE_PREFIX) - baseline
    total = _drain(appliance, baseline + result.emitted) - baseline
    sample = sampler.stop()
    latency = appliance.ingest_latency_ms(run_id)

    return {
        "target": int(rate),
        "emitted": result.emitted,
        "ingest_rate": round(ingested_during / duration, 0),
        "loss": result.emitted - total,
        "p50": latency["p50"],
        "p95": latency["p95"],
        "p99": latency["p99"],
        "cpu": sample.peak_cpu,
        "mem": round(sample.peak_mem),
        "lag": sample.peak_lag,
        "breakdown": sample.breakdown,
    }


def _measure_routing(
    appliance: Appliance,
    devices: list[DeviceCert],
    *,
    rate: float,
    duration: float,
    workers: int,
    think_ms: int,
) -> dict[str, Any]:
    run_id = secrets.token_hex(4)
    sampler = _Sampler(appliance)
    sampler.start()

    result = run_routing_load(
        host="127.0.0.1",
        mqtt_port=appliance.config.mosquitto_device_port,
        ws_port=appliance.config.public_http_port,
        devices=devices,
        rate=rate,
        duration=duration,
        run_id=run_id,
        workers=workers,
        think_ms=think_ms,
    )

    sample = sampler.stop()
    p50, p95, p99 = _percentiles(result.rtts_ms, (50, 95, 99))
    return {
        "target": int(rate),
        "sent": result.sent,
        "completed": result.completed,
        "route_rate": round(result.completed / duration, 0),
        "loss": result.loss,
        "p50": p50,
        "p95": p95,
        "p99": p99,
        "cpu": sample.peak_cpu,
        "mem": round(sample.peak_mem),
        "breakdown": sample.breakdown,
    }


def _measure_mixed(
    appliance: Appliance,
    devices: list[DeviceCert],
    *,
    ingest_rate: float,
    route_rate: float,
    duration: float,
    payload: int,
    workers: int,
    think_ms: int,
) -> dict[str, Any]:
    run_id = secrets.token_hex(4)
    baseline = appliance.count_events_prefix(DEVICE_PREFIX)
    sampler = _Sampler(appliance)
    sampler.start()

    ingest_box: dict[str, LoadResult] = {}
    route_box: dict[str, RoutingResult] = {}

    def _ingest() -> None:
        ingest_box["result"] = run_load(
            host="127.0.0.1",
            port=appliance.config.mosquitto_device_port,
            devices=devices,
            rate=ingest_rate,
            duration=duration,
            payload_size=payload,
            run_id=run_id,
            workers=workers,
        )

    def _route() -> None:
        route_box["result"] = run_routing_load(
            host="127.0.0.1",
            mqtt_port=appliance.config.mosquitto_device_port,
            ws_port=appliance.config.public_http_port,
            devices=devices,
            rate=route_rate,
            duration=duration,
            run_id=run_id,
            workers=workers,
            think_ms=think_ms,
        )

    threads = [threading.Thread(target=_ingest), threading.Thread(target=_route)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    ingest = ingest_box["result"]
    route = route_box["result"]
    ingested_during = appliance.count_events_prefix(DEVICE_PREFIX) - baseline
    total = _drain(appliance, baseline + ingest.emitted) - baseline
    sample = sampler.stop()
    latency = appliance.ingest_latency_ms(run_id)
    rp50, rp95, rp99 = _percentiles(route.rtts_ms, (50, 95, 99))
    return {
        "ingest": {
            "target": int(ingest_rate),
            "rate": round(ingested_during / duration, 0),
            "loss": ingest.emitted - total,
            "p50": latency["p50"],
            "p95": latency["p95"],
            "p99": latency["p99"],
            "lag": sample.peak_lag,
        },
        "routing": {
            "target": int(route_rate),
            "rate": round(route.completed / duration, 0),
            "loss": route.loss,
            "p50": rp50,
            "p95": rp95,
            "p99": rp99,
        },
        "cpu": sample.peak_cpu,
        "mem": round(sample.peak_mem),
        "breakdown": sample.breakdown,
    }


@contextmanager
def _stack(
    config: ApplianceConfig, *, build: bool, device_count: int
) -> Iterator[tuple[Appliance, list[DeviceCert]]]:
    appliance = Appliance(config)
    if build and not appliance.image_exists():
        appliance.build()
    if not appliance.image_exists():
        raise click.ClickException(
            f"image {config.image} not found; run 'helix appliance build' or pass --build."
        )

    work_dir = Path(tempfile.mkdtemp(prefix="helix-loadtest-"))
    server = HelixServer(appliance, work_dir)
    appliance.up(fresh=True)
    try:
        appliance.wait_ready()
        appliance.prepare_host_access()
        appliance.run_migrations()
        server.start()
        click.echo(f"provisioning {device_count} device certs ...")
        devices = provision_pool(
            appliance, server.public_base_url, device_count, work_dir / "certs"
        )
        # step-ca was only for provisioning; cap down to the ingestion subset now.
        appliance.isolate_ingestion_subset()
        yield appliance, devices
    finally:
        server.stop()
        appliance.down(purge=True)
        shutil.rmtree(work_dir, ignore_errors=True)


@contextmanager
def _workflow_stack(
    config: ApplianceConfig,
    *,
    build: bool,
    device_count: int,
    external_pg: bool = False,
    external_inngest: bool = False,
    inngest_cpus: float = 2.0,
    inngest_memory: str = "4g",
    fast_pg: bool = False,
) -> Iterator[tuple[Appliance, list[DeviceCert]]]:
    """Like _stack, but keeps Inngest + Redis under the cap; external_pg/inngest isolate infra."""
    dbos = config.workflow_mode == "dbos"
    if external_inngest:
        external_pg = True
    appliance = Appliance(config)
    if build and not appliance.image_exists():
        appliance.build()
    if not appliance.image_exists():
        raise click.ClickException(
            f"image {config.image} not found; run 'helix appliance build' or pass --build."
        )

    work_dir = Path(tempfile.mkdtemp(prefix="helix-wfloadtest-"))
    server = HelixServer(appliance, work_dir)
    ext_pg_name = f"{config.container}-extpg"
    ext_redis_name = f"{config.container}-redis"
    ext_inngest_name = f"{config.container}-inngest"
    fake_llm_name = f"{config.container}-fakellm"
    dbos_pg_prefix = f"{config.container}-dbospg"
    infer = config.workflow_llm_mode == "infer"
    n_dispatch = sum(1 for g in (config.server_roles or ()) if g == ("dispatch",))
    appliance.up(fresh=True)
    try:
        appliance.wait_ready()
        if infer:
            click.echo("starting fake OpenAI-compatible LLM endpoint ...")
            appliance.start_fake_llm(fake_llm_name, delay_ms=config.workflow_llm_ms or 5000)
        if external_pg:
            label = "fast (tmpfs, no-fsync) " if fast_pg else ""
            click.echo(f"starting external (uncapped) {label}app postgres ...")
            appliance.start_external_postgres(
                name=ext_pg_name,
                host_port=config.postgres_port + 1000,
                password="helixext",
                fast=fast_pg,
            )
        if dbos and config.workflow_dbos_shard:
            # One Postgres process per shard so DBOS commits spread past the single-PG WAL ceiling.
            click.echo(f"starting {n_dispatch} sharded DBOS postgres instances ...")
            appliance.start_dbos_shard_pgs(
                name_prefix=dbos_pg_prefix,
                count=n_dispatch,
                base_host_port=config.postgres_port + 2000,
                password="dbospw",
                fast=fast_pg,
            )
        elif dbos:
            # DBOS checkpoints live in a 'dbos' schema of the app database.
            appliance.psql("CREATE SCHEMA IF NOT EXISTS dbos", check=False)
        if external_inngest:
            click.echo(f"starting external inngest ({inngest_cpus} CPU) + redis ...")
            inngest_pg = appliance.provision_external_inngest_db(password="inngextpw")
            redis_uri = appliance.start_external_redis(ext_redis_name)
            appliance.start_external_inngest(
                ext_inngest_name,
                cpus=inngest_cpus,
                memory=inngest_memory,
                postgres_uri=inngest_pg,
                redis_uri=redis_uri,
                event_key=appliance.read_seeded_env("INNGEST_EVENT_KEY"),
                signing_key=appliance.read_seeded_env("INNGEST_SIGNING_KEY"),
            )
        appliance.prepare_host_access()
        appliance.run_migrations()
        # workflow_run_result is a load-test-only table (no drizzle migration); provision it
        # in whichever app DB the server writes to.
        appliance.psql(
            "CREATE TABLE IF NOT EXISTS workflow_run_result ("
            "id text PRIMARY KEY, run_id text NOT NULL, device_id text NOT NULL, "
            "message_id text NOT NULL, emitted_at_ns text, status text NOT NULL, "
            "mode text NOT NULL, completed_at timestamp DEFAULT now() NOT NULL); "
            "CREATE INDEX IF NOT EXISTS workflow_run_result_run_id_idx "
            "ON workflow_run_result (run_id)",
            check=False,
        )
        server.start()
        click.echo(f"provisioning {device_count} device certs ...")
        devices = provision_pool(
            appliance, server.public_base_url, device_count, work_dir / "certs"
        )
        # Drop the in-appliance Postgres only when the app DB is external.
        appliance.isolate_workflow_subset(external_infra=external_inngest or (dbos and external_pg))
        if config.workflow_mode == "inngest":
            if not external_inngest:
                appliance.wait_inngest_ready()
            click.echo("syncing workflow app with inngest ...")
            click.echo("  " + appliance.register_inngest_app())
        yield appliance, devices
    finally:
        server.stop()
        if dbos and config.workflow_dbos_shard:
            appliance.stop_dbos_shard_pgs(name_prefix=dbos_pg_prefix, count=n_dispatch)
        if infer:
            inngest_ip = (
                appliance._container_ip(ext_inngest_name) if external_inngest else "(in-appliance)"
            )
            app_ip = appliance._container_ip(config.container)
            click.echo(
                f"infer callers -> {appliance.fake_llm_caller_summary(fake_llm_name)}  "
                f"[inngest_ip={inngest_ip} appliance_ip={app_ip}]"
            )
            appliance.stop_fake_llm(fake_llm_name)
        if external_inngest:
            appliance.stop_external_inngest(ext_inngest_name)
            appliance.stop_external_redis(ext_redis_name)
        if external_pg:
            appliance.stop_external_postgres(ext_pg_name)
        appliance.down(purge=True)
        shutil.rmtree(work_dir, ignore_errors=True)


def _print_report(rows: list[dict[str, Any]], config: ApplianceConfig) -> None:
    cap = f"{config.cpus} CPU / {config.memory}" if config.cpus else "uncapped"
    click.echo(f"\nEvent ingestion load test — subset capped at {cap}")
    header = [
        "target/s",
        "ingest/s",
        "loss",
        "p50ms",
        "p95ms",
        "p99ms",
        "cpu%",
        "memMiB",
        "peakLag",
        "mosq%",
        "node%",
        "pg%",
        "rpk%",
    ]
    click.echo("  ".join(f"{h:>8}" for h in header))
    for row in rows:
        split = row.get("breakdown", {})
        cells = [
            row["target"],
            int(row["ingest_rate"]),
            row["loss"],
            row["p50"],
            row["p95"],
            row["p99"],
            row["cpu"],
            row["mem"],
            row["lag"],
            split.get("mosquitto", 0),
            split.get("node", 0),
            split.get("postgres", 0),
            split.get("redpanda", 0),
        ]
        click.echo("  ".join(f"{str(c):>8}" for c in cells))


def _breakdown_cells(row: dict[str, Any]) -> list[str]:
    split = row.get("breakdown", {})
    keys = ("mosquitto", "node", "postgres", "redpanda")
    return [str(split.get(key, 0)) for key in keys]


def _print_routing_report(rows: list[dict[str, Any]], config: ApplianceConfig) -> None:
    cap = f"{config.cpus} CPU / {config.memory}" if config.cpus else "uncapped"
    click.echo(f"\nGateway message-routing load test — subset capped at {cap}")
    header = [
        "target/s",
        "route/s",
        "sent",
        "done",
        "loss",
        "p50ms",
        "p95ms",
        "p99ms",
        "cpu%",
        "memMiB",
        "mosq%",
        "node%",
        "pg%",
        "rpk%",
    ]
    click.echo("  ".join(f"{h:>8}" for h in header))
    for row in rows:
        cells = [
            row["target"],
            int(row["route_rate"]),
            row["sent"],
            row["completed"],
            row["loss"],
            row["p50"],
            row["p95"],
            row["p99"],
            row["cpu"],
            row["mem"],
            *_breakdown_cells(row),
        ]
        click.echo("  ".join(f"{str(c):>8}" for c in cells))


def _print_mixed_report(row: dict[str, Any], config: ApplianceConfig) -> None:
    cap = f"{config.cpus} CPU / {config.memory}" if config.cpus else "uncapped"
    click.echo(f"\nCombined ingestion + routing load test — subset capped at {cap}")
    header = ["plane", "target/s", "rate/s", "loss", "p50ms", "p95ms", "p99ms", "peakLag"]
    click.echo("  ".join(f"{h:>9}" for h in header))
    ingest, routing = row["ingest"], row["routing"]
    click.echo(
        "  ".join(
            f"{str(c):>9}"
            for c in [
                "ingest",
                ingest["target"],
                int(ingest["rate"]),
                ingest["loss"],
                ingest["p50"],
                ingest["p95"],
                ingest["p99"],
                ingest["lag"],
            ]
        )
    )
    click.echo(
        "  ".join(
            f"{str(c):>9}"
            for c in [
                "routing",
                routing["target"],
                int(routing["rate"]),
                routing["loss"],
                routing["p50"],
                routing["p95"],
                routing["p99"],
                "-",
            ]
        )
    )
    split = " ".join(f"{k} {v}%" for k, v in row.get("breakdown", {}).items())
    click.echo(f"peak cpu {row['cpu']}%  mem {row['mem']}MiB  |  {split}")


def _print_workflow_report(rows: list[dict[str, Any]], config: ApplianceConfig, mode: str) -> None:
    cap = f"{config.cpus} CPU / {config.memory}" if config.cpus else "uncapped"
    llm = config.workflow_llm_ms if config.workflow_llm_ms is not None else "default"
    click.echo(
        f"\nWorkflow processing load test [{mode}] — subset capped at {cap}, "
        f"concurrency {config.workflow_concurrency}, llm {llm}ms"
    )
    header = [
        "target/s",
        "emit",
        "wf/s",
        "done",
        "backlog",
        "p50ms",
        "p95ms",
        "p99ms",
        "appCPU%",
        "memMiB",
        "inngCPU%",
        "pgCPU%",
        "kLag",
        "pending",
        "dbDMiB",
    ]
    click.echo("  ".join(f"{h:>8}" for h in header))
    for row in rows:
        cells = [
            row["target"],
            row["emitted"],
            int(row["wf_rate"]),
            row["done"],
            row["backlog"],
            row["p50"],
            row["p95"],
            row["p99"],
            row["cpu"],
            row["mem"],
            row.get("inngest_cpu", 0),
            row.get("pg_cpu", 0),
            row["klag"],
            row["pending"],
            row["db_delta"],
        ]
        click.echo("  ".join(f"{str(c):>8}" for c in cells))
    for row in rows:
        split = " ".join(f"{k} {v}%" for k, v in row.get("breakdown", {}).items())
        click.echo(f"  target {row['target']}/s cpu split: {split}")


_VALID_ROLES = ("gateway", "ingest", "writer")


def _parse_roles(spec: str | None) -> tuple[tuple[str, ...], ...] | None:
    # 'gateway+ingest,writer' -> process groups; every role must appear exactly once.
    if spec is None or spec.strip() == "":
        return None
    groups: list[tuple[str, ...]] = []
    seen: set[str] = set()
    for group in spec.split(","):
        roles = tuple(r.strip() for r in group.split("+") if r.strip())
        if not roles:
            continue
        for role in roles:
            if role not in _VALID_ROLES:
                raise click.BadParameter(f"unknown role '{role}'; expected {_VALID_ROLES}")
            if role in seen:
                raise click.BadParameter(f"role '{role}' assigned to more than one process")
            seen.add(role)
        groups.append(roles)
    missing = [r for r in _VALID_ROLES if r not in seen]
    if missing:
        raise click.BadParameter(f"--roles must cover every role; missing {tuple(missing)}")
    return tuple(groups)


_INSTANCE_PORT_STRIDE = 100


def _instance_overrides(instance: int) -> dict[str, Any]:
    # Port/container/volume overrides so N capped stacks run in parallel without colliding.
    if instance == 0:
        return {}
    shift = instance * _INSTANCE_PORT_STRIDE
    return {
        "container": f"helix-e2e-{instance}",
        "volume": f"helix-e2e-data-{instance}",
        "postgres_port": 25432 + shift,
        "step_ca_port": 29000 + shift,
        "redpanda_port": 29092 + shift,
        "mosquitto_device_port": 28883 + shift,
        "mosquitto_service_port": 28884 + shift,
        "public_http_port": 24000 + shift,
        "device_mtls_port": 24001 + shift,
    }


def _config(
    cpus: float,
    memory: str,
    roles: str | None = None,
    partitions: int | None = None,
    writer_concurrency: int | None = None,
    writer_batch: int | None = None,
    runtime: str = "node",
    instance: int = 0,
) -> ApplianceConfig:
    return ApplianceConfig(
        mode=ServerMode.PREBAKED,
        cpus=cpus,
        memory=memory,
        runtime=runtime,
        server_roles=_parse_roles(roles),
        event_topic_partitions=partitions,
        writer_concurrency=writer_concurrency,
        writer_batch_size=writer_batch,
        **_instance_overrides(instance),
    )


_WORKFLOW_ROLES = ("gateway", "ingest", "writer", "dispatch", "workflow")


def _workflow_process_groups(split: str | None, mode: str) -> tuple[tuple[str, ...], ...]:
    # '--split' -> one process group per comma entry; 'workflow' role only needed in inngest mode.
    required = ["gateway", "ingest", "writer", "dispatch"]
    if mode == "inngest":
        required.append("workflow")
    if not split:
        return (tuple(required),)
    groups: list[tuple[str, ...]] = []
    seen: set[str] = set()
    for entry in split.split(","):
        roles = tuple(role.strip() for role in entry.split("+") if role.strip())
        for role in roles:
            if role not in _WORKFLOW_ROLES:
                raise click.BadParameter(f"unknown role '{role}'; expected {_WORKFLOW_ROLES}")
            if role in seen:
                raise click.BadParameter(f"role '{role}' assigned to more than one process")
            seen.add(role)
        if roles:
            groups.append(roles)
    missing = [role for role in required if role not in seen]
    if missing:
        raise click.BadParameter(
            f"--split must cover {required} for mode={mode}; missing {missing}"
        )
    return tuple(groups)


def _workflow_config(
    cpus: float,
    memory: str,
    mode: str,
    concurrency: int,
    llm_ms: int,
    instance: int = 0,
    split: str | None = None,
    llm_mode: str = "blocking",
    dispatch_processes: int = 1,
    dbos_shard: bool = False,
) -> ApplianceConfig:
    # --dispatch-processes N runs N dispatch processes + N partitions to scale across cores.
    partitions: int | None = None
    server_roles: tuple[tuple[str, ...], ...]
    if dispatch_processes > 1:
        server_roles = (("gateway", "ingest", "writer"),) + (("dispatch",),) * dispatch_processes
        partitions = dispatch_processes
    else:
        server_roles = _workflow_process_groups(split, mode)
    return ApplianceConfig(
        mode=ServerMode.PREBAKED,
        cpus=cpus,
        memory=memory,
        runtime="node",
        server_roles=server_roles,
        event_topic_partitions=partitions,
        workflow_mode=mode,
        workflow_concurrency=concurrency,
        workflow_llm_ms=llm_ms,
        workflow_llm_mode=llm_mode,
        workflow_dbos_shard=dbos_shard,
        **_instance_overrides(instance),
    )


@click.group()
def loadtest() -> None:
    """Load test event ingestion under a CPU/memory-capped appliance subset."""


_CPUS = click.option("--cpus", type=float, default=2.0, help="Container CPU cap.")
_MEMORY = click.option("--memory", default="4g", help="Container memory cap.")
_DEVICES = click.option("--devices", type=int, default=20, help="Device connection pool size.")
_PAYLOAD = click.option("--payload", type=int, default=256, help="Payload padding bytes.")
_WORKERS = click.option("--workers", type=int, default=8, help="Generator worker processes.")
_DURATION = click.option("--duration", type=int, default=60, help="Seconds per rate step.")
_BUILD = click.option("--build", is_flag=True, help="Build the appliance image if missing.")
_ROLES = click.option(
    "--roles",
    default=None,
    help=(
        "Split helix-server roles across processes to use more cores, e.g. "
        "'gateway+ingest,writer'. Omit for one combined process."
    ),
)
_PARTITIONS = click.option(
    "--partitions", type=int, default=None, help="Event-queue topic partition count."
)
_WRITER_CONCURRENCY = click.option(
    "--writer-concurrency",
    type=int,
    default=None,
    help="Partitions the writer consumes concurrently (overlaps DB/commit I/O).",
)
_WRITER_BATCH = click.option(
    "--writer-batch", type=int, default=None, help="Writer DB insert batch size (rows per insert)."
)
_RUNTIME = click.option(
    "--runtime",
    type=click.Choice(["node", "bun"]),
    default="node",
    help="JS runtime for the prebaked server.",
)
_INSTANCE = click.option(
    "--instance",
    type=int,
    default=0,
    help="Isolated stack index for parallel runs (offsets ports, suffixes container/volume).",
)
_THINK = click.option(
    "--think", type=int, default=0, help="Simulated device processing delay (ms) before responding."
)


@loadtest.command("run")
@_CPUS
@_MEMORY
@click.option("--rate", type=int, default=1000, help="Target events/second.")
@_DURATION
@_DEVICES
@_PAYLOAD
@_WORKERS
@_BUILD
@_ROLES
@_PARTITIONS
@_WRITER_CONCURRENCY
@_WRITER_BATCH
@_RUNTIME
@_INSTANCE
def loadtest_run(
    cpus: float,
    memory: str,
    rate: int,
    duration: int,
    devices: int,
    payload: int,
    workers: int,
    build: bool,
    roles: str | None,
    partitions: int | None,
    writer_concurrency: int | None,
    writer_batch: int | None,
    runtime: str,
    instance: int,
) -> None:
    """Emit a fixed rate and report ingestion throughput / latency / resources."""
    config = _config(
        cpus, memory, roles, partitions, writer_concurrency, writer_batch, runtime, instance
    )
    with _stack(config, build=build, device_count=devices) as (appliance, pool):
        row = _measure(
            appliance, pool, rate=rate, duration=duration, payload=payload, workers=workers
        )
        _print_report([row], config)


@loadtest.command("ramp")
@_CPUS
@_MEMORY
@click.option("--start", "start_rate", type=int, default=500, help="First target rate.")
@click.option("--stop", "stop_rate", type=int, default=5000, help="Last target rate.")
@click.option("--step", type=int, default=500, help="Rate increment.")
@_DURATION
@_DEVICES
@_PAYLOAD
@_WORKERS
@_BUILD
@_ROLES
@_PARTITIONS
@_WRITER_CONCURRENCY
@_WRITER_BATCH
@_RUNTIME
@_INSTANCE
def loadtest_ramp(
    cpus: float,
    memory: str,
    start_rate: int,
    stop_rate: int,
    step: int,
    duration: int,
    devices: int,
    payload: int,
    workers: int,
    build: bool,
    roles: str | None,
    partitions: int | None,
    writer_concurrency: int | None,
    writer_batch: int | None,
    runtime: str,
    instance: int,
) -> None:
    """Ramp the emit rate and find the knee (where ingest stalls / lag grows)."""
    config = _config(
        cpus, memory, roles, partitions, writer_concurrency, writer_batch, runtime, instance
    )
    rows: list[dict[str, Any]] = []
    with _stack(config, build=build, device_count=devices) as (appliance, pool):
        for rate in range(start_rate, stop_rate + 1, step):
            click.echo(f"-- rate {rate}/s for {duration}s --")
            rows.append(
                _measure(
                    appliance, pool, rate=rate, duration=duration, payload=payload, workers=workers
                )
            )
        _print_report(rows, config)


@loadtest.command("route")
@_CPUS
@_MEMORY
@click.option("--rate", type=int, default=1000, help="Target round trips/second.")
@_DURATION
@_DEVICES
@_WORKERS
@_THINK
@_BUILD
@_ROLES
@_PARTITIONS
@_WRITER_CONCURRENCY
@_WRITER_BATCH
@_RUNTIME
@_INSTANCE
def loadtest_route(
    cpus: float,
    memory: str,
    rate: int,
    duration: int,
    devices: int,
    workers: int,
    think: int,
    build: bool,
    roles: str | None,
    partitions: int | None,
    writer_concurrency: int | None,
    writer_batch: int | None,
    runtime: str,
    instance: int,
) -> None:
    """Load test the WS<->MQTT gateway: command/response round-trip throughput."""
    config = _config(
        cpus, memory, roles, partitions, writer_concurrency, writer_batch, runtime, instance
    )
    with _stack(config, build=build, device_count=devices) as (appliance, pool):
        row = _measure_routing(
            appliance, pool, rate=rate, duration=duration, workers=workers, think_ms=think
        )
        _print_routing_report([row], config)


@loadtest.command("route-ramp")
@_CPUS
@_MEMORY
@click.option("--start", "start_rate", type=int, default=500, help="First target rate.")
@click.option("--stop", "stop_rate", type=int, default=5000, help="Last target rate.")
@click.option("--step", type=int, default=500, help="Rate increment.")
@_DURATION
@_DEVICES
@_WORKERS
@_THINK
@_BUILD
@_ROLES
@_PARTITIONS
@_WRITER_CONCURRENCY
@_WRITER_BATCH
@_RUNTIME
@_INSTANCE
def loadtest_route_ramp(
    cpus: float,
    memory: str,
    start_rate: int,
    stop_rate: int,
    step: int,
    duration: int,
    devices: int,
    workers: int,
    think: int,
    build: bool,
    roles: str | None,
    partitions: int | None,
    writer_concurrency: int | None,
    writer_batch: int | None,
    runtime: str,
    instance: int,
) -> None:
    """Ramp the round-trip rate and find where routing latency/loss climbs."""
    config = _config(
        cpus, memory, roles, partitions, writer_concurrency, writer_batch, runtime, instance
    )
    rows: list[dict[str, Any]] = []
    with _stack(config, build=build, device_count=devices) as (appliance, pool):
        for rate in range(start_rate, stop_rate + 1, step):
            click.echo(f"-- routing {rate}/s for {duration}s --")
            rows.append(
                _measure_routing(
                    appliance, pool, rate=rate, duration=duration, workers=workers, think_ms=think
                )
            )
        _print_routing_report(rows, config)


@loadtest.command("mixed")
@_CPUS
@_MEMORY
@click.option("--ingest-rate", type=int, default=2000, help="Target events/second.")
@click.option("--route-rate", type=int, default=1000, help="Target round trips/second.")
@_DURATION
@_DEVICES
@_PAYLOAD
@_WORKERS
@_THINK
@_BUILD
@_ROLES
@_PARTITIONS
@_WRITER_CONCURRENCY
@_WRITER_BATCH
@_RUNTIME
@_INSTANCE
def loadtest_mixed(
    cpus: float,
    memory: str,
    ingest_rate: int,
    route_rate: int,
    duration: int,
    devices: int,
    payload: int,
    workers: int,
    think: int,
    build: bool,
    roles: str | None,
    partitions: int | None,
    writer_concurrency: int | None,
    writer_batch: int | None,
    runtime: str,
    instance: int,
) -> None:
    """Run event ingestion and gateway routing at once over one device pool."""
    config = _config(
        cpus, memory, roles, partitions, writer_concurrency, writer_batch, runtime, instance
    )
    with _stack(config, build=build, device_count=devices) as (appliance, pool):
        row = _measure_mixed(
            appliance,
            pool,
            ingest_rate=ingest_rate,
            route_rate=route_rate,
            duration=duration,
            payload=payload,
            workers=workers,
            think_ms=think,
        )
        _print_mixed_report(row, config)


_WF_MODE = click.option(
    "--mode",
    type=click.Choice(["inngest", "direct", "dbos"]),
    default="inngest",
    help="inngest (durable engine), direct (inline, no durability), or dbos (in-process durable).",
)
_WF_CONCURRENCY = click.option(
    "--concurrency",
    type=int,
    default=100,
    help="Max concurrent runs (Inngest function limit / direct worker pool).",
)
_WF_LLM_MS = click.option(
    "--llm-ms", "llm_ms", type=int, default=5000, help="Fake LLM summarize delay (ms)."
)
_WF_SPLIT = click.option(
    "--split",
    default=None,
    help=(
        "Spread roles across processes to use more cores, e.g. "
        "'gateway+ingest,writer,dispatch'. Omit for one combined process."
    ),
)
_WF_EXTPG = click.option(
    "--external-postgres",
    "external_pg",
    is_flag=True,
    help="Run the app DB in an uncapped Postgres container so only app code is capped.",
)
_WF_EXT_INNGEST = click.option(
    "--external-inngest",
    "external_inngest",
    is_flag=True,
    help="Run Inngest (+ its Redis + Postgres) in their own containers, separately capped.",
)
_WF_FAST_PG = click.option(
    "--fast-pg",
    "fast_pg",
    is_flag=True,
    help="External Postgres on tmpfs + fsync off (unsafe, max speed) to probe engine limits.",
)
_WF_INNGEST_CPUS = click.option(
    "--inngest-cpus", type=float, default=2.0, help="CPU cap for the external Inngest container."
)
_WF_LLM_MODE = click.option(
    "--llm-mode",
    type=click.Choice(["blocking", "infer"]),
    default="blocking",
    help="Summarize node: 'blocking' step.run sleep, or 'infer' step.ai.infer (fake LLM).",
)
_WF_DISPATCH_PROCS = click.option(
    "--dispatch-processes",
    type=int,
    default=1,
    help="Run N dispatch processes (own event loop each) + N topic partitions, to scale cores.",
)
_WF_DBOS_SHARDS = click.option(
    "--dbos-shards",
    "dbos_shard",
    is_flag=True,
    help="Give each dispatch process its own DBOS system schema (shard the coordination DB).",
)


@loadtest.command("workflow")
@_CPUS
@_MEMORY
@click.option("--rate", type=int, default=200, help="Target events/second.")
@_WF_MODE
@_WF_CONCURRENCY
@_WF_LLM_MS
@_WF_SPLIT
@_WF_EXTPG
@_WF_EXT_INNGEST
@_WF_INNGEST_CPUS
@_WF_LLM_MODE
@_WF_DISPATCH_PROCS
@_WF_DBOS_SHARDS
@_WF_FAST_PG
@_DURATION
@_DEVICES
@_PAYLOAD
@_WORKERS
@_BUILD
@_INSTANCE
def loadtest_workflow(
    cpus: float,
    memory: str,
    rate: int,
    mode: str,
    concurrency: int,
    llm_ms: int,
    split: str | None,
    external_pg: bool,
    external_inngest: bool,
    inngest_cpus: float,
    llm_mode: str,
    dispatch_processes: int,
    dbos_shard: bool,
    fast_pg: bool,
    duration: int,
    devices: int,
    payload: int,
    workers: int,
    build: bool,
    instance: int,
) -> None:
    """Emit a fixed rate and report workflow throughput / backlog / Inngest cost."""
    config = _workflow_config(
        cpus,
        memory,
        mode,
        concurrency,
        llm_ms,
        instance,
        split,
        llm_mode,
        dispatch_processes,
        dbos_shard,
    )
    with _workflow_stack(
        config,
        build=build,
        device_count=devices,
        external_pg=external_pg,
        external_inngest=external_inngest,
        inngest_cpus=inngest_cpus,
        fast_pg=fast_pg,
    ) as (
        appliance,
        pool,
    ):
        row = _measure_workflow(
            appliance, pool, rate=rate, duration=duration, payload=payload, workers=workers
        )
        _print_workflow_report([row], config, mode)


@loadtest.command("workflow-ramp")
@_CPUS
@_MEMORY
@click.option("--start", "start_rate", type=int, default=50, help="First target rate.")
@click.option("--stop", "stop_rate", type=int, default=500, help="Last target rate.")
@click.option("--step", type=int, default=50, help="Rate increment.")
@_WF_MODE
@_WF_CONCURRENCY
@_WF_LLM_MS
@_WF_SPLIT
@_WF_EXTPG
@_WF_EXT_INNGEST
@_WF_INNGEST_CPUS
@_WF_LLM_MODE
@_WF_DISPATCH_PROCS
@_WF_DBOS_SHARDS
@_WF_FAST_PG
@_DURATION
@_DEVICES
@_PAYLOAD
@_WORKERS
@_BUILD
@_INSTANCE
def loadtest_workflow_ramp(
    cpus: float,
    memory: str,
    start_rate: int,
    stop_rate: int,
    step: int,
    mode: str,
    concurrency: int,
    llm_ms: int,
    split: str | None,
    external_pg: bool,
    external_inngest: bool,
    inngest_cpus: float,
    llm_mode: str,
    dispatch_processes: int,
    dbos_shard: bool,
    fast_pg: bool,
    duration: int,
    devices: int,
    payload: int,
    workers: int,
    build: bool,
    instance: int,
) -> None:
    """Ramp the emit rate to find where workflow backlog / latency runs away."""
    config = _workflow_config(
        cpus,
        memory,
        mode,
        concurrency,
        llm_ms,
        instance,
        split,
        llm_mode,
        dispatch_processes,
        dbos_shard,
    )
    rows: list[dict[str, Any]] = []
    with _workflow_stack(
        config,
        build=build,
        device_count=devices,
        external_pg=external_pg,
        external_inngest=external_inngest,
        inngest_cpus=inngest_cpus,
        fast_pg=fast_pg,
    ) as (
        appliance,
        pool,
    ):
        for rate in range(start_rate, stop_rate + 1, step):
            click.echo(f"-- workflow {rate}/s for {duration}s ({mode}) --")
            rows.append(
                _measure_workflow(
                    appliance, pool, rate=rate, duration=duration, payload=payload, workers=workers
                )
            )
            _settle_workflow(appliance)
        _print_workflow_report(rows, config, mode)
