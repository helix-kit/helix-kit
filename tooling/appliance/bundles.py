from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT
from tooling.common.process import run

WEB_ROOT = REPO_ROOT / "web"
OUT_DIR = REPO_ROOT / "cloud" / "appliance" / "bundles"
STAGE_DIR = REPO_ROOT / "cloud" / "appliance" / ".stage"
EMIT_RUNTIME = WEB_ROOT / "scripts" / "emit-runtime-package.cjs"

# install-bundles.sh derives the install name from "<name>-<version>.zip", so version MUST NOT contain '-'.
BUNDLE_NAMES = ("helix-cloud-app", "helix-server")

# The two app builds we drive directly (not `turbo run build`); they consume workspace packages from source.
BUILD_FILTERS = ("--filter", "helix", "--filter", "@helix/server-app")


def _default_version() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    sha = result.stdout.strip() or "nogit"
    return f"0.0.0+{sha}"


def _strip_sourcemaps(src: Path) -> None:
    # Drop only *.map files; do NOT edit the //# sourceMappingURL= pointers (corrupts JS-as-string bundles).
    for path in src.rglob("*.map"):
        if path.is_file():
            path.unlink()


def _zip_bundle(name: str, src: Path, version: str) -> Path:
    zip_path = OUT_DIR / f"{name}-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    _strip_sourcemaps(src)
    # -y keeps symlinks as symlinks: dereferencing the pnpm tree's links breaks runtime resolution.
    run(["zip", "-qry", str(zip_path), "."], cwd=src)
    return zip_path


def _stage_cloud_app(version: str, arch: str = "amd64") -> Path:
    app = STAGE_DIR / "helix-cloud-app"
    app.mkdir(parents=True)
    standalone = WEB_ROOT / "apps" / "helix" / ".next" / "standalone"
    if not standalone.exists():
        raise click.ClickException(
            f"{standalone} not found — the helix app must be built with output:'standalone'."
        )
    # symlinks=True preserves the pnpm tree's relative symlinks.
    shutil.copytree(standalone, app, dirs_exist_ok=True, symlinks=True)
    static_dst = app / "apps" / "helix" / ".next" / "static"
    static_dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(WEB_ROOT / "apps/helix/.next/static", static_dst, dirs_exist_ok=True)

    pnpm_dir = app / "node_modules" / ".pnpm"
    if arch == "arm64":
        # Sweep the native sharp binary out so the zip is arch-independent (arm64 builds skip it).
        for path in pnpm_dir.glob("@img+sharp*"):
            shutil.rmtree(path, ignore_errors=True)
        for path in pnpm_dir.glob("sharp@*"):
            shutil.rmtree(path, ignore_errors=True)
        # Drop the now-dangling pnpm virtual-store links to the removed dirs.
        for link in app.rglob("*"):
            if link.is_symlink() and "sharp" in link.name and not link.exists():
                link.unlink(missing_ok=True)
    else:
        # Keep glibc sharp (Debian appliance base); drop the musl variant host pnpm also fetched.
        for pattern in ("@img+sharp-linuxmusl-x64*", "@img+sharp-libvips-linuxmusl-x64*"):
            for path in pnpm_dir.glob(pattern):
                shutil.rmtree(path, ignore_errors=True)
    return _zip_bundle("helix-cloud-app", app, version)


def _stage_node_service(bundle: str, app_dir: str, version: str) -> Path:
    """Emit a runtime package.json, `npm install --omit=dev` the runtime deps, + the dist."""
    svc = STAGE_DIR / bundle
    svc.mkdir(parents=True)
    entry = WEB_ROOT / "apps" / app_dir / "dist" / "index.js"
    if not entry.exists():
        raise click.ClickException(f"{entry} not found — run the build first (skip_build=False).")
    run(["node", str(EMIT_RUNTIME), str(entry), str(svc / "package.json")], cwd=WEB_ROOT)
    run(["npm", "install", "--omit=dev", "--no-audit", "--no-fund"], cwd=svc)
    shutil.copytree(WEB_ROOT / "apps" / app_dir / "dist", svc / "dist", dirs_exist_ok=True)
    return _zip_bundle(bundle, svc, version)


def build_bundles(
    version: str | None = None,
    only: str | None = None,
    skip_build: bool = False,
    arch: str = "amd64",
) -> list[Path]:
    """Build the appliance web bundles (host-built glibc zips) into cloud/appliance/bundles/."""
    for tool in ("node", "pnpm", "npm", "zip"):
        if shutil.which(tool) is None:
            raise click.ClickException(f"missing required command: {tool}")
    if only is not None and only not in BUNDLE_NAMES:
        raise click.ClickException(
            f"unknown bundle '{only}'; choose from {', '.join(BUNDLE_NAMES)}"
        )

    version = version or _default_version()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clear stale zips (version is in the filename) so a bump doesn't leave two sets baked.
    for stale in OUT_DIR.glob(f"{only}-*.zip" if only else "*.zip"):
        stale.unlink()
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    STAGE_DIR.mkdir(parents=True)

    if not skip_build:
        run(["pnpm", "install", "--frozen-lockfile"], cwd=WEB_ROOT)
        node_options = f"{os.environ.get('NODE_OPTIONS', '')} --max-old-space-size=4096".strip()
        build_env = {
            **os.environ,
            # Packaging lacks the app's full runtime env; the heap cap avoids a Turbopack OOM.
            "SKIP_ENV_VALIDATION": "true",
            "NODE_OPTIONS": node_options,
        }
        if arch == "arm64":
            # Build without the image optimiser so native per-arch `sharp` is never traced in.
            build_env["HELIX_IMAGES_UNOPTIMIZED"] = "true"
        run(["pnpm", *BUILD_FILTERS, "run", "build"], cwd=WEB_ROOT, env=build_env)

    built: list[Path] = []
    if only in (None, "helix-cloud-app"):
        built.append(_stage_cloud_app(version, arch=arch))
    if only in (None, "helix-server"):
        built.append(_stage_node_service("helix-server", "helix-server", version))
    return built
