# SPDX-License-Identifier: AGPL-3.0-only
"""Bootstrap harness for a Python device app: flags, logging, run-forever."""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from typing import Protocol

from .config import DeviceConfig, load_device_config


class Service(Protocol):
    def run_forever(self) -> None: ...


def configure_logging(logger_name: str) -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )
    return logging.getLogger(logger_name)


def run_service_main(
    argv: Sequence[str] | None,
    *,
    description: str,
    version: str,
    logger_name: str,
    build_service: Callable[[DeviceConfig, logging.Logger], Service],
) -> int:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--config", required=False, help="path to the device config JSON")
    parser.add_argument("--version", action="version", version=f"{logger_name} {version}")
    args = parser.parse_args(argv)
    if not args.config:
        parser.error("--config is required")

    log = configure_logging(logger_name)
    config = load_device_config(args.config)
    service = build_service(config, log)
    try:
        service.run_forever()
    except KeyboardInterrupt:
        log.info("interrupted")
    return 0
