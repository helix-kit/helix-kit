#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

required_files=(
  LICENSE
  LICENSES/AGPL-3.0-only.txt
  LICENSES/CC-BY-SA-4.0.txt
  LICENSING.md
  NOTICE
  CONTRIBUTING.md
  DCO
  TRADEMARKS.md
)

for path in "${required_files[@]}"; do
  if [[ ! -s "${path}" ]]; then
    printf 'missing required licensing file: %s\n' "${path}" >&2
    exit 1
  fi
done

if ! cmp -s LICENSE LICENSES/AGPL-3.0-only.txt; then
  printf 'LICENSE and LICENSES/AGPL-3.0-only.txt must match\n' >&2
  exit 1
fi

while IFS= read -r path; do
  if ! cmp -s LICENSE "${path}"; then
    printf '%s: package license does not match root AGPL text\n' "${path}" >&2
    exit 1
  fi
done < <(
  find embedded/protocol embedded/esp32/transports embedded/esp32/platform web/packages/core -type f -name LICENSE \
    -not -path '*/node_modules/*' \
    -not -path '*/.next/*'
)

mapfile -d '' package_files < <(
  find . -type f -name package.json \
    -not -path '*/node_modules/*' \
    -not -path '*/.next/*' \
    -not -path '*/dist/*' \
    -not -path '*/.stage/*' \
    -not -path '*/.venv/*' \
    -print0
)

for path in "${package_files[@]}"; do
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    if (manifest.license !== "AGPL-3.0-only") {
      console.error(`${path}: expected license AGPL-3.0-only`);
      process.exit(1);
    }
  ' "${path}"
done

mapfile -d '' python_projects < <(
  find . -type f -name pyproject.toml \
    -not -path '*/.venv/*' \
    -not -path '*/.build/*' \
    -not -path '*/out/*' \
    -print0
)

for path in "${python_projects[@]}"; do
  if ! grep -Eq '^license = "AGPL-3\.0-only"$' "${path}"; then
    printf '%s: expected project license AGPL-3.0-only\n' "${path}" >&2
    exit 1
  fi
done

for path in embedded/protocol/idf_component.yml embedded/esp32/transports/idf_component.yml embedded/esp32/platform/idf_component.yml; do
  if ! grep -Eq '^license: "AGPL-3\.0-only"$' "${path}"; then
    printf '%s: ESP-IDF component license must be AGPL-3.0-only\n' "${path}" >&2
    exit 1
  fi
done

if rg -n '"license"[[:space:]]*:[[:space:]]*"(PROPRIETARY|Apache-2\.0)"|^license[[:space:]]*=[[:space:]]*"(PROPRIETARY|Apache-2\.0)"|^license:[[:space:]]*"(PROPRIETARY|Apache-2\.0)"' \
  --glob '!**/node_modules/**' --glob '!**/.next/**' --glob '!**/.build/**' --glob '!**/out/**' \
  --glob '!**/package-lock.json' --glob '!**/pnpm-lock.yaml' --glob '!**/*.lock'; then
  printf 'conflicting first-party license declaration found\n' >&2
  exit 1
fi

while IFS= read -r path; do
  if ! grep -q 'SPDX-License-Identifier: CC-BY-SA-4.0' "${path}"; then
    printf '%s: missing CC-BY-SA-4.0 SPDX marker\n' "${path}" >&2
    exit 1
  fi
done < <(find docs -maxdepth 1 -type f -name '*.md' -print)

printf 'license policy checks passed\n'
