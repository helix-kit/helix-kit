#!/usr/bin/env bash
set -euo pipefail

# Require a Linear tracking id (HELIX-<number>) in the pull-request title.
#
# This is the EXTERNAL-CONTRIBUTOR gate, and the ONLY server-side one. The owner
# pushes directly to `main`, where nothing server-side checks the message — GitHub's
# `commit_message_pattern` ruleset rule is inert on a free-plan org, so that path
# relies on the local `.githooks/commit-msg` hook alone.
#
# The repo squash-merges, so the PR title becomes the single commit subject that
# lands on `main` — checking the title is enough, and intermediate WIP commits do
# not need the id. A plain push has no PR title and nothing to check here.

id_re='\bHELIX-[0-9]+\b'
pr_title="${LINEAR_PR_TITLE:-}"

if [[ -z "${pr_title}" ]]; then
  printf 'Linear id: no PR title in context — nothing to check.\n'
  exit 0
fi

if grep -Eq "${id_re}" <<<"${pr_title}"; then
  exit 0
fi

printf 'PR title is missing a Linear tracking id (expected HELIX-<number>).\n' >&2
printf '  title: %s\n' "${pr_title}" >&2
printf '\nPut the issue id in the PR title, e.g. "HELIX-123: ...". The repo squash-merges,\n' >&2
printf 'so the PR title becomes the commit on main. See the linear-tracking skill.\n' >&2
exit 1
