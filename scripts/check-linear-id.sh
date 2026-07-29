#!/usr/bin/env bash
set -euo pipefail

# Require a Linear tracking id (HELIX-<number>) so every change maps to a tracked
# issue. Checks the PR title (which is what lands on a squash-merge) and every
# non-merge / non-autosquash commit in the range (which is what lands on a
# merge/rebase) — so the id survives whatever merge method is used.
#
# Relaxing: if you only ever squash-merge, you can drop the commit loop; if you
# only ever merge/rebase, you can drop the PR-title block.

id_re='\bHELIX-[0-9]+\b'

base_ref="${1:-${LINEAR_BASE_REF:-}}"
head_ref="${2:-${LINEAR_HEAD_REF:-HEAD}}"
pr_title="${LINEAR_PR_TITLE:-}"

# A new branch / initial push reports an all-zero base — treat as "no range".
if [[ "${base_ref}" =~ ^0+$ ]]; then
  base_ref=""
fi

failed=0

if [[ -n "${pr_title}" ]]; then
  if ! grep -Eq "${id_re}" <<<"${pr_title}"; then
    printf 'PR title is missing a Linear tracking id (expected HELIX-<number>)\n' >&2
    printf '  title: %s\n' "${pr_title}" >&2
    failed=1
  fi
fi

if [[ -z "${base_ref}" ]]; then
  printf 'Linear id: commit-range check skipped (no base revision supplied)\n'
else
  while IFS= read -r commit; do
    subject="$(git show -s --format=%s "${commit}")"
    case "${subject}" in
      fixup!* | squash!* | amend!*) continue ;;
    esac
    if ! git show -s --format=%B "${commit}" | grep -Eq "${id_re}"; then
      printf '%s: %s\n' "${commit:0:12}" "${subject}" >&2
      printf '  -> missing Linear tracking id (expected HELIX-<number>)\n' >&2
      failed=1
    fi
  done < <(git rev-list --no-merges "${base_ref}..${head_ref}")
fi

if [[ "${failed}" -ne 0 ]]; then
  printf '\nEvery commit (and the PR title) must reference its Linear issue — e.g.\n' >&2
  printf '"HELIX-123: ..." or a "Refs: HELIX-123" trailer. See the linear-tracking skill.\n' >&2
fi

exit "${failed}"
