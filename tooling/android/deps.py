# SPDX-License-Identifier: AGPL-3.0-only
"""Version-catalog update checker for the Android SDK/app."""

from __future__ import annotations

import re
import tomllib
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from tooling.common.paths import REPO_ROOT

ANDROID_ROOT = REPO_ROOT / "android"
VERSION_CATALOG = ANDROID_ROOT / "gradle" / "libs.versions.toml"

GOOGLE_MAVEN = "https://dl.google.com/dl/android/maven2"
MAVEN_CENTRAL = "https://repo1.maven.org/maven2"
PLUGIN_PORTAL = "https://plugins.gradle.org/m2"

# Stable = purely numeric dotted; any qualifier (alpha/beta/rc/eap/dev/snapshot) is a prerelease.
_STABLE_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")

_GOOGLE_GROUPS = ("androidx", "com.android", "com.google")


@dataclass(frozen=True)
class Coordinate:
    """A single Maven artifact backing a version-catalog key."""

    display: str
    kind: str  # "library" | "plugin"
    urls: tuple[str, ...]


@dataclass
class DepUpdate:
    key: str
    coordinate: str
    kind: str
    current: str
    latest: str | None = None
    error: str | None = None

    @property
    def outdated(self) -> bool:
        return self.latest is not None and self.latest != self.current


@dataclass
class _Metadata:
    versions: list[str] = field(default_factory=list)
    latest: str | None = None
    release: str | None = None


def _group_path(group: str) -> str:
    return group.replace(".", "/")


def _library_urls(group: str, name: str) -> tuple[str, ...]:
    tail = f"{_group_path(group)}/{name}/maven-metadata.xml"
    repos = (
        (GOOGLE_MAVEN, MAVEN_CENTRAL)
        if group.startswith(_GOOGLE_GROUPS)
        else (MAVEN_CENTRAL, GOOGLE_MAVEN)
    )
    return tuple(f"{repo}/{tail}" for repo in repos)


def _plugin_urls(plugin_id: str) -> tuple[str, ...]:
    # Gradle resolves a plugin id to its marker artifact <id>:<id>.gradle.plugin.
    tail = f"{_group_path(plugin_id)}/{plugin_id}.gradle.plugin/maven-metadata.xml"
    repos = (
        (GOOGLE_MAVEN, PLUGIN_PORTAL, MAVEN_CENTRAL)
        if plugin_id.startswith(_GOOGLE_GROUPS)
        else (PLUGIN_PORTAL, MAVEN_CENTRAL, GOOGLE_MAVEN)
    )
    return tuple(f"{repo}/{tail}" for repo in repos)


def _fetch_metadata(url: str, *, timeout: float) -> _Metadata | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            payload = resp.read()
    except OSError:  # URLError, TimeoutError and ConnectionError all derive from it
        return None
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return None
    versioning = root.find("./versioning")
    if versioning is None:
        return None
    versions = [e.text for e in versioning.iterfind("./versions/version") if e.text]
    latest = versioning.findtext("./latest")
    release = versioning.findtext("./release")
    return _Metadata(versions=versions, latest=latest, release=release)


def _numeric_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def _pick_latest(meta: _Metadata, *, include_prerelease: bool) -> str | None:
    if include_prerelease:
        return meta.latest or meta.release or (meta.versions[-1] if meta.versions else None)
    stable = [v for v in meta.versions if _STABLE_RE.match(v)]
    if stable:
        return max(stable, key=_numeric_key)
    # No stable release published yet — fall back so the row is still informative.
    return meta.release or meta.latest


def _resolve(
    coord: Coordinate, *, include_prerelease: bool, timeout: float
) -> tuple[str | None, str | None]:
    """Return (latest, error) for the first repository that answers."""
    for url in coord.urls:
        meta = _fetch_metadata(url, timeout=timeout)
        if meta is not None:
            latest = _pick_latest(meta, include_prerelease=include_prerelease)
            if latest is not None:
                return latest, None
    return None, "not found in Google Maven / Maven Central / Plugin Portal"


def load_catalog() -> tuple[dict[str, str], dict[str, list[Coordinate]]]:
    """Parse the version catalog into (versions, key -> coordinates referencing it)."""
    data = tomllib.loads(VERSION_CATALOG.read_text())
    versions: dict[str, str] = data.get("versions", {})
    coords: dict[str, list[Coordinate]] = {key: [] for key in versions}

    for entry in data.get("libraries", {}).values():
        ref = _version_ref(entry)
        if ref is None or ref not in coords:
            continue
        group, name = entry.get("group"), entry.get("name")
        if not group or not name:
            continue
        coords[ref].append(
            Coordinate(display=f"{group}:{name}", kind="library", urls=_library_urls(group, name))
        )

    for entry in data.get("plugins", {}).values():
        ref = _version_ref(entry)
        plugin_id = entry.get("id")
        if ref is None or plugin_id is None or ref not in coords:
            continue
        coords[ref].append(
            Coordinate(display=plugin_id, kind="plugin", urls=_plugin_urls(plugin_id))
        )

    return versions, coords


def _version_ref(entry: dict[str, object]) -> str | None:
    version = entry.get("version")
    if isinstance(version, dict):
        ref = version.get("ref")
        return ref if isinstance(ref, str) else None
    return None


def check_updates(*, include_prerelease: bool = False, timeout: float = 15.0) -> list[DepUpdate]:
    """Resolve the newest available version for every referenced catalog key."""
    versions, coords = load_catalog()

    def resolve_key(key: str) -> DepUpdate:
        current = versions[key]
        candidates = coords.get(key, [])
        if not candidates:
            return DepUpdate(key, "(unreferenced)", "library", current, error="not referenced")
        rep = candidates[0]
        latest, error = _resolve(rep, include_prerelease=include_prerelease, timeout=timeout)
        return DepUpdate(key, rep.display, rep.kind, current, latest=latest, error=error)

    referenced = [key for key, cs in coords.items() if cs]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(resolve_key, referenced))

    results.sort(key=lambda r: (not r.outdated, r.kind, r.key))
    return results


def apply_updates(updates: list[DepUpdate]) -> list[DepUpdate]:
    """Rewrite the catalog's [versions] block to the resolved latest versions; return those written."""
    changes = {u.key: u.latest for u in updates if u.outdated and u.latest}
    if not changes:
        return []

    lines = VERSION_CATALOG.read_text().splitlines(keepends=True)
    section: str | None = None
    written: list[DepUpdate] = []
    by_key = {u.key: u for u in updates}

    for i, line in enumerate(lines):
        header = re.match(r"\s*\[([^\]]+)\]", line)
        if header:
            section = header.group(1)
            continue
        if section != "versions":
            continue
        m = re.match(r'(\s*)([A-Za-z0-9_-]+)(\s*=\s*")([^"]*)(".*)$', line)
        if m and m.group(2) in changes:
            key = m.group(2)
            lines[i] = f"{m.group(1)}{key}{m.group(3)}{changes[key]}{m.group(5)}"
            if not lines[i].endswith("\n"):
                lines[i] += "\n"
            written.append(by_key[key])

    VERSION_CATALOG.write_text("".join(lines))
    return written
