<!--
SPDX-FileCopyrightText: 2026 Hardik Jain
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Git hooks

Version-controlled git hooks for Helix. Activate them once per clone:

```sh
git config core.hooksPath .githooks
```

(This repo's clone on the original machine is already configured.)

## Hooks

- **`commit-msg`** — requires every commit message to reference its Linear
  tracking issue as `HELIX-<number>` (e.g. `HELIX-123: fix …` or a `Refs: HELIX-123`
  trailer). Merge and autosquash (`fixup!`/`squash!`/`amend!`) commits are exempt.
  See the `linear-tracking` skill (`.claude/skills/linear-tracking/`).

  Since work goes straight onto `main`, **this hook is the only thing enforcing the
  id on that path** — activate it in every clone. GitHub cannot back it up: its
  `commit_message_pattern` ruleset rule is silently inert on a free-plan org (the
  API accepts it and reports it active, but it never evaluates), and pre-receive
  hooks don't exist outside Enterprise Server. Contributor PRs are separately gated
  by the `linear-id` required check on the PR title.
- **`pre-commit`** — delegates to the user's global `pre-commit` (via the global
  `core.hooksPath`) so machine-wide checks still run, since setting a repo-local
  `core.hooksPath` otherwise bypasses the global hooks dir.
