from __future__ import annotations

import os
import signal
import subprocess
import time
from contextlib import suppress
from pathlib import Path

import click

from tooling.appliance.appliance import Appliance
from tooling.appliance.config import ServerMode
from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

WEB_ROOT = REPO_ROOT / "web"
SERVER_ROOT = WEB_ROOT / "apps" / "helix-server"
SERVER_READY_TIMEOUT_SECONDS = 120
PREBAKED_STOP_TIMEOUT_SECONDS = 15
READY_MARKERS = (
    "public HTTP listening",
    "device mTLS listening",
    "device event ingestion listening",
)

PREBAKED_DIST = "/opt/helix/loadtest-dist"
PREBAKED_LOG = "/var/lib/helix/loadtest-server.log"
PREBAKED_PATTERN = "loadtest-dist/index.js"

# The static host bun binary is copied into the container (shared libc), not installed.
HOST_BUN = Path.home() / ".bun" / "bin" / "bun"
CONTAINER_BUN = "/opt/helix/bin/bun"

# Readiness log markers each role prints once serving; a process's set is the union of its roles.
ROLE_MARKERS: dict[str, tuple[str, ...]] = {
    "gateway": ("public HTTP listening", "device mTLS listening"),
    "ingest": ("device event ingestion listening",),
    "writer": ("device event writer consuming",),
    "dispatch": ("workflow dispatch consuming",),
    "workflow": ("workflow serve endpoint listening",),
}

# The roles helix-server runs when HELIX_SERVER_ROLES is unset (dispatch + workflow are opt-in).
DEFAULT_PROCESS_ROLES: tuple[str, ...] = ("gateway", "ingest", "writer")


class _ServerProcess:
    """One prebaked node process running a subset of helix-server roles."""

    def __init__(self, roles: tuple[str, ...] | None, index: int) -> None:
        # roles is None for the combined process (no HELIX_SERVER_ROLES override).
        self.roles = roles
        # Slug joins roles with '-' (regex-safe) so pgrep patterns stay literal.
        self.label = "all" if roles is None else "-".join(roles)
        self.log = f"/var/lib/helix/loadtest-server-{index}-{self.label}.log"
        # Per-process argv tag ('$'-anchored, index-prefixed) so pgrep tells siblings apart.
        self.tag = f"--helix-role-group={index}-{self.label}"
        self.pattern = f"helix-role-group={index}-{self.label}$"
        effective = DEFAULT_PROCESS_ROLES if roles is None else roles
        self.markers = tuple(m for role in effective for m in ROLE_MARKERS[role])


