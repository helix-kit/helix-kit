# SPDX-License-Identifier: AGPL-3.0-only
"""Echo service: register over IPC and answer "ping" commands with "pong"."""

from __future__ import annotations

import logging
import threading

from helix_service_runtime import (
    DeviceConfig,
    IPCClient,
    Service,
    run_command_loop,
    run_service_main,
)

from .generated.echo import (
    ECHO_SERVICE,
    EchoPingInput,
    EchoPongOutput,
    dispatch_echo,
)


class EchoService:
    """Implements the generated ``EchoHandler`` and pumps IPC commands into it."""

    def __init__(self, config: DeviceConfig, log: logging.Logger) -> None:
        self._log = log
        self._ipc = IPCClient(config.ipc_socket_path, ECHO_SERVICE, log)
        self._stop = threading.Event()

    def handle_ping(self, request: EchoPingInput) -> EchoPongOutput:
        return EchoPongOutput(echo=request.message or "", service=ECHO_SERVICE)

    def run_forever(self) -> None:
        self._ipc.connect()
        try:
            run_command_loop(
                self._ipc,
                self._stop,
                lambda command: dispatch_echo(self._ipc, self._log, command, self),
            )
        finally:
            self._ipc.close()


def build_service(config: DeviceConfig, log: logging.Logger) -> Service:
    return EchoService(config, log)


def main() -> int:
    return run_service_main(
        None,
        description="Helix Python echo device app",
        version="0.1.0",
        logger_name="helix-echo",
        build_service=build_service,
    )
