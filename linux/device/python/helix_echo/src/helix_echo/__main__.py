# SPDX-License-Identifier: AGPL-3.0-only
"""Entry point: ``python -m helix_echo --config <device-config.json>``."""

from __future__ import annotations

import sys

from .service import main

if __name__ == "__main__":
    sys.exit(main())