class HelixServer:
    """Runs the helix-server app against an appliance's infra (HOST or PREBAKED mode)."""

    def __init__(self, appliance: Appliance, work_dir: Path) -> None:
        self.appliance = appliance
        self.work_dir = work_dir
        self._process: subprocess.Popen[bytes] | None = None
        self._log_path = work_dir / "helix-server.log"
        self._pki: dict[str, Path] = {}

    @property
    def public_base_url(self) -> str:
        return f"http://127.0.0.1:{self.appliance.config.public_http_port}"

    @property
    def pki(self) -> dict[str, Path]:
        return self._pki

    @property
    def crl_path(self) -> Path | None:
        """The CRL file the mTLS gateway watches (host mode), if exported; None otherwise."""
        return self._pki.get("crl")

    def start(self) -> None:
        if self.appliance.config.mode is ServerMode.PREBAKED:
            self._start_prebaked()
        else:
            self._start_host()

    def stop(self) -> None:
        if self.appliance.config.mode is ServerMode.PREBAKED:
            self._stop_prebaked()
        else:
            self._stop_host()

    def restart(self) -> None:
        self.stop()
        self.start()

    def _host_env(self) -> dict[str, str]:
        cfg = self.appliance.config
        pki = self._pki
        provisioner = self.appliance.read_internal_env("MQTT_STEP_CA_DEVICE_PROVISIONER_NAME")
        event_topic = self.appliance.read_internal_env("EVENT_QUEUE_TOPIC")
        crl_env = {"DEVICE_MTLS_CRL_PATH": str(pki["crl"])} if "crl" in pki else {}
        return {
            **os.environ,
            **crl_env,
            "DATABASE_URL": self.appliance.host_database_url(),
            "MQTT_BROKER_URL": f"mqtts://127.0.0.1:{cfg.mosquitto_service_port}",
            "MQTT_TLS_CA_CERT_PATH": str(pki["root_ca"]),
            "MQTT_TLS_CLIENT_CERT_PATH": str(pki["client_cert"]),
            "MQTT_TLS_CLIENT_KEY_PATH": str(pki["client_key"]),
            "MQTT_TLS_SERVER_NAME": "localhost",
            "EVENT_QUEUE_BROKERS": f"127.0.0.1:{cfg.redpanda_port}",
            "EVENT_QUEUE_TOPIC": event_topic or "helix.device-events.v1",
            "MQTT_STEP_CA_URL": f"https://127.0.0.1:{cfg.step_ca_port}",
            "MQTT_STEP_CA_ROOT_CERT_PATH": str(pki["root_ca"]),
            "MQTT_STEP_CA_DEVICE_PROVISIONER_NAME": provisioner or "helix-device",
            "MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH": str(pki["provisioner_jwk"]),
            "DEVICE_MTLS_CA_CERT_PATH": str(pki["root_ca"]),
            "DEVICE_MTLS_SERVER_CERT_PATH": str(pki["server_cert"]),
            "DEVICE_MTLS_SERVER_KEY_PATH": str(pki["server_key"]),
            "HELIX_HTTP_PORT": str(cfg.public_http_port),
            "DEVICE_MTLS_PORT": str(cfg.device_mtls_port),
            "STORAGE_PROVIDER": "FS",
            "FS_STORAGE_ROOT": str(self.work_dir / "storage"),
            "BETTER_AUTH_SECRET": "helix-e2e-secret",
        }

    def _start_host(self) -> None:
        self.work_dir.mkdir(parents=True, exist_ok=True)
        (self.work_dir / "storage").mkdir(exist_ok=True)
        self._pki = self.appliance.export_pki(self.work_dir / "pki")

        log_file = self._log_path.open("wb")
        click.echo("+ pnpm --filter @helix-hq/server-app dev  (host mode)")
        # New session so stop() can signal the whole pnpm -> tsx -> node tree.
        self._process = subprocess.Popen(
            ["pnpm", "--filter", "@helix-hq/server-app", "dev"],
            cwd=WEB_ROOT,
            env=self._host_env(),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self._wait_ready_host()

    def _wait_ready_host(self) -> None:
        deadline = time.monotonic() + SERVER_READY_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self._process is not None and self._process.poll() is not None:
                raise click.ClickException(f"helix-server exited early:\n{self._tail_host_log()}")
            if all(marker in self._read_host_log() for marker in READY_MARKERS):
                return
            time.sleep(1)
        raise click.ClickException(f"helix-server did not become ready:\n{self._tail_host_log()}")

    def _read_host_log(self) -> str:
        if not self._log_path.exists():
            return ""
        return self._log_path.read_text(errors="replace")

    def _tail_host_log(self, lines: int = 40) -> str:
        return "\n".join(self._read_host_log().splitlines()[-lines:])

    def _stop_host(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        try:
            pgid = os.getpgid(process.pid)
        except ProcessLookupError:
            return
        os.killpg(pgid, signal.SIGTERM)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            with suppress(ProcessLookupError):
                os.killpg(pgid, signal.SIGKILL)
            process.wait()

    def _process_specs(self) -> list[_ServerProcess]:
        groups = self.appliance.config.server_roles
        if groups is None:
            return [_ServerProcess(None, 0)]
        return [_ServerProcess(roles, i) for i, roles in enumerate(groups)]

    def _start_prebaked(self) -> None:
        run(["pnpm", "--filter", "@helix-hq/server-app", "build"], cwd=WEB_ROOT)
        # The baked helix-server unit (if any) would fight for the ports.
        self.appliance.stop_services(["server"])
        self.appliance.exec_shell(f"rm -rf {PREBAKED_DIST}", check=False)
        run(
            [
                "docker",
                "cp",
                str(SERVER_ROOT / "dist"),
                f"{self.appliance.config.container}:{PREBAKED_DIST}",
            ],
            cwd=REPO_ROOT,
        )
        cfg = self.appliance.config
        interpreter = self._prepare_runtime(cfg.runtime)
        tuning_export = ""
        if cfg.event_topic_partitions is not None:
            tuning_export += f"export EVENT_QUEUE_TOPIC_PARTITIONS={cfg.event_topic_partitions}; "
        if cfg.writer_concurrency is not None:
            tuning_export += f"export EVENT_QUEUE_WRITER_CONCURRENCY={cfg.writer_concurrency}; "
        if cfg.writer_batch_size is not None:
            tuning_export += f"export EVENT_QUEUE_WRITER_BATCH_SIZE={cfg.writer_batch_size}; "
        if cfg.workflow_mode is not None:
            tuning_export += f"export HELIX_WORKFLOW_MODE={cfg.workflow_mode}; "
        if cfg.workflow_concurrency is not None:
            tuning_export += f"export HELIX_WORKFLOW_CONCURRENCY={cfg.workflow_concurrency}; "
        if cfg.workflow_llm_ms is not None:
            tuning_export += f"export HELIX_WORKFLOW_LLM_MS={cfg.workflow_llm_ms}; "
        if cfg.workflow_llm_mode is not None:
            tuning_export += f"export HELIX_WORKFLOW_LLM_MODE={cfg.workflow_llm_mode}; "
        if self.appliance.infer_base_url_override is not None:
            tuning_export += (
                f"export HELIX_WORKFLOW_INFER_BASE_URL={self.appliance.infer_base_url_override}; "
            )
        # External app DB: override internal DATABASE_URL so app writes land on the uncapped PG.
        if self.appliance.app_db_url is not None:
            tuning_export += f"export DATABASE_URL={self.appliance.app_db_url}; "
        # DBOS follows DATABASE_URL; MUST come after the override above so $DATABASE_URL is set.
        if cfg.workflow_mode == "dbos":
            tuning_export += 'export DBOS_SYSTEM_DATABASE_URL="$DATABASE_URL"; '
        # External Inngest: point the app at it + advertise the serve host it must call back on.
        if self.appliance.inngest_base_url_override is not None:
            tuning_export += f"export INNGEST_BASE_URL={self.appliance.inngest_base_url_override}; "
        if self.appliance.workflow_serve_host_override is not None:
            tuning_export += (
                f"export HELIX_WORKFLOW_SERVE_HOST={self.appliance.workflow_serve_host_override}; "
            )

        specs = self._process_specs()
        # DBOS: migrate each system DB once before launch so concurrent launches don't deadlock.
        shard_urls = self.appliance.dbos_shard_urls if cfg.workflow_dbos_shard else []
        if cfg.workflow_mode == "dbos":
            migrate_urls = shard_urls or ['"$DATABASE_URL"']
            for index, url in enumerate(migrate_urls):
                click.echo(f"+ migrating DBOS system database ({index}) ...")
                self.appliance.exec_shell(
                    "set -a; . /var/lib/helix/env/internal.env; . /var/lib/helix/env/secrets.env; "
                    "[ -f /var/lib/helix/env/site.env ] && . /var/lib/helix/env/site.env; set +a; "
                    "export HELIX_HTTP_PORT=4000 DEVICE_MTLS_PORT=4001; "
                    f"{tuning_export}"
                    f"export HELIX_DBOS_MIGRATE=1 DBOS_SYSTEM_DATABASE_URL={url}; "
                    f"{interpreter} {PREBAKED_DIST}/index.js",
                )

        dispatch_index = 0
        for spec in specs:
            roles_export = (
                "" if spec.roles is None else f"export HELIX_SERVER_ROLES={','.join(spec.roles)}; "
            )
            shard_export = ""
            if shard_urls and spec.roles == ("dispatch",):
                shard_export = f"export DBOS_SYSTEM_DATABASE_URL={shard_urls[dispatch_index]}; "
                dispatch_index += 1
            click.echo(f"+ {cfg.runtime} loadtest-dist/index.js  (prebaked, roles={spec.label})")
            self.appliance.exec_shell(
                "set -a; . /var/lib/helix/env/internal.env; . /var/lib/helix/env/secrets.env; "
                "[ -f /var/lib/helix/env/site.env ] && . /var/lib/helix/env/site.env; set +a; "
                "export HELIX_HTTP_PORT=4000 DEVICE_MTLS_PORT=4001; "
                f"{tuning_export}"
                f"{roles_export}"
                f"{shard_export}"
                f"setsid {interpreter} {PREBAKED_DIST}/index.js {spec.tag} > {spec.log} 2>&1 &",
            )
        self._wait_ready_prebaked(specs)

    def _prepare_runtime(self, runtime: str) -> str:
        """Return the in-container interpreter command, staging bun if needed."""
        if runtime == "node":
            return "node"
        if runtime == "bun":
            if not HOST_BUN.exists():
                raise click.ClickException(
                    f"bun not found at {HOST_BUN}; install it "
                    "(curl -fsSL https://bun.sh/install | bash)."
                )
            self.appliance.exec_shell(f"mkdir -p {os.path.dirname(CONTAINER_BUN)}", check=False)
            dest = f"{self.appliance.config.container}:{CONTAINER_BUN}"
            run(["docker", "cp", str(HOST_BUN), dest], cwd=REPO_ROOT)
            self.appliance.exec_shell(f"chmod +x {CONTAINER_BUN}", check=False)
            return CONTAINER_BUN
        raise click.ClickException(f"unknown runtime '{runtime}'; expected 'node' or 'bun'.")

    def _read_prebaked_log(self, spec: _ServerProcess) -> str:
        return self.appliance.exec_shell(
            f"cat {spec.log} 2>/dev/null || true", check=False, capture=True
        ).stdout

    def _prebaked_running(self, spec: _ServerProcess) -> bool:
        return (
            self.appliance.exec_shell(
                f"pgrep -f '{spec.pattern}' >/dev/null 2>&1", check=False, capture=True
            ).returncode
            == 0
        )

    def _wait_ready_prebaked(self, specs: list[_ServerProcess]) -> None:
        deadline = time.monotonic() + SERVER_READY_TIMEOUT_SECONDS
        pending = list(specs)
        while time.monotonic() < deadline:
            still_pending: list[_ServerProcess] = []
            for spec in pending:
                log = self._read_prebaked_log(spec)
                if all(marker in log for marker in spec.markers):
                    continue
                if log and not self._prebaked_running(spec):
                    raise click.ClickException(
                        f"prebaked helix-server (roles={spec.label}) exited:\n{log[-2000:]}"
                    )
                still_pending.append(spec)
            if not still_pending:
                return
            pending = still_pending
            time.sleep(1)
        tails = "\n\n".join(
            f"[roles={spec.label}]\n{self._read_prebaked_log(spec)[-1500:]}" for spec in pending
        )
        raise click.ClickException(f"prebaked helix-server did not become ready:\n{tails}")

    def _stop_prebaked(self) -> None:
        # SIGTERM then wait for ports to release (else an immediate restart hits EADDRINUSE); then SIGKILL.
        self.appliance.exec_shell(f"pkill -f '{PREBAKED_PATTERN}'", check=False)
        deadline = time.monotonic() + PREBAKED_STOP_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            still_running = self.appliance.exec_shell(
                f"pgrep -f '{PREBAKED_PATTERN}' >/dev/null 2>&1", check=False, capture=True
            )
            if still_running.returncode != 0:
                return
            time.sleep(0.5)
        self.appliance.exec_shell(f"pkill -9 -f '{PREBAKED_PATTERN}'", check=False)
