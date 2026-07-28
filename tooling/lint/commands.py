"""Repo-wide quality gate: `helix lint {go,python,web,all}`."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import click

from tooling.common.paths import REPO_ROOT

# Experimental agents are format-only; the primary module gets the full suite.
GO_MODULE = REPO_ROOT / "linux" / "device" / "go"
GO_FORMAT_ONLY_MODULES = (
    REPO_ROOT / "experimental" / "port-forwarding" / "agent",
    REPO_ROOT / "experimental" / "remote-shell" / "agent",
    REPO_ROOT / "experimental" / "p2p-transport" / "agent",
)
GO_SOURCE_DIRS = ("cmd", "internal")

WEB_ROOT = REPO_ROOT / "web"
DEVICE_PYTHON = REPO_ROOT / "linux" / "device" / "python"

GO_TOOLS: dict[str, str] = {
    "gopls": "golang.org/x/tools/gopls@v0.20.0",
    "shadow": "golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@v0.44.0",
    "staticcheck": "honnef.co/go/tools/cmd/staticcheck@v0.7.0",
    "govulncheck": "golang.org/x/vuln/cmd/govulncheck@v1.3.0",
    "deadcode": "golang.org/x/tools/cmd/deadcode@v0.44.0",
}
DUPL_PACKAGE = "github.com/mibk/dupl@v1.1.0"
DUPL_THRESHOLD = "100"

# Generated bindings are excluded from style/dead-code analyzers (unused exports, no package comment).
GO_GENERATED_PACKAGE_RE = "/internal/[^/]+/generated"
DEADCODE_FILTER = "github.com/helix-kit/helix-device/internal/.*"


@dataclass
class Step:
    name: str
    ok: bool
    detail: str = ""


def _echo_step(name: str) -> None:
    click.echo(click.style(f"\n── {name}", fg="cyan", bold=True))


def _run(command: list[str], cwd: Path) -> tuple[bool, str]:
    click.echo("+ " + " ".join(command))
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    output = (result.stdout or "") + (result.stderr or "")
    if output.strip():
        click.echo(output.rstrip())
    return result.returncode == 0, output


def _require(tool: str) -> None:
    if shutil.which(tool) is None:
        raise click.ClickException(f"missing required command: {tool}")


def _go_bin(name: str) -> Path:
    """Install a pinned analyzer into <module>/.bin on first use and return its path."""
    bin_dir = GO_MODULE / ".bin"
    binary = bin_dir / name
    if binary.exists():
        return binary
    bin_dir.mkdir(parents=True, exist_ok=True)
    click.echo(f"+ go install {GO_TOOLS[name]}  (into {bin_dir})")
    result = subprocess.run(
        ["go", "install", GO_TOOLS[name]],
        cwd=GO_MODULE,
        env={**_go_env(), "GOBIN": str(bin_dir)},
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise click.ClickException(
            f"failed to install {name}: {(result.stderr or result.stdout).strip()}"
        )
    return binary


def _go_env() -> dict[str, str]:
    return dict(os.environ)


def _go_packages(exclude_generated: bool = True) -> list[str]:
    result = subprocess.run(
        ["go", "list", "./..."], cwd=GO_MODULE, text=True, capture_output=True, check=False
    )
    packages = [line for line in result.stdout.split() if line]
    if exclude_generated:
        packages = [p for p in packages if not re.search(GO_GENERATED_PACKAGE_RE, p)]
    return packages


def _go_source_files() -> list[str]:
    """Hand-written Go files (generated bindings excluded) for file-oriented tools."""
    files: list[str] = []
    for directory in GO_SOURCE_DIRS:
        for path in sorted((GO_MODULE / directory).rglob("*.go")):
            rel = path.relative_to(GO_MODULE).as_posix()
            if re.search(r"internal/[^/]+/generated/", rel):
                continue
            files.append(rel)
    return files


def _lint_go(fix: bool, skip: tuple[str, ...]) -> list[Step]:
    _require("go")
    steps: list[Step] = []

    def should(name: str) -> bool:
        return name not in skip

    if fix:
        _echo_step("gofmt -w")
        _run(["gofmt", "-w", *GO_SOURCE_DIRS], GO_MODULE)
        for module in GO_FORMAT_ONLY_MODULES:
            if module.exists():
                _run(["gofmt", "-w", "."], module)

    if should("gofmt"):
        _echo_step("gofmt (format check)")
        ok = True
        unformatted: list[str] = []
        for module in (GO_MODULE, *GO_FORMAT_ONLY_MODULES):
            if not module.exists():
                continue
            paths = list(GO_SOURCE_DIRS) if module == GO_MODULE else ["."]
            result = subprocess.run(
                ["gofmt", "-l", *paths], cwd=module, text=True, capture_output=True, check=False
            )
            for line in result.stdout.split():
                unformatted.append(f"{module.relative_to(REPO_ROOT)}/{line}")
        if unformatted:
            ok = False
            click.echo("not gofmt-clean (run with --fix):")
            for path in unformatted:
                click.echo(f"  {path}")
        steps.append(Step("gofmt", ok, f"{len(unformatted)} unformatted"))

    if should("vet"):
        _echo_step("go vet")
        ok, _ = _run(["go", "vet", "./..."], GO_MODULE)
        steps.append(Step("vet", ok))

    if should("staticcheck"):
        _echo_step("staticcheck")
        packages = _go_packages()
        ok, _ = _run([str(_go_bin("staticcheck")), *packages], GO_MODULE)
        steps.append(Step("staticcheck", ok))

    if should("packagecomments"):
        _echo_step("staticcheck ST1000 (package comments)")
        packages = _go_packages()
        ok, _ = _run([str(_go_bin("staticcheck")), "-checks=ST1000", *packages], GO_MODULE)
        steps.append(Step("packagecomments", ok))

    if should("shadow"):
        _echo_step("shadow (variable shadowing)")
        packages = _go_packages()
        ok, _ = _run([str(_go_bin("shadow")), *packages], GO_MODULE)
        steps.append(Step("shadow", ok))

    if should("deadcode"):
        _echo_step("deadcode")
        ok, output = _run(
            [str(_go_bin("deadcode")), "-test", "-filter", DEADCODE_FILTER, "./..."], GO_MODULE
        )
        # deadcode exits 0 even when it reports findings; any output is a finding.
        ok = ok and not output.strip()
        steps.append(Step("deadcode", ok))

    if should("gopls"):
        _echo_step("gopls check")
        files = _go_source_files()
        ok, _ = _run([str(_go_bin("gopls")), "check", *files], GO_MODULE)
        steps.append(Step("gopls", ok))

    if should("dupl"):
        _echo_step(f"dupl (clone detection, threshold {DUPL_THRESHOLD})")
        files = _go_source_files()
        proc = subprocess.run(
            ["go", "run", DUPL_PACKAGE, "-t", DUPL_THRESHOLD, "-files"],
            cwd=GO_MODULE,
            input="\n".join(files) + "\n",
            text=True,
            capture_output=True,
            check=False,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        if output.strip():
            click.echo(output.rstrip())
        # dupl exits 0 regardless of findings; anything but "Found total 0 clone groups" is a finding.
        ok = "Found total 0 clone groups" in output or not output.strip()
        steps.append(Step("dupl", ok))

    if should("govulncheck"):
        _echo_step("govulncheck")
        ok, _ = _run([str(_go_bin("govulncheck")), "./..."], GO_MODULE)
        steps.append(Step("govulncheck", ok))

    return steps


def _lint_python(fix: bool) -> list[Step]:
    steps: list[Step] = []

    _echo_step("ruff")
    ruff = ["uv", "run", "ruff", "check", "."]
    if fix:
        ruff.append("--fix")
    ok, _ = _run(ruff, REPO_ROOT)
    steps.append(Step("ruff", ok))

    _echo_step("black")
    black = ["uv", "run", "black", "."] if fix else ["uv", "run", "black", "--check", "."]
    ok, _ = _run(black, REPO_ROOT)
    steps.append(Step("black", ok))

    # Device tree needs py310 black (own config): the py314 run applies PEP 758 rewrites that break it.
    _echo_step("black (device python @ py310)")
    device_black = ["uv", "run", "black", "--config", str(DEVICE_PYTHON / "black.toml")]
    device_black += ["."] if fix else ["--check", "."]
    ok, _ = _run(device_black, DEVICE_PYTHON)
    steps.append(Step("black:device", ok))

    _echo_step("mypy (tooling, embedded, cloud, tests)")
    ok, _ = _run(["uv", "run", "mypy", "."], REPO_ROOT)
    steps.append(Step("mypy", ok))

    _echo_step("mypy (device python packages)")
    # Address packages by module name (-p), not path: mypy_path maps the src-layout roots already.
    ok, _ = _run(
        [
            "uv",
            "run",
            "mypy",
            "--config-file",
            str(DEVICE_PYTHON / "mypy.ini"),
            "-p",
            "helix_service_runtime",
            "-p",
            "helix_echo",
        ],
        DEVICE_PYTHON,
    )
    steps.append(Step("mypy:device", ok))

    return steps


def _lint_web(fix: bool) -> list[Step]:
    _require("pnpm")
    steps: list[Step] = []

    _echo_step("eslint (turbo lint)")
    lint = ["pnpm", "lint"] + (["--", "--fix"] if fix else [])
    ok, _ = _run(lint, WEB_ROOT)
    steps.append(Step("eslint", ok))

    _echo_step("tsc (turbo typecheck)")
    ok, _ = _run(["pnpm", "typecheck"], WEB_ROOT)
    steps.append(Step("typecheck", ok))

    return steps


def _report(steps: list[Step]) -> None:
    click.echo(click.style("\n── summary", fg="cyan", bold=True))
    for step in steps:
        mark = click.style("PASS", fg="green") if step.ok else click.style("FAIL", fg="red")
        suffix = f"  ({step.detail})" if step.detail and not step.ok else ""
        click.echo(f"  {mark}  {step.name}{suffix}")
    failed = [step.name for step in steps if not step.ok]
    if failed:
        raise click.ClickException(f"lint failed: {', '.join(failed)}")
    click.echo(click.style("\nall checks passed", fg="green", bold=True))


@click.group()
def lint() -> None:
    """Lint, format, and type-check the repository."""


@lint.command("go")
@click.option("--fix", is_flag=True, help="Rewrite files with gofmt before checking.")
@click.option(
    "--skip",
    multiple=True,
    type=click.Choice(
        [
            "gofmt",
            "vet",
            "staticcheck",
            "packagecomments",
            "shadow",
            "deadcode",
            "gopls",
            "dupl",
            "govulncheck",
        ]
    ),
    help="Skip a check (repeatable).",
)
def lint_go(fix: bool, skip: tuple[str, ...]) -> None:
    """Go: gofmt, vet, staticcheck, shadow, deadcode, gopls, dupl, govulncheck."""
    _report(_lint_go(fix, skip))


@lint.command("python")
@click.option("--fix", is_flag=True, help="Apply ruff --fix and rewrite with black.")
def lint_python(fix: bool) -> None:
    """Python: ruff, black, mypy (strict)."""
    _report(_lint_python(fix))


@lint.command("web")
@click.option("--fix", is_flag=True, help="Apply eslint --fix.")
def lint_web(fix: bool) -> None:
    """TypeScript: eslint + tsc, across the pnpm workspace via turbo."""
    _report(_lint_web(fix))


@lint.command("all")
@click.option("--fix", is_flag=True, help="Apply every available auto-fix first.")
def lint_all(fix: bool) -> None:
    """Run the Go, Python, and TypeScript gates."""
    steps = _lint_go(fix, ()) + _lint_python(fix) + _lint_web(fix)
    _report(steps)
