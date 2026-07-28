#!/usr/bin/env python3
"""Generate the appliance's systemd units from systemd-units.json.

Run at image-build time (see cloud/appliance/Dockerfile). Writes each unit to
/etc/systemd/system, creates the WantedBy symlinks for enabled units, and masks
the Debian-packaged services that would otherwise steal ports. This replaces ~24
hand-written .service/.target files with one declarative manifest.

Manifest shape (see systemd-units.json):
  defaults: { envFiles, restart, restartSec, wantedBy }
  masked:   [ "postgresql.service", ... ]   # symlinked to /dev/null
  targets:  { "<name>.target": { description, requires, after, wants, install, extra } }
  services: { "<short>": {                  # -> helix-<short>.service
      description, type, remainAfterExit, comment,
      after/before/requires/wants/partOf: [deps],   # bare "postgres" -> helix-postgres.service
      user, group, workingDirectory, environment: {K:V},
      envFiles: ["internal","secrets","site"] | "none",
      execStartPre: [..], execStart: "..", execStartPost: [..],
      restart, restartSec, wantedBy, enabled: bool,
      extra: { Unit: {K:V}, Service: {K:V} } } }
"""

import argparse
import json
import os
import pathlib
from typing import Any

# One entry of the systemd-units.json manifest (a target or service spec).
Spec = dict[str, Any]

ENV_DIR = "/var/lib/helix/env"
ENV_FILES = {name: f"-{ENV_DIR}/{name}.env" for name in ("internal", "secrets", "site")}


def dep(token: str) -> str:
    """Bare name -> helix-<name>.service; anything with a '.' passes through."""
    return token if "." in token else f"helix-{token}.service"


def render_unit_section(spec: Spec) -> list[str]:
    lines = ["[Unit]", f"Description={spec['description']}"]
    for key, field in (
        ("Requires", "requires"),
        ("Wants", "wants"),
        ("After", "after"),
        ("Before", "before"),
        ("PartOf", "partOf"),
    ):
        vals = spec.get(field)
        if vals:
            lines.append(f"{key}=" + " ".join(dep(v) for v in vals))
    for key, val in spec.get("extra", {}).get("Unit", {}).items():
        lines.append(f"{key}={val}")
    return lines


def render_service(name: str, spec: Spec, defaults: Spec) -> tuple[str, str, str | None]:
    lines = render_unit_section(spec)
    lines += ["", "[Service]"]
    if spec.get("comment"):
        lines += [f"# {line}" for line in spec["comment"].split("\n")]
    if "type" in spec:
        lines.append(f"Type={spec['type']}")
    if spec.get("remainAfterExit"):
        lines.append("RemainAfterExit=yes")
    for key, field in (
        ("User", "user"),
        ("Group", "group"),
        ("WorkingDirectory", "workingDirectory"),
    ):
        if field in spec:
            lines.append(f"{key}={spec[field]}")
    for k, v in spec.get("environment", {}).items():
        lines.append(f"Environment={k}={v}")
    raw_env_files = spec.get("envFiles", defaults.get("envFiles", []))
    # Either a list of env-file names or the literal "none" to opt out entirely.
    env_files: list[str] | str = [] if raw_env_files is None else raw_env_files
    if env_files != "none":
        for ef in env_files:
            lines.append(f"EnvironmentFile={ENV_FILES[ef]}")
    for key, val in spec.get("extra", {}).get("Service", {}).items():
        lines.append(f"{key}={val}")
    for pre in spec.get("execStartPre", []):
        lines.append(f"ExecStartPre={pre}")
    if "execStart" in spec:
        lines.append(f"ExecStart={spec['execStart']}")
    for post in spec.get("execStartPost", []):
        lines.append(f"ExecStartPost={post}")
    if spec.get("type") != "oneshot":
        lines.append(f"Restart={spec.get('restart', defaults['restart'])}")
        lines.append(f"RestartSec={spec.get('restartSec', defaults['restartSec'])}")
    wanted_by = spec.get("wantedBy", defaults["wantedBy"]) if spec.get("enabled", True) else None
    install = spec.get("wantedBy", defaults["wantedBy"])
    lines += ["", "[Install]", f"WantedBy={install}", ""]
    return f"helix-{name}.service", "\n".join(lines), wanted_by


def render_target(name: str, spec: Spec) -> tuple[str, str, str | None]:
    lines = render_unit_section(spec)
    install = spec.get("install")
    if install:
        lines += ["", "[Install]", f"WantedBy={install}", ""]
    else:
        lines.append("")
    return name, "\n".join(lines), install


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="/opt/helix/systemd-units.json")
    parser.add_argument("--out", default="/etc/systemd/system")
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Service short-names to skip entirely (not written, not enabled). "
        "Lets a delivery drop services it doesn't run — e.g. the native AMI, "
        "which uses DBOS and omits 'inngest' 'redis' — without editing the "
        "shared manifest. Excluding a service only removes ordering deps on it "
        "in other units (After/Wants); a hard Requires on an excluded unit would "
        "fail, so exclude only leaf/optional services.",
    )
    parser.add_argument(
        "--no-mask",
        nargs="*",
        default=[],
        help="Manifest 'masked' entries to NOT mask. Several masks (getty@, "
        "serial-getty@, systemd-logind, ...) exist only because the container "
        "shares the host's /dev; a real host (the native AMI) needs its console "
        "+ login sessions, so it un-masks them here without editing the manifest.",
    )
    args = parser.parse_args()
    exclude = set(args.exclude)
    keep_masked = set(args.no_mask)

    manifest = json.loads(pathlib.Path(args.manifest).read_text())
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    defaults = manifest["defaults"]

    def enable(unit: str, wanted_by: str | None) -> None:
        if not wanted_by:
            return
        wants_dir = out / f"{wanted_by}.wants"
        wants_dir.mkdir(exist_ok=True)
        link = wants_dir / unit
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(out / unit)

    for name, spec in manifest.get("targets", {}).items():
        unit, body, wanted_by = render_target(name, spec)
        (out / unit).write_text(body)
        enable(unit, wanted_by)

    written = 0
    for name, spec in manifest["services"].items():
        if name in exclude:
            continue
        unit, body, wanted_by = render_service(name, spec, defaults)
        (out / unit).write_text(body)
        enable(unit, wanted_by)
        written += 1

    # Mask Debian-packaged services (symlink to /dev/null) so only ours run.
    masked_count = 0
    for masked in manifest.get("masked", []):
        if masked in keep_masked:
            continue
        link = out / masked
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(os.devnull)
        masked_count += 1

    excluded = f", excluded {sorted(exclude)}" if exclude else ""
    kept = f", kept-unmasked {sorted(keep_masked)}" if keep_masked else ""
    print(
        f"gen-units: wrote {written} services + "
        f"{len(manifest.get('targets', {}))} targets, "
        f"masked {masked_count}{excluded}{kept}"
    )


if __name__ == "__main__":
    main()
