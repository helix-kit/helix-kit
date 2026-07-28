#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:-${DCO_BASE_REF:-}}"
head_ref="${2:-${DCO_HEAD_REF:-HEAD}}"

if [[ -z "${base_ref}" ]]; then
  printf 'DCO check skipped: no base revision supplied\n'
  exit 0
fi

failed=0
while IFS= read -r commit; do
  if ! git show -s --format=%B "${commit}" | grep -Eq '^Signed-off-by: .+ <[^>]+>$'; then
    printf '%s: missing valid Signed-off-by trailer\n' "${commit}" >&2
    failed=1
  fi
done < <(git rev-list "${base_ref}..${head_ref}")

exit "${failed}"
