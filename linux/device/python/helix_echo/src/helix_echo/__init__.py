# SPDX-License-Identifier: AGPL-3.0-only
"""Python echo device app built on the generated Helix contract.

The Python-SDK twin of the Go ``internal/echo`` service: both consume the same
``echo.json`` contract via generated typed dispatch, so the wire format is
defined once and shared across languages.
"""

from .service import EchoService, build_service, main

__all__ = ["EchoService", "build_service", "main"]
