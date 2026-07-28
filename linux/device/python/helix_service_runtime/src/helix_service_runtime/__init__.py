# SPDX-License-Identifier: AGPL-3.0-only
"""Helix device app SDK: connect to helixd over IPC and build a service.

A new Python app writes ~3 small files (config slice, a service class, a main)
and inherits connect/register/dispatch/reply from this package.
"""

from .config import DeviceConfig, load_device_config
from .dispatch import CommandHandler, respond, respond_error, run_command_loop
from .ipc import IPCClient, IPCError
from .main import Service, configure_logging, run_service_main

__all__ = [
    "IPCClient",
    "IPCError",
    "CommandHandler",
    "respond",
    "respond_error",
    "run_command_loop",
    "DeviceConfig",
    "load_device_config",
    "Service",
    "configure_logging",
    "run_service_main",
]
