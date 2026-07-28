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

# The web apps shipped as appliance bundles. `install-bundles.sh` derives each
# bundle's install name from "<name>-<version>.zip", so the name is everything
# before the last '-'; the version therefore MUST NOT contain a '-' (we use
# "0.0.0+<sha>"). The unit files run helix-cloud-app as `node apps/helix/
# server.js` and helix-server as `node dist/index.js`.
BUNDLE_NAMES = ("helix-cloud-app", "helix-server")

# The two app builds we drive DIRECTLY (not `turbo run build`): the apps consume
# workspace packages from source (Next transpilePackages / tsdown bundles src),
# so the packages need no prior `^build` — and skipping it dodges the repo-wide
# tsdown config-loader break. cloud-init is intentionally absent — migrations
# run from the host via `helix appliance` against the mapped DB.
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
    """Drop only the *.map FILES from the shipped copy (the shared turbo build
    keeps maps on so the cloud images stay debuggable). We deliberately do NOT
    edit .js content to remove the `//# sourceMappingURL=` pointers: a line-based
    removal corrupts any bundle that embeds JS-as-string containing such a line
    (it did — it broke a string literal in the helix-server bundle). A dangling
    pointer just makes Node log a harmless warning under --enable-source-maps,
    which the appliance doesn't set."""
    for path in src.rglob("*.map"):
        if path.is_file():
            path.unlink()


def _zip_bundle(name: str, src: Path, version: str) -> Path:
    zip_path = OUT_DIR / f"{name}-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    _strip_sourcemaps(src)
    # -y keeps symlinks AS symlinks: the Next standalone is a pnpm tree with many
    # relative symlinks Node resolves deps through; dereferencing them breaks
    # module resolution at runtime (mirrors the cloud image's Docker COPY).
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
        # The arm64 build runs with HELIX_IMAGES_UNOPTIMIZED=true, so Next never
        # traces sharp into the standalone output. Sweep any stragglers: sharp is
        # the only native binary in the tree, and dropping it leaves a bundle with
        # no .node files at all — i.e. one zip that runs on x86_64 and arm64 alike.
        # (We build on an x86 laptop; pnpm only ever stages the host's sharp.)
        for path in pnpm_dir.glob("@img+sharp*"):
            shutil.rmtree(path, ignore_errors=True)
        for path in pnpm_dir.glob("sharp@*"):
            shutil.rmtree(path, ignore_errors=True)
        # pnpm's virtual store links every package into .pnpm/node_modules/; those
        # links now dangle at the dirs above, so drop them too rather than ship a
        # bundle full of broken symlinks.
        for link in app.rglob("*"):
            if link.is_symlink() and "sharp" in link.name and not link.exists():
                link.unlink(missing_ok=True)
    else:
        # Keep glibc sharp (the appliance base is Debian/glibc); drop the musl
        # variant the host pnpm also fetched so the wrong libc binary never loads.
        for pattern in ("@img+sharp-linuxmusl-x64*", "@img+sharp-libvips-linuxmusl-x64*"):
            for path in pnpm_dir.glob(pattern):
                shutil.rmtree(path, ignore_errors=True)
    return _zip_bundle("helix-cloud-app", app, version)


def _stage_node_service(bundle: str, app_dir: str, version: str) -> Path:
    """Emit a minimal runtime package.json from the built bundle, `npm install
    --omit=dev` only the runtime deps (host glibc == appliance glibc), + the dist."""
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
    """Build the appliance web bundles (host-built glibc zips) into
    cloud/appliance/bundles/. Mirrors the cloud.Dockerfile staging."""
    for tool in ("node", "pnpm", "npm", "zip"):
        if shutil.which(tool) is None:
            raise click.ClickException(f"missing required command: {tool}")
    if only is not None and only not in BUNDLE_NAMES:
        raise click.ClickException(
            f"unknown bundle '{only}'; choose from {', '.join(BUNDLE_NAMES)}"
        )

    version = version or _default_version()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clear stale zips (version is in the filename) so a bump doesn't leave two
    # sets that both get mounted/baked. Scope the wipe when --only is given.
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
            # SKIP_ENV_VALIDATION: packaging doesn't have the app's full runtime
            # env; the heap cap keeps the Next build from OOMing under Turbopack.
            "SKIP_ENV_VALIDATION": "true",
            "NODE_OPTIONS": node_options,
        }
        if arch == "arm64":
            # Build the Next app without the image optimiser so `sharp` (the only
            # native, per-arch binary in the tree) is never traced into the
            # standalone output — see next.config.ts and _stage_cloud_app.
            build_env["HELIX_IMAGES_UNOPTIMIZED"] = "true"
        run(["pnpm", *BUILD_FILTERS, "run", "build"], cwd=WEB_ROOT, env=build_env)

    built: list[Path] = []
    if only in (None, "helix-cloud-app"):
        built.append(_stage_cloud_app(version, arch=arch))
    if only in (None, "helix-server"):
        built.append(_stage_node_service("helix-server", "helix-server", version))
    return built
