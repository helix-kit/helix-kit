---
name: linear-tracking
description: >-
  How to keep the Helix Linear tracker current for ANY work in this repo. Use at
  the START of every task — before writing code, running builds, or investigating
  — to confirm tracking exists and find or open the issue you're about to work on,
  and AFTER every accomplishment (a feature done, a bug fixed, a step verified, a
  blocker found, a decision made, scope changed) to update status and append an
  activity-log comment. Triggers whenever you begin, progress, finish, or abandon
  any Helix work: firmware, linux/device, web, android, cloud, tooling, docs, or
  anything under experimental/. Covers: the team/project/epic/label model, the
  find-before-create rule, the status lifecycle, and the per-issue activity log.
  Read and act on this BEFORE starting work, not after.
---

# Keeping the Helix Linear tracker up to date

**Linear is the source of truth for Helix progress.** All Helix work is tracked in
Linear (the `linear` MCP server) so nothing is half-done-and-forgotten. Every unit
of work maps to an issue; every accomplishment leaves a trail. This is not
optional bookkeeping — do it as part of the work, in the same turn.

> **HARD GATE — this is mandatory, not advisory.** You may **not** begin substantive
> work (write/edit code, run a fix, provision infra, change prod, deploy) until an
> issue for it exists and is `In Progress`. Tracking is the *first* action of the
> task and it runs *in the same turn as the work* — you record progress **as you go**,
> not batched at the end and not "later".
>
> **No exceptions for urgency or size.** "It's an urgent breakage", "it's a quick
> hotfix", "it's a one-line fix", "the site is down, no time to track" — none of
> these excuse skipping it. Urgent production fixes are *exactly* the work that most
> needs a trail. Opening/locating an issue costs one tool call; do it first, then
> fix. If you catch yourself thinking "I'll log it after I fix this," stop and log it
> now — that thought is the failure mode this rule exists to prevent.
>
> **Skipping compounds.** If you skip preflight on task 1, there's no in-progress
> issue to update on tasks 2, 3, 4 — so a whole session of fixes goes untracked. One
> skipped preflight silently poisons everything after it.

If the `mcp__linear__*` tools are not loaded, load them first with
`ToolSearch` (e.g. `select:mcp__linear__list_issues,mcp__linear__save_issue,mcp__linear__save_comment,mcp__linear__list_projects,mcp__linear__get_issue`).

## The five rules

1. **Preflight is a blocking gate — before you touch anything.** At the start of a
   task, confirm tracking is live and locate (or create) the issue you're about to
   work on, and move it to `In Progress`. Never start real work with no issue open
   for it. This gate applies to *every* substantive task equally — bug fixes, urgent
   breakages, hotfixes, infra/prod changes, and investigations that lead to a change
   — with no urgency or size exemption (see the HARD GATE above).
2. **Find before you create.** Search existing issues first. If the work extends or
   continues something already tracked, update that issue — do not open a duplicate.
3. **One issue per unit of work, filed under the right epic, with exactly two labels.**
   New work = a sub-issue under the matching epic, carrying **exactly one `TYPE` label and
   exactly one `SUBSYSTEM` label** — never more, never fewer (epics included).
4. **Status reflects reality, always.** Move the issue to `In Progress` when you start,
   `In Review` when it's up for review, `Done` only when verified end-to-end. Reflect
   blockers and cancellations too.
5. **Every change gets an activity-log comment.** On any status change or meaningful
   progress, add a comment to the issue saying what you did, what changed, how it was
   verified, and what's next. Linear's auto-history is not enough — write the narrative.

---

## Change workflow — worktree → branch → signed-off PR

Do all Helix work through this flow (authoritative in AGENTS.md §9.1–9.2):

1. **Worktree per change.** `~/code/helix` stays on `main`; never work in it. For the
   issue, `git worktree add ~/code/helix-worktrees/HELIX-<id> -b HELIX-<id> main` and
   work there. One worktree per change; `git worktree remove` it once the PR merges.
