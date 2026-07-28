from __future__ import annotations

import json
import os
import subprocess
import time
from contextlib import suppress
from pathlib import Path

import click

from tooling.appliance.config import ApplianceConfig, ServerMode
from tooling.appliance.devenv import AppEnvPlan, write_env
from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

WEB_ROOT = REPO_ROOT / "web"
WEB_APPS = WEB_ROOT / "apps"
DEV_PKI_DIR = WEB_APPS / "helix-server" / ".dev-pki"
DEV_STORAGE_DIR = WEB_APPS / "helix-server" / ".dev-storage"
DOCKERFILE = "cloud/appliance/Dockerfile"
READY_TIMEOUT_SECONDS = 180
POSTGRES_RESTART_TIMEOUT_SECONDS = 30


class Appliance:
    """Drives a single Helix appliance container for local + e2e use."""

    def __init__(self, config: ApplianceConfig) -> None:
        self.config = config
        # External (uncapped) app DB: url = in-container, host_url = host-mapped for migrations.
        self.app_db_url: str | None = None
        self.app_db_host_url: str | None = None
        self.app_db_ip: str | None = None
        self.external_pg_container: str | None = None
        # One DBOS system-database URL per dispatch shard (separate PG processes).
        self.dbos_shard_urls: list[str] = []
        # Set when Inngest runs in its own CPU-capped container, to isolate its cost.
        self.inngest_base_url_override: str | None = None
        self.workflow_serve_host_override: str | None = None
        self.inngest_pg_uri: str | None = None
        self.external_inngest_container: str | None = None
        # Set when the summarize node uses step.ai.infer against a fake sleeping endpoint.
        self.infer_base_url_override: str | None = None

    @property
    def dev_pki_dir(self) -> Path:
        """Where this instance's PKI is exported for the host web apps."""
        if self.config.container == "helix-e2e":
            return DEV_PKI_DIR
        suffix = self.config.container.removeprefix("helix-e2e-")
        return WEB_APPS / "helix-server" / f".dev-pki-{suffix}"

    def image_exists(self) -> bool:
        result = run(
            ["docker", "image", "inspect", self.config.image],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0

    def build(self) -> None:
        run(
            ["docker", "build", "-f", DOCKERFILE, "-t", self.config.image, "."],
            cwd=REPO_ROOT,
        )

    def is_running(self) -> bool:
        result = run(
            ["docker", "inspect", "-f", "{{.State.Running}}", self.config.container],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"

    def up(self, *, fresh: bool = True) -> None:
        if fresh:
            self.down(purge=True)
        elif self.is_running():
            return

        command = [
            "docker",
            "run",
            "-d",
            "--name",
            self.config.container,
            "--cgroupns=private",
            "--privileged",
            "--tmpfs",
            "/run",
            "--tmpfs",
            "/run/lock",
            "--tmpfs",
            "/tmp",
            "--stop-signal",
            "SIGRTMIN+3",
            "-v",
            f"{self.config.volume}:/var/lib/helix",
        ]
        if self.config.cpus is not None:
            command += ["--cpus", str(self.config.cpus)]
        if self.config.memory is not None:
            command += ["--memory", self.config.memory, "--memory-swap", self.config.memory]
        for host_port, container_port in sorted(self.config.port_mappings().items()):
            command += ["-p", f"127.0.0.1:{host_port}:{container_port}"]
        command.append(self.config.image)
        run(command, cwd=REPO_ROOT)

    def down(self, *, purge: bool = False) -> None:
        run(
            ["docker", "rm", "-f", self.config.container],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        if purge:
            run(
                ["docker", "volume", "rm", self.config.volume],
                cwd=REPO_ROOT,
                capture_output=True,
                check=False,
            )

    def _run_pg_container(self, name: str, host_port: int, password: str, fast: bool) -> str:
        # fast=True: tmpfs + durability off, to remove the WAL/commit ceiling under load test.
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        command = ["docker", "run", "-d", "--name", name]
        if fast:
            command += ["--tmpfs", "/var/lib/postgresql/data:rw,size=4g"]
        command += [
            "-e",
            "POSTGRES_USER=helix",
            "-e",
            f"POSTGRES_PASSWORD={password}",
            "-e",
            "POSTGRES_DB=helix",
            "-p",
            f"127.0.0.1:{host_port}:5432",
            "postgres:16",
            "-c",
            "max_connections=500",
            "-c",
            "shared_buffers=2GB" if fast else "shared_buffers=512MB",
        ]
        if fast:
            command += [
                "-c",
                "fsync=off",
                "-c",
                "synchronous_commit=off",
                "-c",
                "full_page_writes=off",
                "-c",
                "wal_buffers=64MB",
                "-c",
                "max_wal_size=8GB",
                "-c",
                "checkpoint_timeout=60min",
            ]
        run(command, cwd=REPO_ROOT)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            ready = run(
                ["docker", "exec", name, "pg_isready", "-U", "helix", "-q"],
                cwd=REPO_ROOT,
                capture_output=True,
                check=False,
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise click.ClickException(f"postgres {name} did not become ready in time.")
        return self._container_ip(name)

    def start_external_postgres(
        self, *, name: str, host_port: int, password: str, fast: bool = False
    ) -> None:
        """Run the uncapped app-database Postgres off the appliance."""
        ip = self._run_pg_container(name, host_port, password, fast)
        self.external_pg_container = name
        self.app_db_ip = ip
        self.app_db_url = f"postgres://helix:{password}@{ip}:5432/helix"
        self.app_db_host_url = f"postgres://helix:{password}@127.0.0.1:{host_port}/helix"

    def start_dbos_shard_pgs(
        self, *, name_prefix: str, count: int, base_host_port: int, password: str, fast: bool
    ) -> None:
        """Run one Postgres per dispatch shard so each DBOS instance has its own DB process."""
        urls: list[str] = []
        for index in range(count):
            name = f"{name_prefix}-{index}"
            ip = self._run_pg_container(name, base_host_port + index, password, fast)
            self.exec_shell(
                f'psql "postgres://helix:{password}@{ip}:5432/helix" '
                f'-c "CREATE SCHEMA IF NOT EXISTS dbos"',
                check=False,
            )
            urls.append(f"postgres://helix:{password}@{ip}:5432/helix")
        self.dbos_shard_urls = urls

    def stop_dbos_shard_pgs(self, *, name_prefix: str, count: int) -> None:
        for index in range(count):
            run(
                ["docker", "rm", "-f", f"{name_prefix}-{index}"],
                cwd=REPO_ROOT,
                capture_output=True,
                check=False,
            )
        self.dbos_shard_urls = []

    def stop_external_postgres(self, name: str) -> None:
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        self.app_db_url = None
        self.app_db_host_url = None
        self.app_db_ip = None
        self.external_pg_container = None

    def _container_ip(self, name: str) -> str:
        ip = run(
            [
                "docker",
                "inspect",
                "-f",
                "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
                name,
            ],
            cwd=REPO_ROOT,
            capture_output=True,
        ).stdout.strip()
        if ip == "":
            raise click.ClickException(f"could not resolve container IP for {name}.")
        return ip

    def _wait_remote_port(self, ip: str, port: int, *, timeout: int = 90) -> None:
        """Wait (from inside the appliance) for another container's port to open."""
        probe = (
            f"python3 -c \"import socket; socket.create_connection(('{ip}', {port}), 2).close()\""
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.exec_shell(probe, check=False, capture=True).returncode == 0:
                return
            time.sleep(1)
        raise click.ClickException(f"remote port {ip}:{port} did not open in time.")

    def provision_external_inngest_db(self, *, password: str) -> str:
        """Create the inngest role + database in the external Postgres and return its URI."""
        if self.app_db_url is None or self.app_db_ip is None:
            raise click.ClickException("external app postgres must be started first.")

        def query(sql: str) -> str:
            return self.exec_shell(
                f'psql "{self.app_db_url}" -tAc {_shell_quote(sql)}', check=False, capture=True
            ).stdout.strip()

        if query("SELECT 1 FROM pg_roles WHERE rolname='inngest'") != "1":
            query(f"CREATE ROLE inngest LOGIN PASSWORD '{password}'")
        if query("SELECT 1 FROM pg_database WHERE datname='inngest'") != "1":
            query("CREATE DATABASE inngest OWNER inngest")
        uri = f"postgres://inngest:{password}@{self.app_db_ip}:5432/inngest"
        self.inngest_pg_uri = uri
        return uri

    def start_external_redis(self, name: str) -> str:
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        run(["docker", "run", "-d", "--name", name, "redis:7-alpine"], cwd=REPO_ROOT)
        ip = self._container_ip(name)
        self._wait_remote_port(ip, 6379)
        return f"redis://{ip}:6379"

    def stop_external_redis(self, name: str) -> None:
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)

    def start_fake_llm(self, name: str, *, delay_ms: int) -> None:
        """Run a fake OpenAI-compatible endpoint (POST sleeps delay_ms) for step.ai.infer."""
        script = (
            "const http=require('http');"
            "const delay=parseInt(process.env.DELAY_MS||'5000',10);"
            "const body=JSON.stringify({id:'fake',object:'chat.completion',created:0,"
            "model:'fake',choices:[{index:0,message:{role:'assistant',"
            "content:'Summary of recent events.'},finish_reason:'stop'}],"
            "usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});"
            "http.createServer((req,res)=>{let d='';req.on('data',c=>{d+=c});"
            "req.on('end',()=>{console.log('infer-from',req.socket.remoteAddress);"
            "setTimeout(()=>{res.writeHead(200,"
            "{'content-type':'application/json'});res.end(body)},delay)})})"
            ".listen(11434,'0.0.0.0');"
        )
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                name,
                "-e",
                f"DELAY_MS={delay_ms}",
                "node:20-alpine",
                "node",
                "-e",
                script,
            ],
            cwd=REPO_ROOT,
        )
        ip = self._container_ip(name)
        self._wait_remote_port(ip, 11434)
        self.infer_base_url_override = f"http://{ip}:11434/v1"

    def fake_llm_caller_summary(self, name: str) -> str:
        """Summarize which container IPs called the fake LLM (from its logs)."""
        out = run(["docker", "logs", name], cwd=REPO_ROOT, capture_output=True, check=False)
        text = (out.stdout or "") + (out.stderr or "")
        counts: dict[str, int] = {}
        for line in text.splitlines():
            if "infer-from" in line:
                ip = line.split("infer-from", 1)[1].strip()
                counts[ip] = counts.get(ip, 0) + 1
        if not counts:
            return "(no infer calls received)"
        return ", ".join(f"{ip}: {count}" for ip, count in sorted(counts.items()))

    def stop_fake_llm(self, name: str) -> None:
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        self.infer_base_url_override = None

    def start_external_inngest(
        self,
        name: str,
        *,
        cpus: float,
        memory: str,
        postgres_uri: str,
        redis_uri: str,
        event_key: str,
        signing_key: str,
    ) -> None:
        """Run the inngest binary in its own CPU-capped container, isolated from the app."""
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                name,
                "--cpus",
                str(cpus),
                "--memory",
                memory,
                "--memory-swap",
                memory,
                "-e",
                f"INNGEST_POSTGRES_URI={postgres_uri}",
                "-e",
                f"INNGEST_REDIS_URI={redis_uri}",
                "-e",
                f"INNGEST_EVENT_KEY={event_key}",
                "-e",
                f"INNGEST_SIGNING_KEY={signing_key}",
                "--entrypoint",
                "/usr/local/bin/inngest",
                self.config.image,
                "start",
                "--host",
                "0.0.0.0",
            ],
            cwd=REPO_ROOT,
        )
        ip = self._container_ip(name)
        self._wait_remote_port(ip, 8288)
        self.external_inngest_container = name
        self.inngest_base_url_override = f"http://{ip}:8288"
        # Advertise an address the inngest container can reach (bridge IP), not loopback.
        self.workflow_serve_host_override = (
            f"http://{self._container_ip(self.config.container)}:4002"
        )

    def stop_external_inngest(self, name: str) -> None:
        run(["docker", "rm", "-f", name], cwd=REPO_ROOT, capture_output=True, check=False)
        self.inngest_base_url_override = None
        self.workflow_serve_host_override = None
        self.inngest_pg_uri = None
        self.external_inngest_container = None

    def named_container_stats(self, name: str) -> dict[str, float]:
        """Live CPU% / memory (MiB) of an arbitrary container."""
        out = run(
            ["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}};{{.MemUsage}}", name],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        ).stdout.strip()
        if ";" not in out:
            return {"cpu_percent": 0.0, "mem_mib": 0.0}
        cpu_raw, mem_raw = out.split(";", 1)
        cpu = float(cpu_raw.replace("%", "").strip() or 0)
        mem_used = _parse_mem_mib(mem_raw.split("/")[0].strip())
        return {"cpu_percent": round(cpu, 1), "mem_mib": round(mem_used, 1)}

    def exec_shell(
        self, script: str, *, check: bool = True, capture: bool = False
    ) -> subprocess.CompletedProcess[str]:
        return run(
            ["docker", "exec", self.config.container, "sh", "-lc", script],
            cwd=REPO_ROOT,
            capture_output=capture,
            check=check,
        )

    def psql(
        self, sql: str, *, check: bool = True, capture: bool = True
    ) -> subprocess.CompletedProcess[str]:
        if self.app_db_url is not None:
            script = f'psql "{self.app_db_url}" -v ON_ERROR_STOP=1 -tAc {_shell_quote(sql)}'
        else:
            script = (
                "set -a; . /var/lib/helix/env/internal.env; set +a; "
                f'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc {_shell_quote(sql)}'
            )
        return self.exec_shell(script, check=check, capture=capture)

    def psql_inngest(
        self, sql: str, *, check: bool = True, capture: bool = True
    ) -> subprocess.CompletedProcess[str]:
        """Run a query against Inngest's own database (its durable run-state store)."""
        if self.inngest_pg_uri is not None:
            script = f'psql "{self.inngest_pg_uri}" -v ON_ERROR_STOP=1 -tAc {_shell_quote(sql)}'
        else:
            script = (
                "set -a; . /var/lib/helix/env/secrets.env; . /var/lib/helix/env/internal.env; "
                f'set +a; psql "$INNGEST_POSTGRES_URI" -v ON_ERROR_STOP=1 -tAc {_shell_quote(sql)}'
            )
        return self.exec_shell(script, check=check, capture=capture)

    def read_internal_env(self, name: str) -> str:
        result = self.exec_shell(
            f'set -a; . /var/lib/helix/env/internal.env; set +a; printf %s "${name}"',
            capture=True,
        )
        return result.stdout.strip()

    def read_seeded_env(self, name: str) -> str:
        """Read a value from the container's generated env; site.env is not sourced
        (operator-edited, may hold spaces that break `source`)."""
        result = self.exec_shell(
            "set -a; . /var/lib/helix/env/secrets.env; . /var/lib/helix/env/internal.env; "
            f'set +a; printf %s "${name}"',
            capture=True,
        )
        return result.stdout.strip()

    def wait_ready(self, *, timeout: int = READY_TIMEOUT_SECONDS) -> None:
        probe = (
            "pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 "
            "&& rpk cluster info --brokers 127.0.0.1:9092 >/dev/null 2>&1 "
            f"&& test -f {self.config.step_ca_root_cert} "
            f"&& test -f {self.config.step_ca_jwk} "
            f"&& test -f {self.config.server_pki_dir}/client.crt "
            f"&& {_socket_probe(8884)} >/dev/null 2>&1"
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.exec_shell(probe, check=False, capture=True).returncode == 0:
                return
            time.sleep(1)
        raise click.ClickException("appliance did not become ready within the timeout.")

    def open_postgres_to_host(self) -> None:
        """Open the container-loopback PG so a host-side helix-server can reach it."""
        self.exec_shell(
            "grep -q \"^listen_addresses = '\\*'\" /var/lib/helix/postgres/postgresql.conf "
            "|| echo \"listen_addresses = '*'\" >> /var/lib/helix/postgres/postgresql.conf; "
            'grep -q "host all all all scram-sha-256" /var/lib/helix/postgres/pg_hba.conf '
            '|| echo "host all all all scram-sha-256" >> /var/lib/helix/postgres/pg_hba.conf; '
            "systemctl restart helix-postgres.service",
            check=False,
        )
        deadline = time.monotonic() + POSTGRES_RESTART_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if (
                self.exec_shell(
                    "pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1", check=False, capture=True
                ).returncode
                == 0
            ):
                return
            time.sleep(1)
        raise click.ClickException("appliance Postgres did not restart in time.")

    def wait_inngest_ready(self, *, timeout: int = 60) -> None:
        """Wait for the self-hosted Inngest server's HTTP API (8288) to accept connections."""
        self._wait_container_port(8288, timeout=timeout)

    def _wait_container_port(self, port: int, *, timeout: int = 60) -> None:
        check = _socket_probe(port)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.exec_shell(check, check=False, capture=True).returncode == 0:
                return
            time.sleep(1)
        raise click.ClickException(f"container port {port} did not open in time.")

    def configure_redpanda_advertised(self) -> None:
        """Match Redpanda's advertised Kafka address to the host port a client reaches it on."""
        # Prebaked helix-server is in-container, so it reaches redpanda at the real :9092.
        if self.config.mode is ServerMode.PREBAKED:
            return
        host_port = self.config.redpanda_port
        if host_port == 9092:
            return
        script = (
            "set -e; "
            "line=$(systemctl cat helix-redpanda.service | sed -n 's/^ExecStart=//p' | head -1); "
            f'new=$(printf "%s" "$line" | sed '
            f'"s#--advertise-kafka-addr PLAINTEXT://127.0.0.1:9092'
            f'#--advertise-kafka-addr PLAINTEXT://127.0.0.1:{host_port}#"); '
            "mkdir -p /etc/systemd/system/helix-redpanda.service.d; "
            "{ echo '[Service]'; echo 'ExecStart='; echo \"ExecStart=$new\"; } "
            "> /etc/systemd/system/helix-redpanda.service.d/advertise.conf; "
            "systemctl daemon-reload; systemctl restart helix-redpanda.service"
        )
        self.exec_shell(script)
        self._wait_container_port(9092)

    def prepare_host_access(self) -> None:
        """Make the appliance infra reachable from host-side clients."""
        self.open_postgres_to_host()
        self.configure_redpanda_advertised()

    def host_database_url(self) -> str:
        internal = self.read_internal_env("DATABASE_URL")
        return internal.replace(":5432/", f":{self.config.postgres_port}/")

    def run_migrations(self) -> None:
        """Apply the drizzle migrations to the appliance DB from the host over the mapped port."""
        database_url = self.app_db_host_url or self.host_database_url()
        run(
            ["pnpm", "--filter", "helix", "db:migrate"],
            cwd=WEB_ROOT,
            env={
                **os.environ,
                "DATABASE_URL": database_url,
                "SKIP_ENV_VALIDATION": "true",
            },
        )

    def seed_features(self) -> None:
        """Seed the feature catalog from the app's FeatureRegistry (idempotent upsert)."""
        database_url = self.app_db_host_url or self.host_database_url()
        run(
            ["pnpm", "--filter", "helix", "db:seed-features"],
            cwd=WEB_ROOT,
            env={
                **os.environ,
                "DATABASE_URL": database_url,
                "SKIP_ENV_VALIDATION": "true",
            },
        )

    def write_dev_env(self, *, fresh: bool, echo_env: bool = False) -> None:
        """Generate/sync the `.env` files for the web apps against this appliance."""
        pki = self.export_pki(self.dev_pki_dir)
        for plan in self._dev_env_plans(pki):
            action = write_env(plan, fresh=fresh)
            click.echo(f"  {plan.name}/.env {action}")
        if echo_env:
            self._echo_dev_env(pki)

    def _echo_dev_env(self, pki: dict[str, Path]) -> None:
        for plan in self._dev_env_plans(pki):
            click.echo("")
            click.echo(f"# ===== {plan.name} — {plan.path} =====")
            for key, value in {**plan.managed, **plan.defaults}.items():
                click.echo(f"{key}={value}")

    def _dev_env_plans(self, pki: dict[str, Path]) -> list[AppEnvPlan]:
        cfg = self.config
        database_url = self.host_database_url()
        auth_secret = self.read_seeded_env("BETTER_AUTH_SECRET")
        event_topic = self.read_seeded_env("EVENT_QUEUE_TOPIC")
        provisioner = self.read_seeded_env("MQTT_STEP_CA_DEVICE_PROVISIONER_NAME")

        def cert(key: str) -> str:
            return str(pki[key])

        helix = AppEnvPlan(
            name="helix",
            path=WEB_APPS / "helix" / ".env",
            managed={
                "DATABASE_URL": database_url,
                "BETTER_AUTH_SECRET": auth_secret,
                # step-ca wiring for the admin certificate-revocation surface.
                "MQTT_STEP_CA_URL": f"https://127.0.0.1:{cfg.step_ca_port}",
                "MQTT_STEP_CA_ROOT_CERT_PATH": cert("root_ca"),
                "MQTT_STEP_CA_DEVICE_PROVISIONER_NAME": provisioner,
                "MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH": cert("provisioner_jwk"),
            },
            defaults={
                "BETTER_AUTH_URL": "http://localhost:3000",
                "NEXT_PUBLIC_BASE_URL": "http://localhost:3000",
                "SMTP_SERVER": "",
                "SMTP_USER": "",
                "SMTP_PASSWORD": "",
                "SMTP_SENDER": "",
                "EMAIL_LOG_CONTENT": "true",
            },
        )
        server = AppEnvPlan(
            name="helix-server",
            path=WEB_APPS / "helix-server" / ".env",
            managed={
                "DATABASE_URL": database_url,
                "BETTER_AUTH_SECRET": auth_secret,
                "EVENT_QUEUE_BROKERS": f"127.0.0.1:{cfg.redpanda_port}",
                "EVENT_QUEUE_TOPIC": event_topic,
                "MQTT_BROKER_URL": f"mqtts://127.0.0.1:{cfg.mosquitto_service_port}",
                "MQTT_TLS_SERVER_NAME": "localhost",
                "MQTT_TLS_CA_CERT_PATH": cert("root_ca"),
                "MQTT_TLS_CLIENT_CERT_PATH": cert("client_cert"),
                "MQTT_TLS_CLIENT_KEY_PATH": cert("client_key"),
                "MQTT_STEP_CA_URL": f"https://127.0.0.1:{cfg.step_ca_port}",
                "MQTT_STEP_CA_ROOT_CERT_PATH": cert("root_ca"),
                "MQTT_STEP_CA_DEVICE_PROVISIONER_NAME": provisioner,
                "MQTT_STEP_CA_DEVICE_PROVISIONER_JWK_PATH": cert("provisioner_jwk"),
                "DEVICE_MTLS_CA_CERT_PATH": cert("root_ca"),
                "DEVICE_MTLS_SERVER_CERT_PATH": cert("server_cert"),
                "DEVICE_MTLS_SERVER_KEY_PATH": cert("server_key"),
            },
            defaults={
                "HELIX_HTTP_PORT": "4000",
                "DEVICE_MTLS_PORT": "4001",
                "STORAGE_PROVIDER": "FS",
                "FS_STORAGE_ROOT": str(DEV_STORAGE_DIR),
            },
        )
        return [helix, server]

    def seed_device(self, device_id: str, access_token: str) -> None:
        self.psql(
            f"INSERT INTO device (id, name, access_token, is_active) "
            f"VALUES ('{device_id}', 'e2e device', '{access_token}', true) "
            f"ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, is_active = true"
        )

    def count_events(self, device_id: str) -> int:
        result = self.psql(f"SELECT count(*) FROM device_event WHERE device_id = '{device_id}'")
        return int(result.stdout.strip() or "0")

    def has_event(self, device_id: str, message_id: str) -> bool:
        result = self.psql(
            f"SELECT count(*) FROM device_event "
            f"WHERE device_id = '{device_id}' AND message_id = '{message_id}'"
        )
        return int(result.stdout.strip() or "0") > 0

    def stop_services(self, names: list[str]) -> None:
        """Stop helix-<name>.service units."""
        if not names:
            return
        units = " ".join(f"helix-{name}.service" for name in names)
        self.exec_shell(f"systemctl stop {units}", check=False)

    def _isolate_keeping(self, keep: set[str]) -> None:
        # Stop every running helix-*.service except `keep` (helix-server is a bare process).
        out = self.exec_shell(
            "systemctl list-units 'helix-*.service' --state=running --no-legend --plain "
            "| awk '{print $1}'",
            capture=True,
        ).stdout
        to_stop = [
            line.strip() for line in out.splitlines() if line.strip() and line.strip() not in keep
        ]
        if to_stop:
            self.exec_shell("systemctl stop " + " ".join(to_stop), check=False)

    def isolate_ingestion_subset(self) -> None:
        """Strip the appliance down to the event-ingestion infra (postgres, redpanda, mosquitto)."""
        self._isolate_keeping(
            {"helix-postgres.service", "helix-redpanda.service", "helix-mosquitto.service"}
        )

    def isolate_workflow_subset(self, *, external_infra: bool = False) -> None:
        """Strip the appliance down to the workflow-processing infra."""
        keep = {"helix-redpanda.service", "helix-mosquitto.service"}
        if not external_infra:
            keep |= {
                "helix-postgres.service",
                "helix-redis.service",
                "helix-inngest.service",
            }
        self._isolate_keeping(keep)

    def register_inngest_app(self, port: int = 4002) -> str:
        """Sync the workflow serve endpoint with the self-hosted Inngest server."""
        return self.exec_shell(
            f"curl -sS -X PUT http://127.0.0.1:{port}/api/inngest -w '\\n[http %{{http_code}}]' "
            "|| echo '[register failed]'",
            check=False,
            capture=True,
        ).stdout.strip()

    def count_events_prefix(self, prefix: str) -> int:
        result = self.psql(f"SELECT count(*) FROM device_event WHERE device_id LIKE '{prefix}%'")
        return int(result.stdout.strip() or "0")

    def ingest_latency_ms(self, run_id: str) -> dict[str, float]:
        """p50/p95/p99 of received_at - payload.publishedAtNs, in milliseconds."""
        sql = (
            "SELECT coalesce(percentile_cont(0.5) within group (order by lat), 0), "
            "coalesce(percentile_cont(0.95) within group (order by lat), 0), "
            "coalesce(percentile_cont(0.99) within group (order by lat), 0) FROM ("
            "SELECT extract(epoch from received_at) * 1000 "
            "- (event_payload->>'publishedAtNs')::numeric / 1e6 AS lat "
            f"FROM device_event WHERE event_payload->>'runId' = '{run_id}') s"
        )
        row = self.psql(sql).stdout.strip()
        parts = row.split("|") if row else ["0", "0", "0"]
        keys = ["p50", "p95", "p99"]
        return {key: round(float(parts[index] or 0), 1) for index, key in enumerate(keys)}

    def count_workflow_results(self, run_id: str, status: str | None = None) -> int:
        where = f"run_id = '{run_id}'"
        if status is not None:
            where += f" AND status = '{status}'"
        result = self.psql(f"SELECT count(*) FROM workflow_run_result WHERE {where}")
        return int(result.stdout.strip() or "0")

    def workflow_latency_ms(self, run_id: str) -> dict[str, float]:
        """p50/p95/p99 of completed_at - emitted_at_ns (device emit -> workflow done), in ms."""
        sql = (
            "SELECT coalesce(percentile_cont(0.5) within group (order by lat), 0), "
            "coalesce(percentile_cont(0.95) within group (order by lat), 0), "
            "coalesce(percentile_cont(0.99) within group (order by lat), 0) FROM ("
            "SELECT extract(epoch from completed_at) * 1000 "
            "- (emitted_at_ns)::numeric / 1e6 AS lat "
            "FROM workflow_run_result "
            f"WHERE run_id = '{run_id}' AND status = 'completed' AND emitted_at_ns IS NOT NULL) s"
        )
        row = self.psql(sql).stdout.strip()
        parts = row.split("|") if row else ["0", "0", "0"]
        keys = ["p50", "p95", "p99"]
        return {key: round(float(parts[index] or 0), 1) for index, key in enumerate(keys)}

    def inngest_pending_runs(self) -> int:
        """Point-in-time Inngest backlog (function_runs minus function_finishes)."""
        out = self.psql_inngest(
            "SELECT (SELECT count(*) FROM function_runs) "
            "- (SELECT count(*) FROM function_finishes)",
            check=False,
        ).stdout.strip()
        try:
            return int(out or "0")
        except ValueError:
            return 0

    def inngest_db_size_mb(self) -> float:
        """Size of Inngest's Postgres database in MiB (grows as runs accumulate)."""
        out = self.psql_inngest("SELECT pg_database_size('inngest')", check=False).stdout.strip()
        try:
            return round(int(out or "0") / (1024 * 1024), 1)
        except ValueError:
            return 0.0

    def consumer_lag(self, group: str = "helix-device-event-writer") -> int:
        out = self.exec_shell(
            f"rpk group describe {group} --brokers 127.0.0.1:9092 2>/dev/null || true",
            check=False,
            capture=True,
        ).stdout
        total = 0
        lag_index: int | None = None
        for line in out.splitlines():
            columns = line.split()
            if "LAG" in columns:
                lag_index = columns.index("LAG")
                continue
            if lag_index is not None and len(columns) > lag_index:
                with suppress(ValueError):
                    total += int(columns[lag_index])
        return total

    def per_service_cpu(self, interval: float = 2.0) -> dict[str, float]:
        """Per-service CPU% (100% = one core) sampled over `interval` from /proc jiffies."""
        script = _PER_SERVICE_CPU_SCRIPT.replace("__INTERVAL__", str(interval))
        out = self.exec_shell(
            f"python3 -c {_shell_quote(script)}", check=False, capture=True
        ).stdout.strip()
        try:
            return json.loads(out) if out else {}
        except ValueError:
            return {}
        except TypeError:
            return {}

    def container_stats(self) -> dict[str, float]:
        """Live CPU% and memory (MiB) of the container from `docker stats`."""
        out = run(
            [
                "docker",
                "stats",
                "--no-stream",
                "--format",
                "{{.CPUPerc}};{{.MemUsage}}",
                self.config.container,
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        ).stdout.strip()
        if ";" not in out:
            return {"cpu_percent": 0.0, "mem_mib": 0.0}
        cpu_raw, mem_raw = out.split(";", 1)
        cpu = float(cpu_raw.replace("%", "").strip() or 0)
        mem_used = _parse_mem_mib(mem_raw.split("/")[0].strip())
        return {"cpu_percent": round(cpu, 1), "mem_mib": round(mem_used, 1)}

    def restart_service(self, name: str) -> None:
        """Restart a helix-<name>.service inside the appliance and wait for its listener."""
        self.exec_shell(f"systemctl restart helix-{name}.service")
        wait_ports = {"redpanda": 9092, "mosquitto": 8884, "postgres": 5432}
        if name in wait_ports:
            self._wait_container_port(wait_ports[name])

    def export_pki(self, dest: Path) -> dict[str, Path]:
        dest.mkdir(parents=True, exist_ok=True)
        files = {
            "root_ca": (self.config.step_ca_root_cert, dest / "root_ca.crt"),
            "provisioner_jwk": (self.config.step_ca_jwk, dest / "device-provisioner.jwk.json"),
            "server_cert": (f"{self.config.server_pki_dir}/server.crt", dest / "server.crt"),
            "server_key": (f"{self.config.server_pki_dir}/server.key", dest / "server.key"),
            "client_cert": (f"{self.config.server_pki_dir}/client.crt", dest / "client.crt"),
            "client_key": (f"{self.config.server_pki_dir}/client.key", dest / "client.key"),
        }
        for _, (src, out) in files.items():
            run(
                ["docker", "cp", f"{self.config.container}:{src}", str(out)],
                cwd=REPO_ROOT,
            )
        exported = {key: out for key, (_, out) in files.items()}
        crl = self.export_crl(dest / "crl.pem")
        if crl is not None:
            exported["crl"] = crl
        return exported

    def export_crl(self, out: Path) -> Path | None:
        """Copy the current CRL out of the container (None until crl-sync has staged it)."""
        result = run(
            [
                "docker",
                "cp",
                f"{self.config.container}:{self.config.server_pki_dir}/crl.pem",
                str(out),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return out if result.returncode == 0 else None

    def revoke_certificate(self, serial_decimal: str) -> None:
        """Revoke a device certificate by (decimal) serial via step-ca's provisioner."""
        step = (
            f"step ca token {serial_decimal} --revoke --provisioner helix-device "
            "--provisioner-password-file "
            "/var/lib/helix/step-ca/secrets/provisioner-password.txt "
            "--ca-url https://127.0.0.1:9000 "
            "--root /var/lib/helix/step-ca/certs/root_ca.crt"
        )
        self.exec_shell(
            f'tok="$({step})"; '
            f'step ca revoke {serial_decimal} --token "$tok" '
            "--ca-url https://127.0.0.1:9000 "
            "--root /var/lib/helix/step-ca/certs/root_ca.crt"
        )
        # Restart to force an immediate CRL regen rather than wait for cacheDuration.
        self.exec_shell("systemctl restart helix-step-ca.service", check=False)

    def wait_for_crl_serial(self, serial_hex: str, *, timeout: int = 40) -> bool:
        """Poll step-ca's CRL until it lists `serial_hex`, then stage it + reload."""
        script = (
            "curl -fsS --cacert /var/lib/helix/step-ca/certs/root_ca.crt "
            "https://127.0.0.1:9000/crl | openssl crl -inform DER -noout -text "
            "2>/dev/null | grep -i 'Serial Number' || true"
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            out = self.exec_shell(script, capture=True).stdout
            if serial_hex.upper() in out.upper():
                self.refresh_crl()
                return True
            time.sleep(3)
        return False

    def refresh_crl(self) -> None:
        """Force an immediate CRL fetch + broker reload."""
        self.exec_shell("/opt/helix/bin/crl-sync.sh once")
        self.exec_shell("systemctl reload helix-mosquitto.service", check=False)


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def _socket_probe(port: int) -> str:
    connect = f"socket.create_connection(('127.0.0.1', {port}), 2).close()"
    return f'python3 -c "import socket; {connect}"'


_PER_SERVICE_CPU_SCRIPT = r"""
import glob, json, os, time
CLK = os.sysconf("SC_CLK_TCK")
GROUPS = {
    "mosquitto": "mosquitto", "node": "loadtest-dist",
    "postgres": "postgres", "redpanda": "redpanda",
    "redis": "redis-server", "inngest": "inngest",
}
def snap():
    totals = {k: 0 for k in GROUPS}
    for stat_path in glob.glob("/proc/[0-9]*/stat"):
        pid = stat_path.split("/")[2]
        try:
            with open("/proc/%s/cmdline" % pid, "rb") as fh:
                cmd = fh.read().replace(b"\x00", b" ").decode("utf-8", "ignore")
            with open(stat_path) as fh:
                fields = fh.read().rsplit(")", 1)[1].split()
            jiffies = int(fields[11]) + int(fields[12])
        except (OSError, IndexError, ValueError):
            continue
        for name, needle in GROUPS.items():
            if needle in cmd:
                totals[name] += jiffies
                break
    return totals
a = snap(); time.sleep(__INTERVAL__); b = snap()
print(json.dumps({k: round((b[k] - a[k]) / CLK / __INTERVAL__ * 100, 1) for k in GROUPS}))
"""


def _parse_mem_mib(value: str) -> float:
    value = value.strip()
    units = {"GiB": 1024.0, "MiB": 1.0, "KiB": 1.0 / 1024.0, "B": 1.0 / (1024.0 * 1024.0)}
    for suffix, factor in units.items():
        if value.endswith(suffix):
            with suppress(ValueError):
                return float(value[: -len(suffix)]) * factor
    return 0.0
