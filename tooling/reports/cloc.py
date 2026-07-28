from __future__ import annotations

import csv
import io
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from tooling.common.paths import REPO_ROOT

try:
    import pathspec
except ImportError:  # pragma: no cover - pathspec is a declared dependency
    pathspec = None  # type: ignore[assignment]

# Directory/build noise that must never skew the counts, even when a stray
# artifact is untracked-but-not-ignored locally or `.git` is absent. Matched on
# any path component.
_NOISE = re.compile(
    r"(^|/)("
    r"node_modules|\.next|dist|out|\.turbo|\.source|__pycache__|"
    r"\.venv|\.mypy_cache|\.ruff_cache|\.pytest_cache|"
    r"\.idea|\.kotlin|\.gradle|\.git|\.bin|"
    r"build|build-host|build-qemu|build-profiles|target|managed_components|\.build|"
    r"\.stage|\.bundle|\.remember|\.playwright-mcp|\.helix-remote|artifacts"
    r")(/|$)"
)

# Source-code file extensions, used for experimental buckets and to surface any
# unbucketed code so nothing counts silently to zero.
_CODE_EXT = r"\.(c|h|cpp|hpp|cc|cxx|ino|go|py|ts|tsx|js|jsx|mjs|cjs|kt|kts|rs|sh|bash|swift|m|mm)$"
_C_EXT = r"\.(c|h|cpp|hpp|cc|cxx|ino)$"
_KT_EXT = r"\.(kt|kts)$"


@dataclass(frozen=True)
class Bucket:
    """A named slice of the tree, matched by an include regex minus excludes."""

    label: str
    category: str
    include: str
    excludes: tuple[str, ...] = ()


@dataclass
class Totals:
    files: int = 0
    blank: int = 0
    comment: int = 0
    code: int = 0

    def add(self, other: Totals) -> None:
        self.files += other.files
        self.blank += other.blank
        self.comment += other.comment
        self.code += other.code


@dataclass
class Row:
    label: str
    category: str
    totals: Totals = field(default_factory=Totals)


# --------------------------------------------------------------------------- #
# File enumeration — git when available, else a .gitignore-honoring walk.
# --------------------------------------------------------------------------- #
def _list_repo_files(repo_root: Path) -> list[str]:
    """All tracked + untracked-but-not-ignored files, as repo-relative POSIX paths."""
    if (repo_root / ".git").exists():
        try:
            result = subprocess.run(
                ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                cwd=repo_root,
                capture_output=True,
                text=True,
                check=True,
            )
            return sorted(
                line for line in result.stdout.splitlines() if line and not _NOISE.search(line)
            )
        # NOTE: one handler per type on purpose — a tuple `except (A, B):` gets
        # rewritten by black under py314 into the PEP 758 `except A, B:` form,
        # which is a SyntaxError on the py3.12 ESP-IDF image that runs this CLI.
        except subprocess.CalledProcessError:
            pass
        except FileNotFoundError:
            pass
    return _walk_repo_files(repo_root)


def _ignored(specs: dict[str, object], rel_path: str, is_dir: bool) -> bool:
    """True if rel_path is ignored by any ancestor .gitignore spec."""
    target = rel_path + "/" if is_dir else rel_path
    for base, spec in specs.items():
        if base == "":
            sub = target
        elif rel_path.startswith(base + "/"):
            sub = target[len(base) + 1 :]
        else:
            continue
        if sub and spec.match_file(sub):  # type: ignore[attr-defined]
            return True
    return False


def _walk_repo_files(repo_root: Path) -> list[str]:
    """Filesystem walk honoring nested .gitignore files (via pathspec) + _NOISE.

    Used when `.git` is absent (e.g. a fresh tree before the first commit). Symlinked
    dirs/files are skipped so the symlinked protocol libraries are not double-counted.
    """
    files: list[str] = []
    specs: dict[str, object] = {}
    root = str(repo_root)

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")

        if pathspec is not None:
            gitignore = os.path.join(dirpath, ".gitignore")
            if os.path.isfile(gitignore):
                try:
                    with open(gitignore, encoding="utf-8") as handle:
                        lines = handle.read().splitlines()
                    specs[rel_dir] = pathspec.GitIgnoreSpec.from_lines(lines)
                except OSError:
                    pass

        kept: list[str] = []
        for name in dirnames:
            child = f"{rel_dir}/{name}" if rel_dir else name
            if _NOISE.search(child + "/") or os.path.islink(os.path.join(dirpath, name)):
                continue
            if _ignored(specs, child, is_dir=True):
                continue
            kept.append(name)
        dirnames[:] = kept

        for name in filenames:
            rel = f"{rel_dir}/{name}" if rel_dir else name
            if _NOISE.search(rel) or os.path.islink(os.path.join(dirpath, name)):
                continue
            if _ignored(specs, rel, is_dir=False):
                continue
            files.append(rel)

    return sorted(files)


