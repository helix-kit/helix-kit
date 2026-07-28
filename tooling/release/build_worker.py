"""Real ESP32 custom-firmware build worker."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from tooling.common.paths import REPO_ROOT
from tooling.release.sim import JsonDict, ReleaseClient

ESP32_CORE = REPO_ROOT / "embedded" / "esp32" / "core"

# manifest artifact/offset key -> backend flashable role
_ROLE_MAP: tuple[tuple[str, str], ...] = (
    ("bootloader", "bootloader"),
    ("partitionTable", "partition-table"),
    ("otaData", "ota-data"),
    ("app", "app"),
)

Echo = Callable[[str], None]


def config_hash(config: JsonDict) -> str:
    canonical = {
        "apps": sorted(config.get("apps", [])),
        "chip": config.get("chip"),
        "features": sorted(config.get("features", [])),
        "flashSize": config.get("flashSize"),
        "set": config.get("set") or {},
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()


def read_firmware_dir(out_dir: Path) -> tuple[list[JsonDict], JsonDict]:
    """Read a built firmware output dir into (flashable artifacts with bytes+offsets, the manifest)."""
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert isinstance(manifest, dict)
    artifacts: list[JsonDict] = []
    for manifest_key, role in _ROLE_MAP:
        filename = manifest["artifacts"][manifest_key]
        data = (out_dir / filename).read_bytes()
        artifacts.append(
            {
                "role": role,
                "offset": manifest["offsets"][manifest_key],
                "sha256": hashlib.sha256(data).hexdigest(),
                "sizeBytes": len(data),
                "data": data,
            }
        )
    return artifacts, manifest


def build_esp32_firmware(
    config: JsonDict, *, echo: Echo = print
) -> tuple[list[JsonDict], JsonDict]:
    """Build a customized firmware via the helix CLI (auto-dockerized)."""
    out_name = f"build-{config_hash(config)[:12]}"
    args = [
        sys.executable,
        "-m",
        "tooling.cli",
        "embedded",
        "esp32",
        "link",
        "--build-dir",
        f".build/{out_name}",
        "--out-name",
        out_name,
    ]
    for feature in config.get("features", []):
        args += ["--feature", feature]
    for key, value in (config.get("set") or {}).items():
        args += ["--set", f"{key}={value}"]
    args += list(config.get("apps", []))

    echo(f"[build] esp32 link {' '.join(args[6:])}")
    subprocess.run(args, cwd=REPO_ROOT, check=True)

    return read_firmware_dir(ESP32_CORE / "out" / "firmware" / out_name)


def analyze_firmware(config: JsonDict, *, echo: Echo = print) -> JsonDict | None:
    """Best-effort size analysis of a freshly built config's firmware."""
    out_name = f"build-{config_hash(config)[:12]}"
    args = [
        sys.executable,
        "-m",
        "tooling.cli",
        "embedded",
        "esp32",
        "analyze",
        "--host",
        "--build-dir",
        f".build/{out_name}",
        "--firmware-dir",
        f"out/firmware/{out_name}",
        "--format",
        "json",
    ]
    try:
        result = subprocess.run(args, cwd=REPO_ROOT, check=True, capture_output=True, text=True)
        parsed = json.loads(result.stdout)
        return parsed if isinstance(parsed, dict) else None
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        echo(f"[build] analyze skipped: {exc}")
        return None


def complete_build(
    client: ReleaseClient,
    build_id: str,
    token: str,
    *,
    name: str,
    version: str,
    channel: str,
    selector: JsonDict,
    config: JsonDict,
    echo: Echo = print,
    analyze: bool = False,
) -> JsonDict:
    """Build the firmware for an already-requested build, upload artifacts, and post completion."""
    started = time.monotonic()
    artifacts, manifest = build_esp32_firmware(config, echo=echo)
    for artifact in artifacts:
        client.upload_build_blob(
            build_id, token, artifact["sha256"], artifact["sizeBytes"], artifact["data"]
        )
    analysis = analyze_firmware(config, echo=echo) if analyze else None

    release: JsonDict = {
        "typeKey": "esp32-firmware",
        "name": name,
        "version": version,
        "channel": channel,
        "publish": True,
        "config": config,
        "sourceCommit": manifest.get("source", {}).get("revision"),
        "sourceDirty": bool(manifest.get("source", {}).get("dirty")),
        "variants": [
            {
                "selector": selector,
                "artifacts": [
                    {
                        "role": a["role"],
                        "offset": a["offset"],
                        "sha256": a["sha256"],
                        "sizeBytes": a["sizeBytes"],
                    }
                    for a in artifacts
                ],
            }
        ],
    }
    duration_ms = int((time.monotonic() - started) * 1000)
    result = client.build_complete(
        build_id, token, release, analysis=analysis, duration_ms=duration_ms
    )
    echo(f"[build] complete in {duration_ms}ms -> release {result.get('releaseId')}")
    return {
        "status": "built",
        "buildId": build_id,
        "releaseId": result.get("releaseId"),
        "appSha256": next(a["sha256"] for a in artifacts if a["role"] == "app"),
        "durationMs": duration_ms,
    }


def run_custom_build(
    client: ReleaseClient,
    *,
    name: str,
    version: str,
    channel: str,
    selector: JsonDict,
    config: JsonDict,
    owner_user_id: str,
    echo: Echo = print,
) -> JsonDict:
    """Request a custom build (Tier-0 dedupe), run it, upload artifacts, and complete."""
    request = client.request_build(config, owner_user_id, selector)
    if request["status"] == "hit":
        echo(f"[build] Tier-0 cache hit -> release {request['releaseId']}")
        return request
    return complete_build(
        client,
        request["buildId"],
        request["callbackToken"],
        name=name,
        version=version,
        channel=channel,
        selector=selector,
        config=config,
        echo=echo,
    )
