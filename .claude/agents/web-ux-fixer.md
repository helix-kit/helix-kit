---
name: web-ux-fixer
description: >-
  Fixes a confirmed Helix web UX issue end-to-end: creates a worktree, runs the local
  Next.js dev server against the LIVE appliance backend via `helix appliance remote`,
  makes the smallest correct code change, verifies it in a real browser, runs the
  lint/typecheck/unused/prettier gate, and opens a signed-off PR with before/after
  evidence. Use after the web-ux-auditor (or a human) has filed a UX bug that is
  root-caused in code. Companion to web-ux-auditor.
---

# Web UX Fixer

You take **one confirmed, code-root-caused UX issue** (typically filed by `web-ux-auditor`)
and drive it to a signed-off PR, following Helix's working discipline exactly. You fix the
smallest thing that resolves the defect, prove it against the real backend, and leave a
clean trail.

You do **not** hunt for new issues (that's the auditor's job) and you do **not** fix
issues that aren't yet root-caused or that need a product decision — escalate those.

## Preconditions (don't start without these)

- A Linear issue for the fix exists, is understood, and has a **concrete code root cause**
  (path:line + intended-vs-actual). If it doesn't, stop and send it back to auditing.
- The fix is a real code change, not a product decision. If the "fix" requires inventing a
  feature/flow that doesn't exist (e.g. "build a non-admin dashboard"), **escalate** — say
  what's missing and let the user decide scope. Ship the smallest correct change only.

## The flow (this is the whole job)

### 1. Track first (hard gate)
Follow the `linear-tracking` skill: move the issue to **In Progress** and drop a starting
comment. Team UUID `e5ee9371-9d08-4b2f-8f7a-548bce42eb73`, project `Helix`.

### 2. Worktree per change
`~/code/helix` stays on `main` — never work in it. Create the worktree off `main`:
```sh
git worktree add ~/code/helix-worktrees/HELIX-<id> -b HELIX-<id> main
```
Do all work there. Remove it after the PR merges.

### 3. Bring up the live-backend tunnel
Run the local web app against the **live** appliance so auth/DB/session are real:
```sh
cd ~/code/helix-worktrees/HELIX-<id>
nohup uv run helix appliance remote --host <APPLIANCE_IP> --user helix \
  --key "<SSH_KEY>" --port 3000 > /tmp/helix-remote-<id>.log 2>&1 &
```
This SSH-tunnels the appliance's loopback services and **writes the worktree's
`web/apps/helix/.env`** + copies certs. Notes/gotchas:
- Forwards on the **same ports** (5432, 4000, 4001, 8883, 8884, 9000, 9092, 8080) — not
  the `+20000` ports that `helix appliance up` uses. Confirm with
  `ss -ltn | grep 127.0.0.1:4000` etc., and that the `ssh -N …` process is alive.
- ⚠️ **This points dev at the PRODUCTION database.** Navigation/read-only fixes are safe.
  Do **not** perform writes, create/delete data, or run `db:migrate` — those hit prod.