def _match(files: list[str], bucket: Bucket) -> list[str]:
    include = re.compile(bucket.include)
    excludes = [re.compile(pattern) for pattern in bucket.excludes]
    return [f for f in files if include.search(f) and not any(ex.search(f) for ex in excludes)]


def _cloc_totals(paths: list[str], repo_root: Path) -> Totals:
    if not paths:
        return Totals()

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        handle.write("\n".join(paths))
        list_file = handle.name

    try:
        result = subprocess.run(
            ["cloc", "--quiet", "--csv", f"--list-file={list_file}"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        Path(list_file).unlink(missing_ok=True)

    for record in csv.reader(io.StringIO(result.stdout)):
        # cloc CSV columns: files, language, blank, comment, code
        if len(record) >= 5 and record[1].strip() == "SUM":
            return Totals(
                files=int(record[0]),
                blank=int(record[2]),
                comment=int(record[3]),
                code=int(record[4]),
            )
    return Totals()


def _subdirs(files: list[str], prefix: str) -> list[str]:
    """Immediate child directory names under prefix that contain matched files."""
    names: set[str] = set()
    root = prefix.rstrip("/") + "/"
    for f in files:
        if not f.startswith(root):
            continue
        remainder = f[len(root) :]
        if "/" in remainder:
            names.add(remainder.split("/", 1)[0])
    return sorted(names)


def _discover_buckets(files: list[str]) -> list[Bucket]:
    """The full logical grouping of the repository, across every subsystem."""
    b: list[Bucket] = []

    # --- embedded firmware --------------------------------------------------
    b.append(
        Bucket(
            "embedded/protocol — transport core (C/C++)", "logic", rf"^embedded/protocol/.*{_C_EXT}"
        )
    )
    b.append(
        Bucket(
            "embedded/esp32/platform — services (C)",
            "logic",
            rf"^embedded/esp32/platform/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket("embedded/esp32/transports (C)", "logic", rf"^embedded/esp32/transports/.*{_C_EXT}")
    )
    b.append(
        Bucket(
            "embedded/esp32 firmware — main/apps/features (C)",
            "logic",
            rf"^embedded/esp32/core/(main|apps|features)/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket(
            "embedded/esp32 — generated contracts (C)",
            "generated",
            rf"^embedded/esp32/core/generated/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket(
            "embedded/esp32/flashdb — vendored KVDB (C)",
            "vendored",
            rf"^embedded/esp32/flashdb/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket(
            "embedded/arduino — firmware sketches (C/C++)",
            "logic",
            rf"^embedded/arduino/(helix_node|helix_serial_echo|qemu_helix_core"
            rf"|qemu_smoke|qemu_timer|qemu_freertos)/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket(
            "embedded/arduino — FreeRTOS vendored/patched (C)",
            "vendored",
            rf"^embedded/arduino/libraries/FreeRTOS/.*{_C_EXT}",
        )
    )
    b.append(
        Bucket(
            "embedded/arduino — HelixEspCompat shim + vendored cJSON (C)",
            "vendored",
            rf"^embedded/arduino/libraries/HelixEspCompat/.*{_C_EXT}",
        )
    )
    b.append(Bucket("embedded — build/flashing CLIs (py)", "logic", r"^embedded/.*\.py$"))
    b.append(Bucket("embedded — build glue (sh)", "build", r"^embedded/.*\.sh$"))

    # --- linux device runtime ----------------------------------------------
    b.append(
        Bucket(
            "linux/device/go — helixd core, SDK & apps (Go)",
            "logic",
            r"^linux/device/go/.*\.go$",
            (r"/generated/", r"_test\.go$"),
        )
    )
    b.append(
        Bucket(
            "linux/device/go — generated contracts (Go)",
            "generated",
            r"^linux/device/go/internal/[^/]+/generated/.*\.go$",
        )
    )
    b.append(Bucket("linux/device/go — tests (Go)", "test", r"^linux/device/go/.*_test\.go$"))
    b.append(
        Bucket(
            "linux/device/python — service runtime SDK & apps (py)",
            "logic",
            r"^linux/device/python/.*\.py$",
        )
    )
    b.append(
        Bucket(
            "linux/device — packages / systemd / docker (build)",
            "build",
            r"^linux/device/(packages|systemd|docker)/.*",
            (r"\.md$",),
        )
    )
    b.append(
        Bucket(
            "linux/platform_os — OS image build (shell/py)",
            "build",
            r"^linux/platform_os/.*",
            (r"\.md$",),
        )
    )

    # --- common device UI ---------------------------------------------------
    b.append(Bucket("ui — common device UI, LVGL (C)", "logic", rf"^ui/.*{_C_EXT}"))

    # --- web (apps + packages) ---------------------------------------------
    b.append(
        Bucket(
            "web/apps/helix — app logic (ts/tsx)",
            "logic",
            r"^web/apps/helix/.*\.(ts|tsx)$",
            (r"^web/apps/helix/src/generated/",),
        )
    )
    b.append(
        Bucket(
            "web/apps/helix — generated contracts (ts)",
            "generated",
            r"^web/apps/helix/src/generated/.*\.ts$",
        )
    )
    b.append(
        Bucket(
            "web/apps/helix-server — headless backend (ts)",
            "logic",
            r"^web/apps/helix-server/.*\.(ts|tsx)$",
        )
    )
    b.append(
        Bucket("web/apps/helix — content (*.mdx)", "docs", r"^web/apps/helix/content/.*\.mdx$")
    )
    for pkg in _subdirs(files, "web/packages/core"):
        b.append(
            Bucket(
                f"web/packages/core/{pkg} (ts/tsx)",
                "logic",
                rf"^web/packages/core/{re.escape(pkg)}/.*\.(ts|tsx)$",
            )
        )
    for pkg in _subdirs(files, "web/packages/protocol"):
        b.append(
            Bucket(
                f"web/packages/protocol/{pkg} (ts/tsx)",
                "logic",
                rf"^web/packages/protocol/{re.escape(pkg)}/.*\.(ts|tsx)$",
            )
        )
    b.append(
        Bucket(
            "web/e2e — hardware-in-the-loop tests (ts)",
            "test",
            r"^web/e2e/(tests|serial)/.*\.(ts|tsx)$",
        )
    )
    b.append(
        Bucket(
            "web/e2e — harness (ts)",
            "test",
            r"^web/e2e/.*\.(ts|tsx)$",
            (r"^web/e2e/(tests|serial)/",),
        )
    )
    b.append(
        Bucket(
            "web — tooling scripts & build config (js/ts/mjs)",
            "build",
            r"^web/(scripts/.*\.(ts|cjs)$|apps/[^/]+/scripts/.*\.mjs$"
            r"|packages/core/eslint-config/.*\.js$|.*\.(mjs|cjs)$|knip\.config\.ts$)",
        )
    )

    # --- android ------------------------------------------------------------
    b.append(
        Bucket("android — :helix SDK (Kotlin)", "logic", rf"^android/helix/src/main/.*{_KT_EXT}")
    )
    b.append(
        Bucket("android — :app Compose UI (Kotlin)", "logic", rf"^android/app/src/main/.*{_KT_EXT}")
    )
    b.append(
        Bucket(
            "android — unit/instrumented tests (Kotlin)",
            "test",
            rf"^android/(helix|app)/src/(test|androidTest)/.*{_KT_EXT}",
        )
    )
    b.append(Bucket("android — Gradle build (kts)", "build", r"^android/.*\.gradle\.kts$"))

    # --- cloud --------------------------------------------------------------
    b.append(
        Bucket(
            "cloud/build-service — firmware builder (py)", "logic", r"^cloud/build-service/.*\.py$"
        )
    )
    b.append(
        Bucket(
            "cloud — appliance / AMI / infra (build & config)",
            "build",
            r"^cloud/.*",
            (r"^cloud/build-service/.*\.py$", r"\.md$"),
        )
    )

    # --- python tooling & tests --------------------------------------------
    b.append(Bucket("tooling — the `helix` CLI (py)", "logic", r"^tooling/.*\.py$"))
    b.append(Bucket("tooling — shell helpers", "build", r"^tooling/.*\.sh$"))
    b.append(Bucket("scripts — repo scripts", "build", r"^scripts/.*", (r"\.md$",)))
    b.append(Bucket("tests/e2e — appliance & browser suite (py)", "test", r"^tests/.*\.py$"))

    # --- docs & project config ---------------------------------------------
    b.append(Bucket("docs/ — design & research (md)", "docs", r"^docs/.*\.md$"))
    b.append(Bucket("top-level docs (README, licensing, …)", "docs", r"^[^/]+\.(md|mdx)$"))
    b.append(Bucket("root — build & project config", "build", r"^[^/]+\.(toml|cfg|ini|in)$"))

    # --- experimental / labs (one row per lab) -----------------------------
    for lab in _subdirs(files, "experimental"):
        b.append(
            Bucket(
                f"experimental/{lab}",
                "experimental",
                rf"^experimental/{re.escape(lab)}/.*{_CODE_EXT}",
            )
        )

    return b


_SUMMARY_ORDER = (
    "logic",
    "test",
    "generated",
    "vendored",
    "docs",
    "build",
    "experimental",
    "other",
)
_SUMMARY_LABELS = {
    "logic": "logic code",
    "test": "test code",
    "generated": "generated code",
    "vendored": "vendored / third-party",
    "docs": "docs & prose",
    "build": "build & config",
    "experimental": "experimental / labs",
    "other": "other / unbucketed",
}


def build_report(repo_root: Path) -> tuple[list[Row], list[Row], Totals]:
    """Return (per-bucket rows grouped-ready, category-summary rows, grand total)."""
    files = _list_repo_files(repo_root)
    buckets = _discover_buckets(files)

    rows: list[Row] = []
    summary: dict[str, Totals] = {cat: Totals() for cat in _SUMMARY_ORDER}
    matched: set[str] = set()

    for bucket in buckets:
        paths = _match(files, bucket)
        matched.update(paths)
        totals = _cloc_totals(paths, repo_root)
        summary.setdefault(bucket.category, Totals()).add(totals)
        if totals.files == 0:
            continue
        rows.append(Row(bucket.label, bucket.category, totals))

    # Surface any source file no bucket claimed, so nothing counts silently to zero.
    code_re = re.compile(_CODE_EXT)
    leftover = [f for f in files if code_re.search(f) and f not in matched]
    other = _cloc_totals(leftover, repo_root)
    if other.files:
        summary.setdefault("other", Totals()).add(other)
        rows.append(Row("unbucketed source", "other", other))

    summary_rows = [
        Row(_SUMMARY_LABELS.get(cat, cat), cat, summary[cat])
        for cat in _SUMMARY_ORDER
        if summary.get(cat) and summary[cat].files
    ]
    grand = Totals()
    for row in summary_rows:
        grand.add(row.totals)
    return rows, summary_rows, grand


def _rows_by_category(rows: list[Row]) -> list[tuple[str, list[Row]]]:
    order = {cat: i for i, cat in enumerate(_SUMMARY_ORDER)}
    groups: dict[str, list[Row]] = {}
    for row in rows:
        groups.setdefault(row.category, []).append(row)
    return [(cat, groups[cat]) for cat in sorted(groups, key=lambda c: order.get(c, len(order)))]


def render_console(rows: list[Row], summary_rows: list[Row], grand: Totals) -> str:
    lines: list[str] = []
    header = f"{'Bucket':<52} {'Files':>6} {'Blank':>7} {'Comment':>8} {'Code':>8}"
    divider = f"{'-' * 52} {'-' * 6} {'-' * 7} {'-' * 8} {'-' * 8}"

    def emit(label: str, totals: Totals) -> None:
        t = totals
        lines.append(f"{label:<52} {t.files:>6} {t.blank:>7} {t.comment:>8} {t.code:>8}")

    for cat, group in _rows_by_category(rows):
        lines.append("")
        lines.append(_SUMMARY_LABELS.get(cat, cat).upper())
        lines.append(header)
        lines.append(divider)
        for row in group:
            emit(row.label, row.totals)

    lines.append("")
    lines.append("SUMMARY")
    lines.append(header)
    lines.append(divider)
    for row in summary_rows:
        emit(row.label, row.totals)
    lines.append(divider)
    emit("TOTAL", grand)
    return "\n".join(lines)


def render_markdown(rows: list[Row], summary_rows: list[Row], grand: Totals) -> str:
    out: list[str] = [
        "# cloc breakdown (full repo)",
        "",
        "Generated by `helix reports cloc`. Counts tracked + untracked-but-not-ignored",
        "source, grouped by subsystem and category. Build output, vendored caches, and",
        "generated bindings are excluded or bucketed separately.",
        "",
    ]

    def table(rs: list[Row], subtotal: str | None = None) -> None:
        out.append("| Bucket | Files | Blank | Comment | Code |")
        out.append("| --- | ---: | ---: | ---: | ---: |")
        sub = Totals()
        for row in rs:
            t = row.totals
            sub.add(t)
            out.append(f"| {row.label} | {t.files} | {t.blank} | {t.comment} | {t.code} |")
        if subtotal:
            out.append(
                f"| **{subtotal}** | **{sub.files}** | **{sub.blank}** | "
                f"**{sub.comment}** | **{sub.code}** |"
            )
        out.append("")

    for cat, group in _rows_by_category(rows):
        out.append(f"## {_SUMMARY_LABELS.get(cat, cat)}")
        out.append("")
        table(group, subtotal="subtotal")

    out.append("## Summary by category")
    out.append("")
    table(summary_rows)
    out.append(
        f"**Total — {grand.files} files, {grand.code} lines of code "
        f"({grand.comment} comment, {grand.blank} blank).**"
    )
    out.append("")
    return "\n".join(out)


def generate(output: Path) -> str:
    """Compute the report, write markdown to `output`, return the console table."""
    if shutil.which("cloc") is None:
        raise RuntimeError("cloc not found in PATH")

    rows, summary_rows, grand = build_report(REPO_ROOT)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render_markdown(rows, summary_rows, grand), encoding="utf-8")
    return render_console(rows, summary_rows, grand)