2. **Commit as Hardik Jain.** `git commit -s` (identity `Hardik Jain
   <jainhardik120@gmail.com>`). **No agent attribution** — no Claude/agent
   `Co-Authored-By` or sign-off trailer. Put `HELIX-<id>` in every commit message.
3. **PR for every change.** Push the branch, then `gh pr create --base main --title
   "HELIX-<id>: …"`. Squash-merge only; the required `linear-id` check reads the PR
   title; merged branches auto-delete. The user merges unless they ask you to.
4. **Track 0 → 100.** `In Progress` before the first edit → activity-log comment at each
   step → `In Review` when the PR opens → `Done` only when merged and verified.

---

## The tracking model (memorize this)

- **Team:** `Jainhardik120` (key `HELIX`).
- **Project:** `Helix` (id `78051107-b9cd-4b08-b574-ce8722472dc4`).
- **Epics** are parent issues (TYPE `EPIC`); concrete work are **sub-issues** with
  `parentId` set to the epic. Completed work is `Done`, live work `In Progress`,
  pending work `Backlog`/`Todo`.
- **Every issue carries exactly one `TYPE` + one `SUBSYSTEM` label** — two label groups,
  epics included, all names UPPERCASE.
- **`TYPE` group** — the nature of the work (**one only**):
  - `FEAT` — new feature / capability / enhancement in code.
  - `BUG` — defect / regression fix in code.
  - `DOC` — code/design documentation (docs/, READMEs, design writeups).
  - `BLOG` — a published blog post on the website (one issue per post).
  - `MKT` — website marketing update (landing/SEO/copy/campaigns).
  - `EPIC` — a parent tracking issue.
  - `BLOCKER` — a pre-deploy security/robustness gate (also file under the Pre-deploy
    blockers epic **HELIX-28**, `relatedTo` the home epic).
  - `EXPERIMENTAL` — prototype/lab work under `experimental/`.
  - **Precedence when several apply (one wins):** `EXPERIMENTAL` > `EPIC` (an experimental
    epic is typed `EXPERIMENTAL`, not `EPIC`) > `BLOCKER` > `FEAT`/`BUG`/`DOC`/`BLOG`/`MKT`.
- **`SUBSYSTEM` group** — which part of the stack (**one only**): `EMBEDDED-ESP32`,
  `EMBEDDED-ARDUINO`, `LINUX-DEVICE`, `LINUX-PLATFORM-OS`, `DEVICE-UI`, `WEB`, `ANDROID`,
  `CLOUD`, `TOOLING`, `PROTOCOL`, `EDGE-AI`. `EDGE-AI` = radxa edge-video/NPU + x86/GPU
  pipeline + on-device LLM. Experimental mapping: radxa/x86/LLM → `EDGE-AI`, chatbot →
  `WEB`, networking experiments → `CLOUD`, page-gating → `WEB`; documentation → usually
  `TOOLING`. There is **no `docs` subsystem** (retired — docs work is TYPE `DOC` + a
  subsystem).

### Epic map — pick the parent for new sub-issues

| Epic | Area |
| --- | --- |
| HELIX-5 | ESP32 protocol core & transports |
| HELIX-6 | ESP32 platform services (file, db, events, OTA, provisioning) |
| HELIX-7 | ESP32 build / flash / QEMU tooling |
| HELIX-8 | ESP32 console bridge |
| HELIX-9 | Device UI (LVGL) + display seam |
| HELIX-10 | Arduino / AVR firmware |
| HELIX-11 | Linux device runtime (helixd + Go/Python SDKs) |
| HELIX-12 | Device data plane & P2P / WebRTC transport |
| HELIX-13 | Helix Linux platform OS |
| HELIX-14 | Web app (Next.js console, marketing, docs, blog) |
| HELIX-15 | @helix/backend core (auth, tRPC, storage, PKI, releases/OTA, events) |
| HELIX-16 | Cloud appliance & AMI |
| HELIX-17 | Custom firmware build service |
| HELIX-18 | Load testing & scaling |
| HELIX-19 | CI/CD & deploy pipeline |
| HELIX-20 | Android SDK & app |
| HELIX-21 | Protocol contract codegen |
| HELIX-22 | helix CLI & lint gate |
| HELIX-23 | Radxa edge video & NPU inference |
| HELIX-24 | x86 / GPU cross-platform inference pipeline |
| HELIX-25 | Chat bot (Slack / Teams) |
| HELIX-26 | Networking & display experiments (P2P, bandwidth, port-forward, remote shell, kiosk) |
| HELIX-27 | Documentation |
| HELIX-28 | Pre-deploy blockers |
| HELIX-29 | On-device LLM fine-tuning |
| HELIX-30 | Build-time page gating experiment |
| HELIX-134 | Blog — published posts (parent for `BLOG` issues) |
| HELIX-135 | Website marketing & SEO (parent for `MKT` issues) |