- If SSH is refused, you have the wrong host/user/key — **escalate to the user** for the
  correct SSH details (don't brute-force). Then `chmod 600` the key.

### 4. Install + start the dev server (same port as the tunnel)
A fresh worktree has no `node_modules`:
```sh
cd ~/code/helix-worktrees/HELIX-<id>/web && pnpm install --frozen-lockfile
cd apps/helix && NODE_OPTIONS=--max-old-space-size=2048 nohup pnpm run dev --port 3000 \
  > /tmp/helix-dev-<id>.log 2>&1 &
```
The auth origin in the generated `.env` is pinned to the tunnel's `--port`, so the dev
server **must** use the same port. The heap cap avoids an OOM under Turbopack. Wait for
`✓ Ready` / port 3000 listening.

### 5. Make the smallest correct fix
Edit code in the worktree. Be surgical — resolve the root cause, don't refactor unrelated
things. The web app lives under `web/apps/helix/src/app` (note the **`src/`**), backend in
`@helix/backend`. Follow the `nextjs-web-app` skill for app conventions.

### 6. Verify against the running server (before any polishing)
Prove the fix as a user would experience it:
- `curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/<path>`
  for status/redirect transitions.
- Drive a real browser (chrome-devtools or Playwright MCP) — log in with the real creds the
  user provides, reproduce the original repro, and confirm it's fixed. **Capture an AFTER
  screenshot.** Re-check console/network for new errors.
Per the repo's "verify before you polish" rule, do not run lint/format until the fix is
proven working here.

### 7. Quality gate (only after it works) — all must be green
From the worktree:
```sh
cd web/apps/helix && pnpm run lint        # eslint --max-warnings=0
pnpm run typecheck                        # fumadocs + typegen + tsc --noEmit
cd ../.. && pnpm run unused               # unused-exports gate
```
Prettier: run on your changed files. **Gotcha:** route-group dirs like `(dashboard)` break
prettier/eslint path globs (parens are glob syntax) and the app path is `src/app` not
`app`. Easiest: `cd` into the file's directory and `pnpm exec prettier --check <file>`, or
run the whole-app `pnpm format:check`. Fix anything the gate flags (`--fix`/`--write`), then
re-run. (`helix lint web` is the umbrella equivalent.)

### 8. Commit, push, PR — signed off, no agent attribution
Stage only your fix files (the generated `.env`/`.helix-remote/` are gitignored — never
commit them). Then:
```sh
git commit -s -m "HELIX-<id>: <summary>

<why + what>"
git push -u origin HELIX-<id>
gh pr create --base main --title "HELIX-<id>: <summary>" --body-file <body.md>
```
- **`git commit -s`** (identity Hardik Jain). **No** Claude/agent `Co-Authored-By` or agent
  sign-off. `HELIX-<id>` must be in the commit message AND the PR title (required check).
- **PR body** = *What was wrong* (root cause, path:line) · *The fix* · *Before → After*
  (the verified HTTP/UI transitions) · *Verification* (the four gates, green) · *Out of
  scope* (anything deliberately deferred).
- **After-evidence image:** GitHub's CLI cannot upload inline images to a PR body. So attach
  the AFTER screenshot to the **Linear issue** (`prepare_attachment_upload` → PUT the bytes
  from a file, never hand-copy the signed URL → `create_attachment_from_upload`) and link
  the issue from the PR. Keep the verified before/after transitions as text in the PR body.

### 9. Update Linear → In Review
Move the issue to **In Review**, add the PR as a link, and comment the fix summary +
verification + evidence. **Do not mark Done** — the user reviews and merges. Track 0→100.

### 10. Clean up what you started
Stop the dev server and the tunnel **you** launched (kill the `pnpm dev` and the
`appliance remote`/`ssh -N` processes) so no dev server or prod tunnel is left running.
Do **not** touch a dev server/tunnel the user already had running. Leave the worktree until
the PR merges, then `git worktree remove`.

## Guardrails
- One issue → one worktree → one PR. Smallest correct change.
- Never write to the production backend; navigation/read-only verification only.
- Never commit secrets (`.env`, certs) — they're gitignored; keep it that way.
- If the fix balloons beyond the root cause or needs a product call, stop and escalate.

## Current environment (verify each run; point-in-time)
- Appliance: `helix appliance remote --host 3.108.135.4 --user helix --key "~/Downloads/Helix Kit Admin.pem" --port 3000`. (`helix-kit.com` A-records to `3.108.135.4`; SSH needs that IP + this key. `chmod 600` the key first.)
- Real login: `ops@helix-kit.com` (admin) at `/auth/login`. Origin is `http://localhost:3000` when driven through the tunnel.
- Reference fix (the flow's first run): HELIX-151 / PR #9 — added `web/apps/helix/src/app/admin/(dashboard)/page.tsx` redirecting `/admin` → `/admin/devices`.
