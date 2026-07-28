#!/usr/bin/env bash
# Unpack app zip bundles into the live app tree; atomic swap = repoint the `current`
# symlink (last 3 versions kept for rollback).
# Usage: install-bundles.sh [/path/to/<name>-<ver>.zip]  (no arg = every staged bundle)
set -euo pipefail

APPS_DIR=/opt/helix/apps
STAGE_DIR=/opt/helix/bundles
STATE_DIR=/var/lib/helix/state
STATE_FILE="${STATE_DIR}/release.json"
BASE_VERSION_FILE=/opt/helix/BASE_IMAGE_VERSION
KEEP=3

# Per-app installed versions as "name<TAB>version" lines, flushed to release.json at the end.
INSTALLED=()

install_one() {
  local zip="$1"
  local base; base="$(basename "${zip}" .zip)"      # <name>-<version>
  local name="${base%-*}"
  local version="${base##*-}"
  local dest="${APPS_DIR}/${name}/${version}"

  if [[ -d "${dest}" && -f "${dest}/.installed" ]]; then
    echo "install-bundles: ${name} ${version} already installed"
  else
    echo "install-bundles: unpacking ${name} ${version}"
    rm -rf "${dest}"; mkdir -p "${dest}"
    unzip -q "${zip}" -d "${dest}"
    touch "${dest}/.installed"
  fi

  ln -sfn "${dest}" "${APPS_DIR}/${name}/current"
  INSTALLED+=("${name}	${version}")

  # Prune all but the newest KEEP versions (current is always preserved).
  ( cd "${APPS_DIR}/${name}" && ls -1dt */ 2>/dev/null | sed 's:/$::' \
      | grep -v '^current$' | tail -n "+$((KEEP+1))" \
      | while read -r old; do
          [[ "$(readlink -f current)" == "$(readlink -f "${old}")" ]] && continue
          echo "install-bundles: pruning ${name} ${old}"; rm -rf "${old}"
        done ) || true
}

mkdir -p "${APPS_DIR}"

if [[ $# -ge 1 ]]; then
  install_one "$1"
else
  shopt -s nullglob
  for zip in "${STAGE_DIR}"/*.zip; do
    install_one "${zip}"
  done
fi

# release.json is the source of truth the cloud app reads for "what is running".
write_state() {
  [[ ${#INSTALLED[@]} -gt 0 ]] || return 0
  mkdir -p "${STATE_DIR}"
  local base_version; base_version="$(cat "${BASE_VERSION_FILE}" 2>/dev/null || echo 0)"
  # Release version = the cloud-app bundle's version, else any installed bundle's.
  local release_version=""
  for line in "${INSTALLED[@]}"; do
    local n="${line%%	*}" v="${line##*	}"
    [[ "${n}" == "helix-cloud-app" ]] && release_version="${v}"
  done
  [[ -n "${release_version}" ]] || release_version="${INSTALLED[0]##*	}"

  STATE_FILE="${STATE_FILE}" BASE_VERSION="${base_version}" \
  RELEASE_VERSION="${release_version}" INSTALLED_AT="$(date -u +%FT%TZ)" \
  INSTALLED_LINES="$(printf '%s\n' "${INSTALLED[@]}")" \
  python3 - <<'PY'
import json, os, pathlib
state_file = pathlib.Path(os.environ["STATE_FILE"])
prev = {}
if state_file.exists():
    try:
        prev = json.loads(state_file.read_text())
    except Exception:
        prev = {}
apps = dict(prev.get("apps") or {})
for line in os.environ["INSTALLED_LINES"].splitlines():
    if not line.strip():
        continue
    name, _, version = line.partition("\t")
    apps[name] = version
state = {
    "installedVersion": os.environ["RELEASE_VERSION"],
    "installedAt": os.environ["INSTALLED_AT"],
    "baseImageVersionAtInstall": int(os.environ["BASE_VERSION"] or 0),
    "apps": apps,
}
state_file.write_text(json.dumps(state, indent=2) + "\n")
print(f"install-bundles: wrote {state_file} (release {state['installedVersion']}, base {state['baseImageVersionAtInstall']})")
PY
}
write_state

echo "install-bundles: done"