Published blog posts → `BLOG` sub-issues under **HELIX-134**; marketing/SEO/landing changes →
`MKT` sub-issues under **HELIX-135** (both also carry the `web` subsystem label).

If the work genuinely fits no epic, create a **new epic** (labeled `epic` + subsystem,
in the `Helix` project) before adding its sub-issues — don't hang orphans off the
project root. If a new subsystem appears, create its label too.

---

## Preflight — do this BEFORE starting any work

1. **Confirm tracking is live.** `list_projects` (or `list_issues` with `project: "Helix"`).
   Expect the `Helix` project and the epics above. If the project or epics are missing,
   tracking hasn't been set up — **stop and set it up** per the `linear-tracking` memory
   before proceeding, or escalate to the user. Never start untracked.
2. **Find the issue for this work.** Search first:
   `list_issues` with `project: "Helix"` and a `query` on keywords, and/or filter by the
   subsystem `label`. Also check the relevant epic's sub-issues. Read candidates with
   `get_issue` before deciding.
3. **Decide: update or create.**
   - Continues / fixes / extends an existing issue → use it (go to *Updating*).
   - Genuinely new → create it (go to *New work*).
4. **Move it to `In Progress`** and drop a starting comment (what you're about to do).
   Only then start the actual work.

## New work — creating an issue

`save_issue` with: `team: "Jainhardik120"`, `project: "Helix"`, `parentId: <epic>`, the
subsystem `labels`, a clear `title`, and a `description` that states the goal and
references the concrete files/paths (`path:line`) involved. Set `state` to `In Progress`
if you're starting now, else `Backlog`/`Todo`. Set `priority` for blockers/urgent work
(1=Urgent, 2=High). For security gates, add `deploy-blocker`, parent it to HELIX-28, and
`relatedTo` the home epic.

## Updating an existing issue

- Change `state` to match reality (`In Progress` / `In Review` / `Done` / `Canceled`).
- If scope grew, edit the `description`; if it grew a lot, split out a new sub-issue and
  `relatedTo`/`blockedBy` it rather than overloading one card.
- **Always add the activity-log comment** (next section). Do not change status silently.

## The activity log — comment on every meaningful change

Use `save_comment` with `issueId: "HELIX-N"`. Add a comment when you: finish a step, flip a
status, hit or clear a blocker, make a design decision, change scope, or record a
verification result. Keep it factual and skimmable:

```
**<what happened>** — e.g. "Wired ota_sink to the OTA partition."
- Changed: <files / behavior> (path:line where useful)
- Verified: <how — qemu-test / e2e / lint / manual>, result
- Next: <the remaining step, or "none — closing">
```

One comment per accomplishment beats one giant end-of-task dump. When you set an issue to
`Done`, the closing comment must state how it was verified end-to-end (per the repo's
"verify behavior before you polish" rule) — don't mark `Done` on unverified code.

---

## Session handoff — capture everything for the next session

Work spans multiple sessions, and the next session (often a different agent) starts cold.
So **at the end of every work session — and whenever you pause a task mid-flight — append a
detailed handoff comment to the issue** capturing *everything* that happened, enough to
resume with zero re-discovery:

- **What was done, step by step** — the actual commands run and their **raw output/logs**
  (paste in fenced code blocks; attach full logs as files when long).
- **Evidence / artifacts** — screenshots, before/after captures, benchmark numbers, test
  output, `helix lint` / e2e results, URLs, PR links, commit SHAs.
- **State right now** — what works, what's half-done, what's broken, and exactly where you
  stopped (file:line, branch, worktree path).
- **Decisions & why** — choices made and the reasoning, so they aren't relitigated.
- **Next steps** — the concrete first action for the next session, plus any blockers.

Attach binary evidence (screenshots, log files, captures) to the issue as **Linear
attachments** (`prepare_attachment_upload` → PUT the bytes → `create_attachment_from_upload`,
or `create_attachment` for tiny files); keep short logs inline in the comment. Rule of
thumb: **a fresh agent should be able to read the issue's comments and continue the work
without you re-explaining anything.** Nothing done during the session may live only in the
chat transcript — it goes on the issue.

---

## Cadence

- **Start of task:** preflight (find/create issue → `In Progress` → starting comment).
- **After each accomplishment:** update status if it changed + activity-log comment.
- **On blocker:** comment the obstacle and options; if it gates production, type it
  `BLOCKER` and file under HELIX-28. Surface it to the user too (don't just log it).
- **End of session (even mid-task):** a **handoff comment** — raw logs, screenshots,
  evidence, current state, decisions, next steps (see *Session handoff* above).
- **End of task:** final status (`Done` only if verified) + closing comment.

## The dashboard & views

The **📊 Helix Tracking Dashboard** document (in the `Helix` project) is the human-readable
overview — snapshot counts, in-progress/in-review lists, blockers, per-subsystem progress,
epic completion, and recent activity. Its numbers are a point-in-time snapshot, so when a
change materially shifts the picture (a batch of issues closed, a new epic, a blocker
cleared), refresh the affected lines with `save_document` (find it via `list_documents` /
`get_document`). Don't rewrite the whole doc every task — update what moved.

Interactive, always-live **saved Views** (Active work, Deploy blockers, By subsystem,
Recently completed, Backlog, Experiments) live in the Linear UI and can't be created via
the API — the recipes are listed at the bottom of the dashboard doc. If the user asks for a
new view, add its recipe there rather than trying to create it programmatically.

## Commits reference the issue

Every commit message must carry the Linear id of the issue it advances, as
`HELIX-<number>` — e.g. `HELIX-125: validate gateway session token`, or a
`Refs: HELIX-125` trailer. Two layers enforce this:
- **Local (fast feedback):** a `commit-msg` hook (`.githooks/commit-msg`, activated
  with `git config core.hooksPath .githooks`) rejects commits with no `HELIX-<number>`.
- **Server (the real gate, can't be bypassed):** the **Commit tracking** GitHub
  Action (`.github/workflows/commit-tracking.yml` → `scripts/check-linear-id.sh`) is
  a required status check on `main`. The repo is **squash-merge only** and requires a
  PR, so the **PR title** becomes the single commit that lands on `main` — the check
  validates the **PR title** carries a `HELIX-<number>`.

So: **put the id in the PR title** (that's what lands and what's enforced); the local
hook additionally wants it on each commit but exempts merge/autosquash
(`fixup!`/`squash!`/`amend!`). Agents still don't commit unless asked (see AGENTS.md
§9.2) — but when you open a PR, title it `HELIX-<id>: …`.

## Don't

- Don't start substantive work with no issue open for it.
- Don't rationalize skipping preflight because the task feels urgent, small, or "just a
  quick fix" — there is no urgency/size exemption. Log first, then fix.
- Don't batch tracking to the end of a session ("I'll update Linear after") — update as
  you go, in the same turn as each accomplishment.
- Don't create a second issue for something already tracked — search first.
- Don't flip a status without an accompanying comment.
- Don't mark `Done` on unverified work.
- Don't hang sub-issues off the project with no epic parent.
- Don't leave a non-epic issue with no `Type` label, and don't put more than one.
- Don't create a new "BUG"/"bug" label — the `Bug` type label already exists.
- Don't touch the HELIX-1…HELIX-4 default Linear onboarding cards — they aren't Helix work.
